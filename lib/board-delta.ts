import 'server-only';
import { unstable_cache } from 'next/cache';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { LOAD_ALL_TAG } from '@/lib/api';
import type { Job, Order, Shipped, Cancelled } from '@/lib/types';

/** Rolling window for list-shaped reads (M-bootstrap-orders-unbounded).
 *  Applies consistently to: the bootstrap orders window (via the YYYYMM id
 *  cutoff below), the /shipped + /cancelled fullLists bootstrap rows, and
 *  the /orders orderId sets. Consistency matters: an order inside the window
 *  ships/cancels inside the window too (the event always follows creation),
 *  so status badges + orphan detection never see a half-windowed pair.
 *  Rows older than this are the future §13 archive path's job. */
const LIST_WINDOW = '12 months';

/** Cutoff order id for the bootstrap window: order ids are YYYYMM*1000+seq
 *  (WP-era scheme, allocated per Bangkok calendar month by getNextId), so
 *  `id >= cutoff` windows by TRUE order month — unlike `imported_at`, which
 *  is a backfill date for rows bulk-migrated from the Sheet in 2026-05.
 *  Returns the id floor of the same month last year (Bangkok, fixed UTC+7). */
export function ordersCutoffId(now: Date = new Date()): number {
  const bkk = new Date(now.getTime() + 7 * 3600_000);
  const y = bkk.getUTCFullYear() - 1;
  const m = bkk.getUTCMonth() + 1;
  return (y * 100 + m) * 1000;
}

/** Shipped/cancelled order-id sets for the /orders list view — a windowed
 *  snapshot (not delta): bounded by LIST_WINDOW so it stays small forever,
 *  and a hard-deleted row (e.g. /restore pulling a row back out of
 *  cancelled) must simply drop out. Cached 15s + tag-invalidated on every
 *  job write (they all call `revalidateTag(LOAD_ALL_TAG)`), so N tabs
 *  polling coalesce to one DISTINCT scan per window instead of one scan per
 *  tab per poll (PERF-M1). */
