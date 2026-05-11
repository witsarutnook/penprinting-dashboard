import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { post, AppsScriptError } from '@/lib/api';

/**
 * Heal cron — push Postgres-authoritative state for dirty rows back to
 * Sheet. Mirror of `lib/sync-from-sheet.ts` in the opposite direction.
 *
 * Dirty rows = `phase2_dirty_at IS NOT NULL` — set by Phase 2 write paths
 * when they update Postgres but couldn't (or didn't yet) sync the change
 * inline to Sheet via Apps Script. The heal cron retries the Apps Script
 * sync; on success it clears `phase2_dirty_at` so the next from-Sheet
 * cron treats the row normally again.
 *
 * Why dirty rows accumulate:
 *  - Phase 2 inline best-effort Sheet sync can fail (Apps Script down,
 *    rate-limit, network blip)
 *  - Some Phase 2 paths intentionally don't await inline sync (when
 *    callers want to return fast and let a background job handle Sheet
 *    propagation — e.g. bulk operations)
 *  - Apps Script LockService contention with concurrent admin writes
 *
 * Limits: 50 rows per table per run. If more than that pile up, multiple
 * runs heal them. The 5-min cron cadence + 50-row batch comfortably
 * handles 600 rows/hour of drift.
 */

interface HealResult {
  table: string;
  candidates: number;  // total dirty rows seen
  attempted: number;   // rows we tried to push
  healed: number;      // Apps Script setRow succeeded
  failed: number;      // still dirty after this run
  errors: string[];    // sample error messages (capped at 5)
  ms: number;
}

const BATCH_LIMIT = 50;

export interface FullHealResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  tables: HealResult[];
}

export async function healAllDirtyRows(): Promise<FullHealResult> {
  const startedAt = new Date();
  const tables: HealResult[] = [];

  if (!isPostgresConfigured()) {
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      totalMs: 0,
      tables: [{
        table: 'config',
        candidates: 0,
        attempted: 0,
        healed: 0,
        failed: 0,
        errors: ['POSTGRES_URL env var missing'],
        ms: 0,
      }],
    };
  }

  // Heal each Phase 2-active table. setOrderRow added 2026-05-11 for the
  // createOrder migration; setShippedRow / setCancelledRow / deleteJobByIdRow
  // added 2026-05-11 for moveToShipped + cancelJob.
  tables.push(await healJobsDirty());
  tables.push(await healOrdersDirty());
  tables.push(await healShippedDirty());
  tables.push(await healCancelledDirty());
  tables.push(await healJobsTombstone());

  const finishedAt = new Date();
  return {
    ok: tables.every(t => t.failed === 0),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalMs: finishedAt.getTime() - startedAt.getTime(),
    tables,
  };
}

interface DirtyJobRow {
  id: number;
  raw: Record<string, unknown> | null;
}

