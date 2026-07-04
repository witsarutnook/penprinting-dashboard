import 'server-only';
import { unstable_cache } from 'next/cache';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { LOAD_ALL_TAG } from '@/lib/api';
import type { Job, Order, Shipped, Cancelled } from '@/lib/types';

/** Shipped/cancelled order-id sets for the /orders list view — a full
 *  snapshot (not delta): small, and a hard-deleted row (e.g. /restore
 *  pulling a row back out of cancelled) must simply drop out. Cached 15s +
 *  tag-invalidated on every job write (they all call
 *  `revalidateTag(LOAD_ALL_TAG)`), so N tabs polling coalesce to one DISTINCT
 *  scan per window instead of one scan per tab per poll (PERF-M1). */
const loadOrderIdSetsCached = unstable_cache(
  async (): Promise<{ shippedOrderIds: number[]; cancelledOrderIds: number[] }> => {
    const [shippedR, cancelledR] = await Promise.all([
      sql<{ order_id: number | string }>`
        SELECT DISTINCT order_id FROM shipped
        WHERE order_id IS NOT NULL ORDER BY order_id
      `,
      sql<{ order_id: number | string }>`
        SELECT DISTINCT order_id FROM cancelled
        WHERE order_id IS NOT NULL ORDER BY order_id
      `,
    ]);
    return {
      shippedOrderIds: shippedR.rows.map((r) => Number(r.order_id)),
      cancelledOrderIds: cancelledR.rows.map((r) => Number(r.order_id)),
    };
  },
  ['board-order-id-sets'],
  { tags: [LOAD_ALL_TAG], revalidate: 15 },
);

/**
 * Board delta loader — drives client-driven /board, /calendar, /orders,
 * /cancelled, /shipped auto-sync.
 *
 * Replaces the per-tick `router.refresh()` round-trip with a small JSON
 * payload of only the rows that changed since the client's cursor. The
 * client merges the delta into local state, so the server no longer
 * re-renders + streams the full board HTML every 15s.
 *
 * Cursor source: `jobs.updated_at` / `orders.updated_at`, bumped by
 * BEFORE UPDATE triggers when `raw` or `phase2_deleted_at` changes.
 * Phase 4.2 close-out (2026-05-18) makes the cursor authoritative:
 * jobs/orders cron is OFF, dual-write mirror is gone, Postgres is sole
 * source of truth. No Sheet edits leak past.
 *
 * Tombstones (jobs.phase2_deleted_at IS NOT NULL) are reported as
 * `deletedJobIds` so the client knows to remove cards from local state.
 * The two queries are mutually exclusive (`IS NULL` vs `IS NOT NULL`)
 * so a row appears in exactly one bucket per delta.
 *
 * ── Opts ──
 * `{ lists: true }` (cheap) — additionally returns the shipped/cancelled
 *   orderId sets. Used by /orders to derive its status badge. FULL read
 *   each call; the sets are tiny (~150 rows).
 *
 * `{ fullLists: true }` (heavier) — returns full shipped + cancelled rows
 *   plus the current PK ID list for delete detection. Used by /shipped +
 *   /cancelled which need every row, not just the orderId set.
 *   - Bootstrap (since=null): full table read of both rows + IDs.
 *   - Incremental: `imported_at > since` new rows + the full current ID
 *     list (so the client can drop tombstoned rows after a /restore
 *     hard-deletes them — no tombstone column needed).
 *   - `lists` is ignored when `fullLists` is set (full rows are a
 *     strict superset; the orderId set can be derived client-side).
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
   *  Populated by `{ lists: true }` OR `{ fullLists: true }` (the latter
   *  derives them from `shipped` / `cancelled` rows). Sent FULL each call. */
  shippedOrderIds?: number[];
  cancelledOrderIds?: number[];
  /** Full shipped / cancelled rows. Bootstrap = entire table; incremental =
   *  only rows where `imported_at > since`. Populated only when
   *  `{ fullLists: true }`. */
  shipped?: Shipped[];
  cancelled?: Cancelled[];
  /** Full PK ID set of the shipped / cancelled tables AT POLL TIME — the
   *  client diffs this against its known IDs to drop rows that were
   *  hard-deleted (e.g. /restore reattaches a cancelled job to /board).
   *  Populated only when `{ fullLists: true }`. */
  shippedAllIds?: number[];
  cancelledAllIds?: number[];
}

/** Load the board delta from Postgres.
 *
 *  @param since  Cursor from the previous delta call. `null` = full snapshot
 *                (client bootstrap). Otherwise return rows changed since.
 *  @param opts   `{ lists: true }` adds shippedOrderIds / cancelledOrderIds
 *                (used by /orders). `{ fullLists: true }` adds full shipped
 *                / cancelled rows + their PK ID set (used by /shipped +
 *                /cancelled). `fullLists` supersedes `lists`.
 */
