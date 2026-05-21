import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * Postgres-minted order/job ID allocation — the replacement for Apps Script
 * `getNextOrderId` / `getNextId` / `getNextIds`.
 *
 * Why: every order/job-creating route round-trips Apps Script (~1.5-2.5s) to
 * mint an id. Minting from a Postgres `counters` table cuts that to a few ms.
 * See migration-plan-id-allocation.md for the full design + rollout.
 *
 * Atomicity: `UPDATE counters SET value = value + N ... RETURNING` takes a
 * row-level lock on the single counter row — concurrent minters serialise on
 * it and each gets a distinct id. This replaces Apps Script's LockService
 * (which serialised the WHOLE app); here only the one counter row locks.
 *
 * Job ids — pure monotonic counter. NEVER derive from MAX(jobs.id): jobs move
 * to shipped/cancelled and the jobs row is hard-deleted, plus /api/jobs/delete
 * hard-deletes — so MAX(jobs.id) can sit below an already-issued id and a
 * MAX-derived mint would reuse it. The `counters.nextId` row is authoritative;
 * it is seeded once (see /api/admin/seed-id-counters) and only ever rises.
 *
 * Order ids — per-month `YYYYMMNNN` (9 digits). Orders are never deleted
 * (cancelled orders keep their row), so a defensive cross-check against
 * MAX(orders.id) for the month IS safe and guards against counter drift —
 * mirrors the Apps Script getNextOrderId behaviour.
 */

export class IdAllocationError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IdAllocationError';
  }
}

/** Current month as `YYYYMM` in Asia/Bangkok — the order-id prefix. Must use
 *  Bangkok time (not the Vercel function's UTC) so an order created at e.g.
 *  01:00 UTC on the 1st still gets the correct Thai-calendar month. */
function bangkokYYYYMM(): string {
  // en-CA formats as YYYY-MM-DD; take YYYY-MM and strip the dash.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return parts.slice(0, 7).replace('-', '');
}

/** Mint one job id. Atomic via `UPDATE ... RETURNING` (counter row lock).
 *  Throws IdAllocationError if Postgres is unconfigured or the counter row
 *  is missing (run /api/admin/db-migrate + /api/admin/seed-id-counters). */
export async function mintJobId(): Promise<number> {
  if (!isPostgresConfigured()) {
    throw new IdAllocationError('Postgres not configured');
  }
  const r = await sql<{ id: string }>`
    UPDATE counters SET value = value + 1
    WHERE key = 'nextId'
    RETURNING (value - 1)::text AS id
  `;
  if (!r.rows[0]) {
    throw new IdAllocationError(
      'counters.nextId row missing — run /api/admin/seed-id-counters',
    );
  }
  return Number(r.rows[0].id);
}

/** Mint N sequential job ids in one atomic bump. Returns `[start..start+N-1]`.
 *  Used by /api/jobs/bulk-forward. Cap 100 (bulk-forward maxes at 25). */
export async function mintJobIds(count: number): Promise<number[]> {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return [];
  if (n > 100) throw new IdAllocationError('mintJobIds: count must be <= 100');
  if (!isPostgresConfigured()) {
    throw new IdAllocationError('Postgres not configured');
  }
  const r = await sql<{ value: string }>`
    UPDATE counters SET value = value + ${n}
    WHERE key = 'nextId'
    RETURNING value::text
  `;
  if (!r.rows[0]) {
    throw new IdAllocationError(
      'counters.nextId row missing — run /api/admin/seed-id-counters',
    );
  }
  const end = Number(r.rows[0].value); // value AFTER the bump = next free id
  const start = end - n;
  return Array.from({ length: n }, (_, i) => start + i);
}

/** Mint one order id — `YYYYMMNNN` for the current Bangkok month.
 *  The bump is `GREATEST(counter, max-seq-in-orders-this-month) + 1` so a
 *  drifted-low counter self-heals against the orders table. */
export async function mintOrderId(): Promise<number> {
  if (!isPostgresConfigured()) {
    throw new IdAllocationError('Postgres not configured');
  }
  const yyyymm = bangkokYYYYMM();
  const prefix = Number(yyyymm);   // e.g. 202605
  const key = `orderCounter_${yyyymm}`;
  const lo = prefix * 1000;        // 202605000 — id range start for the month
  const hi = (prefix + 1) * 1000;  // 202606000 — exclusive end

  // Ensure the month's counter row exists (months roll over — a fresh month
  // has no row yet). Separate statement: ON CONFLICT makes it race-safe.
  await sql`
    INSERT INTO counters (key, value) VALUES (${key}, 0)
    ON CONFLICT (key) DO NOTHING
  `;

  // Atomic bump + defensive cross-check. The orders subquery is a floor only;
  // even if it reads a stale-low max, `value` (the counter, read fresh under
  // the row lock) dominates — a concurrent mint already raised it.
  const r = await sql<{ value: string }>`
    UPDATE counters
       SET value = GREATEST(
         value,
         COALESCE(
           (SELECT MAX(id) FROM orders WHERE id >= ${lo} AND id < ${hi}),
           ${lo}
         ) - ${lo}
       ) + 1
     WHERE key = ${key}
     RETURNING value::text
  `;
  if (!r.rows[0]) {
    throw new IdAllocationError(`counter ${key} missing after upsert`);
  }
  return lo + Number(r.rows[0].value);
}