const loadOrderIdSetsCached = unstable_cache(
  async (): Promise<{ shippedOrderIds: number[]; cancelledOrderIds: number[] }> => {
    const [shippedR, cancelledR] = await Promise.all([
      sql<{ order_id: number | string }>`
        SELECT DISTINCT order_id FROM shipped
        WHERE order_id IS NOT NULL
          AND imported_at > NOW() - ${LIST_WINDOW}::interval
        ORDER BY order_id
      `,
      sql<{ order_id: number | string }>`
        SELECT DISTINCT order_id FROM cancelled
        WHERE order_id IS NOT NULL
          AND imported_at > NOW() - ${LIST_WINDOW}::interval
        ORDER BY order_id
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
 *   orderId sets. Used by /orders to derive its status badge. Windowed to
 *   LIST_WINDOW (matching the orders bootstrap window) so the sets stay
 *   small no matter how the tables grow.
 *
 * `{ fullLists: true }` (heavier) — returns full shipped + cancelled rows
 *   plus the current PK ID list for delete detection. Used by /shipped +
 *   /cancelled which need every row, not just the orderId set.
 *   - Bootstrap (since=null): LIST_WINDOW-windowed read of both rows + IDs.
 *   - Incremental: `imported_at > since` new rows + a cheap windowed
 *     {count, maxId} check per table. The client detects hard-deletes
 *     (e.g. /restore) by comparing the checks against its merged state and
 *     re-polls with `withIds: true` to fetch the full current ID list only
 *     then — no tombstone column needed, and the default poll no longer
 *     scans + ships every PK (M-fulllists-id-array-every-poll).
 *   - `lists` is ignored when `fullLists` is set (full rows are a
 *     strict superset; the orderId set can be derived client-side).
 */

export class BoardDeltaError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BoardDeltaError';
  }
}

/** Cheap per-table consistency check for the fullLists incremental poll —
 *  COUNT + MAX(id) over the LIST_WINDOW. The client compares these against
 *  its merged state; a mismatch (hard-delete from /restore, or a row aging
 *  out of the window) triggers ONE reconcile poll with `withIds` to fetch
 *  the full id set. Normal polls ship ~30 bytes instead of every PK. */
export interface ListCheck {
  count: number;
  maxId: number;
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
  /** Full PK ID set (within LIST_WINDOW) of the shipped / cancelled tables
   *  AT POLL TIME — the client diffs this against its known IDs to drop rows
   *  that were hard-deleted (e.g. /restore reattaches a cancelled job to
   *  /board). Populated on the fullLists BOOTSTRAP (derived from the rows)
   *  and on incremental polls that request `{ withIds: true }` — the default
   *  incremental poll ships the cheap `shippedCheck`/`cancelledCheck`
   *  instead (M-fulllists-id-array-every-poll). */
  shippedAllIds?: number[];
  cancelledAllIds?: number[];
  /** Windowed COUNT + MAX(id) checks — populated on every fullLists
   *  incremental poll. See ListCheck. */
  shippedCheck?: ListCheck;
  cancelledCheck?: ListCheck;
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
  opts: { lists?: boolean; fullLists?: boolean; withIds?: boolean } = {},
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
          sql<{ raw: Shipped }>`
            SELECT raw FROM shipped
            WHERE imported_at > NOW() - ${LIST_WINDOW}::interval
            ORDER BY id DESC
          `,
          sql<{ raw: Cancelled }>`
            SELECT raw FROM cancelled
            WHERE imported_at > NOW() - ${LIST_WINDOW}::interval
            ORDER BY id DESC
          `,
          null,
          null,
          null, // no stats on bootstrap — the client seeds its id set from the rows
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
          // Full id sets only on an explicit reconcile poll (?ids=1) — the
          // default poll ships the cheap stats row below instead
          // (M-fulllists-id-array-every-poll). Windowed to LIST_WINDOW so
          // the set always matches the bootstrap rows + the checks.
          opts.withIds
            ? sql<{ id: string }>`
                SELECT id::text AS id FROM shipped
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval
                ORDER BY id
              `
            : null,
          opts.withIds
            ? sql<{ id: string }>`
                SELECT id::text AS id FROM cancelled
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval
                ORDER BY id
              `
            : null,
          // One stats round-trip covering both tables. NOT transactional
          // with the id-set queries above — a write landing between the
          // parallel statements can skew one poll; the client just
          // reconciles again next tick.
          sql<{
            shipped_count: string; shipped_max: string | null;
            cancelled_count: string; cancelled_max: string | null;
          }>`
            SELECT
              (SELECT COUNT(*) FROM shipped
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval) AS shipped_count,
              (SELECT MAX(id) FROM shipped
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval) AS shipped_max,
              (SELECT COUNT(*) FROM cancelled
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval) AS cancelled_count,
              (SELECT MAX(id) FROM cancelled
                WHERE imported_at > NOW() - ${LIST_WINDOW}::interval) AS cancelled_max
          `,
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
      //
      // M-bootstrap-orders-unbounded: window the bootstrap AT THE DB — the
      // last ~12 months by YYYYMM id cutoff, UNION any order still referenced
      // by an active job (board cards / calendar lookups must always resolve,
      // however old the parent order). Older orders age out of the list pages;
      // the §13 archive path owns them. Incremental deltas stay unwindowed —
      // the updated_at cursor already bounds them, and a touched old order
      // resurfacing client-side until next reload is fine.
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
        WHERE id >= ${ordersCutoffId()}
           OR id IN (SELECT order_id FROM jobs
                     WHERE phase2_deleted_at IS NULL AND order_id IS NOT NULL)
        ORDER BY id DESC
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
    const [sR, cR, sAllR, cAllR, statsR] = await fullListsP;
    delta.shipped = sR.rows.map((r) => r.raw);
    delta.cancelled = cR.rows.map((r) => r.raw);
    if (sAllR && cAllR) {
      // reconcile poll (withIds) — current PK ID set drives client delete detection
      delta.shippedAllIds = sAllR.rows.map((r) => Number(r.id));
      delta.cancelledAllIds = cAllR.rows.map((r) => Number(r.id));
    } else if (!statsR) {
      // bootstrap — every row was just returned; client uses these as the ID set
      delta.shippedAllIds = delta.shipped.map((s) => Number(s.id));
      delta.cancelledAllIds = delta.cancelled.map((c) => Number(c.id));
    }
    if (statsR) {
      // incremental — cheap consistency checks in place of the full id arrays
      const st = statsR.rows[0];
      if (st) {
        delta.shippedCheck = { count: Number(st.shipped_count), maxId: Number(st.shipped_max ?? 0) };
        delta.cancelledCheck = { count: Number(st.cancelled_count), maxId: Number(st.cancelled_max ?? 0) };
      }
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