export async function loadBoardDelta(
  since: Date | null,
  opts: { lists?: boolean; fullLists?: boolean } = {},
): Promise<BoardDelta> {
  if (!isPostgresConfigured()) throw new BoardDeltaError('Postgres not configured');

  // Snapshot serverTime BEFORE the queries so a write that lands mid-query
  // is guaranteed to be picked up by the next delta call (next cursor is
  // older than the row that just landed → row is included). The opposite
  // ordering would create a write-loss window equal to query latency.
  const serverTime = new Date().toISOString();

  // shipped/cancelled orderId sets — cached full snapshot, fetched in
  // parallel with the main delta when requested (see loadOrderIdSetsCached
  // above). Skipped when fullLists is set — those orderIds are derived from
  // the full rows client-side.
  const wantOrderIds = !!opts.lists && !opts.fullLists;
  const orderIdsP = wantOrderIds ? loadOrderIdSetsCached() : null;

  // Full shipped/cancelled rows + their current PK ID set for delete detection.
  // Bootstrap (since=null) returns the full tables; incremental returns only
  // rows added since the cursor (cheap — append-only writers use NOW()) plus
  // the full current ID list so the client can drop tombstones from a /restore.
  const fullListsP = opts.fullLists
    ? since === null
      ? Promise.all([
          sql<{ raw: Shipped }>`SELECT raw FROM shipped ORDER BY id DESC`,
          sql<{ raw: Cancelled }>`SELECT raw FROM cancelled ORDER BY id DESC`,
          null,
          null,
        ])
      : Promise.all([
          sql<{ raw: Shipped }>`
            SELECT raw FROM shipped
            WHERE imported_at > ${since.toISOString()}
            ORDER BY id DESC
          `,
          sql<{ raw: Cancelled }>`
            SELECT raw FROM cancelled
            WHERE imported_at > ${since.toISOString()}
            ORDER BY id DESC
          `,
          sql<{ id: string }>`SELECT id::text AS id FROM shipped ORDER BY id`,
          sql<{ id: string }>`SELECT id::text AS id FROM cancelled ORDER BY id`,
        ])
    : null;

  let jobs: Job[];
  let orders: Order[];
  let deletedJobIds: number[];

  if (!since) {
    const [jobsR, ordersR] = await Promise.all([
      sql<{ raw: Job }>`SELECT raw FROM jobs WHERE phase2_deleted_at IS NULL ORDER BY id`,
      // PERF-H2/M2: ship a SLIM order — strip the heavy `rawData`/`details`
      // spec blobs (the board/orders list never renders them inline; the
      // detail modal + edit form lazy-fetch via /api/orders/raw/[id]). Keep
      // every top-level display field, and re-project the two derived fields
      // the list/board DO need: `pin` (shown in the /orders row) and
      // `hasSpec` (drives the board card's "สเปคงาน" tab visibility).
      sql<{ raw: Order }>`
        SELECT (raw - 'rawData' - 'details')
          || jsonb_build_object(
               'pin', COALESCE(raw #>> '{rawData,pin}', raw #>> '{details,pin}'),
               'hasSpec', (
                 COALESCE(raw->'rawData', '{}'::jsonb) <> '{}'::jsonb
                 OR COALESCE(raw->'details', '{}'::jsonb) <> '{}'::jsonb
               )
             ) AS raw
        FROM orders ORDER BY id DESC
      `,
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
      // Same slim projection as the bootstrap branch (PERF-H2/M2) — see above.
      sql<{ raw: Order }>`
        SELECT (raw - 'rawData' - 'details')
          || jsonb_build_object(
               'pin', COALESCE(raw #>> '{rawData,pin}', raw #>> '{details,pin}'),
               'hasSpec', (
                 COALESCE(raw->'rawData', '{}'::jsonb) <> '{}'::jsonb
                 OR COALESCE(raw->'details', '{}'::jsonb) <> '{}'::jsonb
               )
             ) AS raw
        FROM orders
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

  if (orderIdsP) {
    const sets = await orderIdsP;
    delta.shippedOrderIds = sets.shippedOrderIds;
    delta.cancelledOrderIds = sets.cancelledOrderIds;
  }

  if (fullListsP) {
    const [sR, cR, sAllR, cAllR] = await fullListsP;
    delta.shipped = sR.rows.map((r) => r.raw);
    delta.cancelled = cR.rows.map((r) => r.raw);
    if (sAllR && cAllR) {
      // incremental — current PK ID set drives client delete detection
      delta.shippedAllIds = sAllR.rows.map((r) => Number(r.id));
      delta.cancelledAllIds = cAllR.rows.map((r) => Number(r.id));
    } else {
      // bootstrap — every row was just returned; client uses these as the ID set
      delta.shippedAllIds = delta.shipped.map((s) => Number(s.id));
      delta.cancelledAllIds = delta.cancelled.map((c) => Number(c.id));
    }
    // We deliberately do NOT derive shippedOrderIds/cancelledOrderIds here:
    // in incremental mode delta.shipped contains only new rows since the
    // cursor, so the derived set would be wrong. The two consumers don't
    // overlap (/orders uses { lists: true }; /shipped + /cancelled use
    // { fullLists: true }) so the orderId set is left undefined for
    // fullLists callers.
  }

  return delta;
}