async function healJobsDirty(): Promise<HealResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let healed = 0;
  let failed = 0;
  let attempted = 0;
  let candidates = 0;

  try {
    const r = await sql<DirtyJobRow>`
      SELECT id, raw
      FROM jobs
      WHERE phase2_dirty_at IS NOT NULL
      ORDER BY phase2_dirty_at ASC
      LIMIT ${BATCH_LIMIT + 1}
    `;
    candidates = r.rowCount ?? 0;
    const batch = r.rows.slice(0, BATCH_LIMIT);
    attempted = batch.length;

    for (const row of batch) {
      // raw column holds the full job snapshot — use it as-is for setJobRow.
      // Defensive default: if raw is missing (old row pre-Phase-1.7), build
      // minimal {id} payload so Apps Script at least clears the row from
      // dirty state by acknowledging receipt.
      const payload = (row.raw && typeof row.raw === 'object')
        ? { ...row.raw, id: row.id }
        : { id: row.id };

      try {
        const res = await post<{ ok?: boolean; error?: string }>(
          'setJobRow',
          { data: payload },
        );
        if (res.error) {
          throw new AppsScriptError('setJobRow', res.error);
        }
        await sql`UPDATE jobs SET phase2_dirty_at = NULL WHERE id = ${row.id}::bigint`;
        healed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < 5) errors.push(`id=${row.id}: ${msg}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    failed++;
  }

  return {
    table: 'jobs',
    candidates,
    attempted,
    healed,
    failed,
    errors,
    ms: Date.now() - t0,
  };
}

interface DirtyOrderRow {
  id: number;
  raw: Record<string, unknown> | null;
}

async function healOrdersDirty(): Promise<HealResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let healed = 0;
  let failed = 0;
  let attempted = 0;
  let candidates = 0;

  try {
    const r = await sql<DirtyOrderRow>`
      SELECT id, raw
      FROM orders
      WHERE phase2_dirty_at IS NOT NULL
      ORDER BY phase2_dirty_at ASC
      LIMIT ${BATCH_LIMIT + 1}
    `;
    candidates = r.rowCount ?? 0;
    const batch = r.rows.slice(0, BATCH_LIMIT);
    attempted = batch.length;

    for (const row of batch) {
      const payload = (row.raw && typeof row.raw === 'object')
        ? { ...row.raw, id: row.id }
        : { id: row.id };

      try {
        const res = await post<{ ok?: boolean; error?: string }>(
          'setOrderRow',
          { data: payload },
        );
        if (res.error) {
          throw new AppsScriptError('setOrderRow', res.error);
        }
        await sql`UPDATE orders SET phase2_dirty_at = NULL WHERE id = ${row.id}::bigint`;
        healed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < 5) errors.push(`id=${row.id}: ${msg}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    failed++;
  }

  return {
    table: 'orders',
    candidates,
    attempted,
    healed,
    failed,
    errors,
    ms: Date.now() - t0,
  };
}

interface DirtyRow {
  id: number;
  raw: Record<string, unknown> | null;
}

/** Generic heal for tables with phase2_dirty_at column + setRow action. */
async function healDirty(
  tableName: 'shipped' | 'cancelled',
  appsScriptAction: 'setShippedRow' | 'setCancelledRow',
): Promise<HealResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let healed = 0;
  let failed = 0;
  let attempted = 0;
  let candidates = 0;

  try {
    const r = await sql.query<DirtyRow>(
      `SELECT id, raw FROM ${tableName} WHERE phase2_dirty_at IS NOT NULL ORDER BY phase2_dirty_at ASC LIMIT $1`,
      [BATCH_LIMIT + 1],
    );
    candidates = r.rowCount ?? 0;
    const batch = r.rows.slice(0, BATCH_LIMIT);
    attempted = batch.length;

    for (const row of batch) {
      const payload = (row.raw && typeof row.raw === 'object')
        ? { ...row.raw, id: row.id }
        : { id: row.id };

      try {
        const res = await post<{ ok?: boolean; error?: string }>(
          appsScriptAction,
          { data: payload },
        );
        if (res.error) {
          throw new AppsScriptError(appsScriptAction, res.error);
        }
        await sql.query(
          `UPDATE ${tableName} SET phase2_dirty_at = NULL WHERE id = $1::bigint`,
          [row.id],
        );
        healed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < 5) errors.push(`id=${row.id}: ${msg}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    failed++;
  }

  return {
    table: tableName,
    candidates,
    attempted,
    healed,
    failed,
    errors,
    ms: Date.now() - t0,
  };
}

function healShippedDirty(): Promise<HealResult> {
  return healDirty('shipped', 'setShippedRow');
}

function healCancelledDirty(): Promise<HealResult> {
  return healDirty('cancelled', 'setCancelledRow');
}

/** Tombstone heal — pushes deleteJobByIdRow for rows with phase2_deleted_at,
 *  then hard-DELETEs the row from Postgres on success. From-Sheet cron's
 *  ON CONFLICT (id) DO NOTHING handles the in-flight window where Sheet
 *  still has the row + Postgres tombstone is preventing re-insert. */
async function healJobsTombstone(): Promise<HealResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let healed = 0;
  let failed = 0;
  let attempted = 0;
  let candidates = 0;

  try {
    const r = await sql<{ id: number }>`
      SELECT id FROM jobs
      WHERE phase2_deleted_at IS NOT NULL
      ORDER BY phase2_deleted_at ASC
      LIMIT ${BATCH_LIMIT + 1}
    `;
    candidates = r.rowCount ?? 0;
    const batch = r.rows.slice(0, BATCH_LIMIT);
    attempted = batch.length;

    for (const row of batch) {
      try {
        const res = await post<{ ok?: boolean; error?: string }>(
          'deleteJobByIdRow',
          { data: { id: row.id } },
        );
        if (res.error) {
          throw new AppsScriptError('deleteJobByIdRow', res.error);
        }
        // Sheet caught up — hard-delete the tombstoned row from Postgres.
        await sql`DELETE FROM jobs WHERE id = ${row.id}::bigint`;
        healed++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        if (errors.length < 5) errors.push(`id=${row.id}: ${msg}`);
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    failed++;
  }

  return {
    table: 'jobs_tombstone',
    candidates,
    attempted,
    healed,
    failed,
    errors,
    ms: Date.now() - t0,
  };
}
