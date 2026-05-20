import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import type { Job, Order } from '@/lib/types';

/**
 * Board delta loader — drives client-driven /board auto-sync.
 *
 * Replaces the per-tick `router.refresh()` round-trip with a small JSON
 * payload of only the rows that changed since the client's cursor. The
 * client merges the delta into local state, so the server no longer
 * re-renders + streams the full board HTML every 15s.
 *
 * Cursor source: `jobs.updated_at` / `orders.updated_at`, bumped by
 * BEFORE UPDATE triggers when `raw` or `phase2_deleted_at` changes
 * (heal-cron's `phase2_dirty_at` clear is filtered out — see migration
 * route). Phase 4.2 close-out (2026-05-18) makes the cursor authoritative:
 * jobs/orders cron is OFF, dual-write mirror is gone, Postgres is sole
 * source of truth. No Sheet edits leak past.
 *
 * Tombstones (jobs.phase2_deleted_at IS NOT NULL) are reported as
 * `deletedJobIds` so the client knows to remove cards from local state.
 * The two queries are mutually exclusive (`IS NULL` vs `IS NOT NULL`)
 * so a row appears in exactly one bucket per delta.
 */

export class BoardDeltaError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BoardDeltaError';
  }
}

export interface BoardDelta {
  jobs: Job[];
  orders: Order[];
  /** Job IDs tombstoned since the cursor (phase2_deleted_at > since).
   *  Empty when `since` is null (full snapshot omits tombstones entirely). */
  deletedJobIds: number[];
  /** Server timestamp at the start of the query batch. The client uses this
   *  as the cursor for the NEXT delta call — using server time avoids clock
   *  skew between client and server. Quoted as ISO so the client can pass
   *  it straight back without parsing. */
  serverTime: string;
}

/** Load the board delta from Postgres.
 *
 *  @param since  Cursor from the previous delta call. `null` = full snapshot
 *                (client bootstrap). Otherwise return rows changed since.
 */
export async function loadBoardDelta(since: Date | null): Promise<BoardDelta> {
  if (!isPostgresConfigured()) throw new BoardDeltaError('Postgres not configured');

  // Snapshot serverTime BEFORE the queries so a write that lands mid-query
  // is guaranteed to be picked up by the next delta call (next cursor is
  // older than the row that just landed → row is included). The opposite
  // ordering would create a write-loss window equal to query latency.
  const serverTime = new Date().toISOString();

  if (!since) {
    const [jobsR, ordersR] = await Promise.all([
      sql<{ raw: Job }>`SELECT raw FROM jobs WHERE phase2_deleted_at IS NULL ORDER BY id`,
      sql<{ raw: Order }>`SELECT raw FROM orders ORDER BY id DESC`,
    ]);
    return {
      jobs: jobsR.rows.map((r) => r.raw),
      orders: ordersR.rows.map((r) => r.raw),
      deletedJobIds: [],
      serverTime,
    };
  }

  const sinceIso = since.toISOString();
  const [jobsR, ordersR, deletedR] = await Promise.all([
    sql<{ raw: Job }>`
      SELECT raw FROM jobs
      WHERE updated_at > ${sinceIso}
        AND phase2_deleted_at IS NULL
      ORDER BY id
    `,
    sql<{ raw: Order }>`
      SELECT raw FROM orders
      WHERE updated_at > ${sinceIso}
      ORDER BY id DESC
    `,
    sql<{ id: string }>`
      SELECT id::text AS id FROM jobs
      WHERE phase2_deleted_at > ${sinceIso}
    `,
  ]);

  return {
    jobs: jobsR.rows.map((r) => r.raw),
    orders: ordersR.rows.map((r) => r.raw),
    deletedJobIds: deletedR.rows.map((r) => Number(r.id)),
    serverTime,
  };
}
