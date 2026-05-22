import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import type { Job, Order } from '@/lib/types';

/**
 * Board delta loader — drives client-driven /board (and /calendar, /orders)
 * auto-sync.
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
 *
 * `{ lists: true }` additionally returns the shipped/cancelled orderId sets
 * (the /orders list view derives its status badge from them). Those are a
 * FULL read each call — the sets are tiny (~150 rows) and a hard-deleted
 * shipped/cancelled row (e.g. restore) simply drops out, no tombstone needed.
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
  /** Distinct non-null orderIds in the `shipped` / `cancelled` tables, sorted.
   *  Only populated when called with `{ lists: true }` — the /orders list view
   *  needs them to derive the shipped/cancelled status badge. Sent FULL each
   *  call (the sets are small) so a hard-deleted row drops out cleanly. */
  shippedOrderIds?: number[];
  cancelledOrderIds?: number[];
}

/** Load the board delta from Postgres.
 *
 *  @param since  Cursor from the previous delta call. `null` = full snapshot
 *                (client bootstrap). Otherwise return rows changed since.
 *  @param opts   `{ lists: true }` also returns shippedOrderIds /
 *                cancelledOrderIds (used by the /orders list view).
 */
export async function loadBoardDelta(
  since: Date | null,
  opts: { lists?: boolean } = {},
): Promise<BoardDelta> {
  if (!isPostgresConfigured()) throw new BoardDeltaError('Postgres not configured');

  // Snapshot serverTime BEFORE the queries so a write that lands mid-query
  // is guaranteed to be picked up by the next delta call (next cursor is
  // older than the row that just landed → row is included). The opposite
  // ordering would create a write-loss window equal to query latency.
  const serverTime = new Date().toISOString();

  // shipped/cancelled orderId sets — fetched in parallel with the main delta
  // when requested. Always a FULL read: the sets are tiny and a hard-deleted
  // row (e.g. restore removing a cancelled row) drops out without needing an
  // updated_at delta or a tombstone column.
  const listsP = opts.lists
    ? Promise.all([
        sql<{ order_id: number | string }>`
          SELECT DISTINCT order_id FROM shipped
          WHERE order_id IS NOT NULL ORDER BY order_id
        `,
        sql<{ order_id: number | string }>`
          SELECT DISTINCT order_id FROM cancelled
          WHERE order_id IS NOT NULL ORDER BY order_id
        `,
      ])
    : null;

  let jobs: Job[];
  let orders: Order[];
  let deletedJobIds: number[];

  if (!since) {
    const [jobsR, ordersR] = await Promise.all([
      sql<{ raw: Job }>`SELECT raw FROM jobs WHERE phase2_deleted_at IS NULL ORDER BY id`,
      sql<{ raw: Order }>`SELECT raw FROM orders ORDER BY id DESC`,
    ]);
    jobs = jobsR.rows.map((r) => r.raw);
    orders = ordersR.rows.map((r) => r.raw);
    deletedJobIds = [];
  } else {
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
    jobs = jobsR.rows.map((r) => r.raw);
    orders = ordersR.rows.map((r) => r.raw);
    deletedJobIds = deletedR.rows.map((r) => Number(r.id));
  }

  const delta: BoardDelta = { jobs, orders, deletedJobIds, serverTime };

  if (listsP) {
    const [shippedR, cancelledR] = await listsP;
    delta.shippedOrderIds = shippedR.rows.map((r) => Number(r.order_id));
    delta.cancelledOrderIds = cancelledR.rows.map((r) => Number(r.order_id));
  }

  return delta;
}
