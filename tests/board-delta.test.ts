import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockPostgres,
  queueResult,
  setConfigured,
  callsContaining,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));
// Passthrough cache mock — records registrations/calls; no cache semantics.
// Needed so the `lists: true` path (loadOrderIdSetsCached) runs deterministically
// under vitest, and so the bootstrap-coalescing tests can pin routing + config.
vi.mock('next/cache', () => import('./helpers/mock-next-cache'));

import { resetCacheCalls } from './helpers/mock-next-cache';
import { loadBoardDelta, ordersCutoffId, BoardDeltaError } from '@/lib/board-delta';

describe('loadBoardDelta', () => {
  beforeEach(() => {
    resetMockPostgres();
    resetCacheCalls();
  });

  it('throws BoardDeltaError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadBoardDelta(null)).rejects.toBeInstanceOf(BoardDeltaError);
  });

  describe('full snapshot (since = null)', () => {
    it('returns only active jobs (phase2_deleted_at IS NULL) + all orders', async () => {
      const job = { id: 1001, name: 'job-A', dept: 'graphic' };
      const order = { id: 202605100, name: 'order-A', status: 'sent' };
      queueResult({ rows: [{ raw: job }], rowCount: 1 });
      queueResult({ rows: [{ raw: order }], rowCount: 1 });

      const r = await loadBoardDelta(null);

      expect(r.jobs).toEqual([job]);
      expect(r.orders).toEqual([order]);
      expect(r.deletedJobIds).toEqual([]);
      expect(r.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('filters tombstoned jobs from the full snapshot', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      await loadBoardDelta(null);
      // Active-only filter on jobs — board UI never renders tombstones.
      // (The windowed orders query also mentions the filter inside its
      // active-job subquery, so pin the top-level jobs query specifically.)
      const jobsCall = callsContaining('SELECT raw FROM jobs')[0];
      expect(jobsCall.text).toContain('phase2_deleted_at IS NULL');
      // No delta filter when bootstrapping (would lose pre-cursor rows)
      expect(callsContaining('updated_at >')).toHaveLength(0);
    });

    it('does not issue the tombstone query on full snapshot', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      await loadBoardDelta(null);
      // Tombstones are irrelevant on bootstrap — client has no prior state
      // to delete from. Save a Postgres round-trip.
      expect(callsContaining('phase2_deleted_at >')).toHaveLength(0);
    });
  });

  describe('delta (since = cursor)', () => {
    it('queries jobs/orders by updated_at + reports tombstoned IDs', async () => {
      const changedJob = { id: 1001, name: 'job-A' };
      const changedOrder = { id: 202605100, name: 'order-A' };
      queueResult({ rows: [{ raw: changedJob }], rowCount: 1 });
      queueResult({ rows: [{ raw: changedOrder }], rowCount: 1 });
      queueResult({ rows: [{ id: '999' }, { id: '998' }], rowCount: 2 });

      const since = new Date('2026-05-20T10:00:00.000Z');
      const r = await loadBoardDelta(since);

      expect(r.jobs).toEqual([changedJob]);
      expect(r.orders).toEqual([changedOrder]);
      expect(r.deletedJobIds).toEqual([999, 998]);
    });

    it('uses updated_at cursor + active filter on jobs query', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));

      // Active-changes query: updated_at filter AND tombstone-excluded.
      // Without the second condition, restored-then-deleted rows would appear
      // in both `jobs` and `deletedJobIds` (client merge would race).
      const jobsActive = callsContaining('FROM jobs')[0];
      expect(jobsActive.text).toContain('updated_at >');
      expect(jobsActive.text).toContain('phase2_deleted_at IS NULL');

      // Tombstone query — distinct from active-changes query
      const tombstones = callsContaining('phase2_deleted_at >');
      expect(tombstones).toHaveLength(1);

      // Orders only has updated_at cursor (no tombstone concept on orders)
      expect(callsContaining('FROM orders')[0].text).toContain('updated_at >');
    });

    it('binds the cursor as a parameter (no inline interpolation)', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      const since = new Date('2026-05-20T10:00:00.000Z');
      await loadBoardDelta(since);

      // ISO string lands in `values`, not in the SQL text — defense in depth
      // even though all callsites already pre-validate to a Date object.
      const jobsCall = sqlCalls.find((c) => c.text.includes('FROM jobs') && c.text.includes('updated_at >'));
      expect(jobsCall!.values).toContain('2026-05-20T10:00:00.000Z');
    });

    it('coerces deletedJobIds from Postgres text to JS numbers', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      // We cast to ::text in the query to avoid JS BigInt issues — coerce
      // back here so the client gets plain numbers it can === against
      // Job.id (which is number).
      queueResult({ rows: [{ id: '12345' }], rowCount: 1 });

      const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      expect(r.deletedJobIds).toEqual([12345]);
      expect(typeof r.deletedJobIds[0]).toBe('number');
    });

    it('serverTime is captured before queries (write-during-query is in next delta)', async () => {
      // A write landing AFTER serverTime is captured but BEFORE the SELECT
      // commits would otherwise be lost (its updated_at > serverTime means
      // it falls outside this delta, AND it falls outside the next one
      // because cursor advances to serverTime). We snapshot serverTime
      // FIRST so the next cursor is older than the row → row is included
      // next tick.
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      const before = new Date().toISOString();
      const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      const after = new Date().toISOString();
      expect(r.serverTime >= before).toBe(true);
      expect(r.serverTime <= after).toBe(true);
    });
  });

  describe('fullLists (since = null bootstrap)', () => {
    it('returns full shipped + cancelled rows + derived ID sets', async () => {
      const job = { id: 1001, name: 'job' };
      const order = { id: 202605100, name: 'order' };
      const shipped = { id: 5001, name: 'ship-A', shippedDate: '2026-05-01', orderId: 202605100 };
      const cancelled = { id: 6001, name: 'cx-A', dept: 'graphic', orderId: 202605101 };
      // fullLists queries are evaluated synchronously by Promise.all BEFORE
      // the main jobs/orders Promise.all body — queue in execution order.
      queueResult({ rows: [{ raw: shipped }], rowCount: 1 });     // shipped full
      queueResult({ rows: [{ raw: cancelled }], rowCount: 1 });   // cancelled full
      queueResult({ rows: [{ raw: job }], rowCount: 1 });         // jobs
      queueResult({ rows: [{ raw: order }], rowCount: 1 });       // orders

      const r = await loadBoardDelta(null, { fullLists: true });

      expect(r.shipped).toEqual([shipped]);
      expect(r.cancelled).toEqual([cancelled]);
      expect(r.shippedAllIds).toEqual([5001]);
      expect(r.cancelledAllIds).toEqual([6001]);
      // shippedOrderIds/cancelledOrderIds intentionally NOT derived in
      // fullLists mode — see board-delta.ts for why.
      expect(r.shippedOrderIds).toBeUndefined();
      expect(r.cancelledOrderIds).toBeUndefined();
    });

    it('does NOT issue the cheap orderIds queries when fullLists wins over lists', async () => {
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      queueResult({ rows: [], rowCount: 0 }); // shipped full
      queueResult({ rows: [], rowCount: 0 }); // cancelled full

      await loadBoardDelta(null, { lists: true, fullLists: true });

      // The DISTINCT order_id queries are skipped — fullLists supersedes lists.
      expect(callsContaining('SELECT DISTINCT order_id')).toHaveLength(0);
    });
  });

  describe('fullLists (since = cursor incremental)', () => {
    it('withIds: returns rows added since cursor + current PK ID set for delete detection', async () => {
      const newShip = { id: 5002, name: 'ship-B', shippedDate: '2026-05-20', orderId: 202605200 };
      // fullLists queries fire first (Promise.all evaluates array synchronously)
      queueResult({ rows: [{ raw: newShip }], rowCount: 1 });              // shipped imported_at > since
      queueResult({ rows: [], rowCount: 0 });                              // cancelled imported_at > since
      queueResult({ rows: [{ id: '5001' }, { id: '5002' }], rowCount: 2 }); // current shipped IDs
      queueResult({ rows: [{ id: '6001' }], rowCount: 1 });                 // current cancelled IDs
      queueResult({ rows: [], rowCount: 0 });                              // stats
      queueResult({ rows: [], rowCount: 0 });                              // jobs incr
      queueResult({ rows: [], rowCount: 0 });                              // orders incr
      queueResult({ rows: [], rowCount: 0 });                              // tombstoned jobs

      const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'), { fullLists: true, withIds: true });

      expect(r.shipped).toEqual([newShip]);
      expect(r.cancelled).toEqual([]);
      expect(r.shippedAllIds).toEqual([5001, 5002]);
      expect(r.cancelledAllIds).toEqual([6001]);
    });

    it('uses imported_at cursor on the shipped + cancelled incremental queries', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'), { fullLists: true });

      // Incremental shipped/cancelled queries pivot on imported_at (the
      // only timestamp column on those tables — they have no updated_at).
      const shippedIncr = callsContaining('FROM shipped').find((c) => c.text.includes('imported_at >'));
      const cancelledIncr = callsContaining('FROM cancelled').find((c) => c.text.includes('imported_at >'));
      expect(shippedIncr).toBeDefined();
      expect(cancelledIncr).toBeDefined();
    });

    // M-fulllists-id-array-every-poll: the default incremental poll must not
    // scan + ship the full PK id arrays of both tables every 15-30s — that
    // payload grows linearly forever. It ships one cheap stats row instead
    // ({count, maxId} per table, same LIST_WINDOW as the bootstrap); the
    // client requests ?ids=1 only when the checks disagree with its state.
    describe('checks instead of full id arrays (M-fulllists-id-array-every-poll)', () => {
      it('default: no full id-list queries — ships windowed COUNT+MAX checks', async () => {
        queueResult({ rows: [], rowCount: 0 });                            // shipped incr
        queueResult({ rows: [], rowCount: 0 });                            // cancelled incr
        queueResult({
          rows: [{ shipped_count: '2', shipped_max: '5002', cancelled_count: '1', cancelled_max: '6001' }],
          rowCount: 1,
        });                                                                // stats
        queueResult({ rows: [], rowCount: 0 });                            // jobs incr
        queueResult({ rows: [], rowCount: 0 });                            // orders incr
        queueResult({ rows: [], rowCount: 0 });                            // tombstones

        const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'), { fullLists: true });

        // full id-list scans are gone from the default poll
        expect(callsContaining('SELECT id::text AS id FROM shipped')).toHaveLength(0);
        expect(callsContaining('SELECT id::text AS id FROM cancelled')).toHaveLength(0);
        // one stats round-trip, windowed like everything else list-shaped
        const stats = callsContaining('COUNT(*)');
        expect(stats).toHaveLength(1);
        expect(stats[0].text).toContain('MAX(id)');
        expect(stats[0].text).toContain('imported_at > NOW() -');
        expect(stats[0].values).toContain('12 months');
        // coerced to plain numbers for the client
        expect(r.shippedCheck).toEqual({ count: 2, maxId: 5002 });
        expect(r.cancelledCheck).toEqual({ count: 1, maxId: 6001 });
        expect(r.shippedAllIds).toBeUndefined();
        expect(r.cancelledAllIds).toBeUndefined();
      });

      it('withIds: id-list queries are windowed by imported_at (match the checks)', async () => {
        queueResult({ rows: [], rowCount: 0 });                            // shipped incr
        queueResult({ rows: [], rowCount: 0 });                            // cancelled incr
        queueResult({ rows: [], rowCount: 0 });                            // shipped ids
        queueResult({ rows: [], rowCount: 0 });                            // cancelled ids
        queueResult({ rows: [], rowCount: 0 });                            // stats
        await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'), { fullLists: true, withIds: true });
        const idCalls = [
          ...callsContaining('SELECT id::text AS id FROM shipped'),
          ...callsContaining('SELECT id::text AS id FROM cancelled'),
        ];
        expect(idCalls).toHaveLength(2);
        for (const call of idCalls) {
          expect(call.text).toContain('imported_at > NOW() -');
          expect(call.values).toContain('12 months');
        }
      });

      it('coerces a NULL MAX(id) (empty windowed table) to 0', async () => {
        queueResult({ rows: [], rowCount: 0 });                            // shipped incr
        queueResult({ rows: [], rowCount: 0 });                            // cancelled incr
        queueResult({
          rows: [{ shipped_count: '0', shipped_max: null, cancelled_count: '0', cancelled_max: null }],
          rowCount: 1,
        });                                                                // stats
        const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'), { fullLists: true });
        expect(r.shippedCheck).toEqual({ count: 0, maxId: 0 });
        expect(r.cancelledCheck).toEqual({ count: 0, maxId: 0 });
      });

      it('bootstrap: derives ids from rows — no stats query, no id-list queries', async () => {
        queueResult({ rows: [], rowCount: 0 }); // shipped full
        queueResult({ rows: [], rowCount: 0 }); // cancelled full
        queueResult({ rows: [], rowCount: 0 }); // jobs
        queueResult({ rows: [], rowCount: 0 }); // orders
        const r = await loadBoardDelta(null, { fullLists: true });
        expect(callsContaining('COUNT(*)')).toHaveLength(0);
        expect(callsContaining('SELECT id::text AS id FROM shipped')).toHaveLength(0);
        expect(r.shippedCheck).toBeUndefined();
      });
    });
  });

  // PERF-H2/M2: board/orders delta must NOT ship the heavy `rawData`/`details`
  // spec blobs on every order. The list + board only display top-level fields
  // plus `pin` (shown in the /orders row) and `hasSpec` (drives the board
  // card's "สเปคงาน" tab visibility). The full spec is lazy-fetched via
  // /api/orders/raw/[id] when a detail modal or edit form opens.
  describe('slim orders payload (PERF-H2/M2)', () => {
    it('bootstrap: orders query strips rawData/details and projects pin + hasSpec', async () => {
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      await loadBoardDelta(null);
      const ordersCall = callsContaining('FROM orders')[0];
      expect(ordersCall.text).toContain("- 'rawData'");
      expect(ordersCall.text).toContain("- 'details'");
      expect(ordersCall.text).toContain('pin');
      expect(ordersCall.text).toContain('hasSpec');
    });

    it('incremental: orders query also ships the slim projection', async () => {
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      queueResult({ rows: [], rowCount: 0 }); // tombstones
      await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      const ordersCall = callsContaining('FROM orders')[0];
      expect(ordersCall.text).toContain("- 'rawData'");
      expect(ordersCall.text).toContain('hasSpec');
    });
  });

  // M-bootstrap-orders-unbounded: bootstrap payload must stop growing linearly
  // with table size. Orders are windowed AT THE DB to ~12 months (by the
  // YYYYMM-encoded PK) UNION orders still referenced by an active job, so
  // /board cards + /calendar lookups always resolve. shipped/cancelled full
  // rows + the /orders orderId sets share the SAME 12-month window
  // (imported_at) — an order inside the window ships/cancels inside the
  // window too (event follows creation), so /orders status badges + orphan
  // detection stay consistent across the three windowed pieces.
  describe('windowed bootstrap (M-bootstrap-orders-unbounded)', () => {
    describe('ordersCutoffId', () => {
      it('returns YYYYMM*1000 of the same month last year (Bangkok)', () => {
        expect(ordersCutoffId(new Date('2026-07-24T05:00:00.000Z'))).toBe(202507000);
        expect(ordersCutoffId(new Date('2026-01-15T10:00:00.000Z'))).toBe(202501000);
      });

      it('uses the Bangkok calendar month when it is ahead of UTC', () => {
        // 2026-07-31 17:30 UTC = 2026-08-01 00:30 Bangkok → cutoff rolls to 08
        expect(ordersCutoffId(new Date('2026-07-31T17:30:00.000Z'))).toBe(202508000);
      });
    });

    it('bootstrap orders: windowed to cutoff id OR referenced by an active job', async () => {
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      await loadBoardDelta(null);
      const ordersCall = callsContaining('FROM orders')[0];
      expect(ordersCall.text).toContain('id >=');
      // active-job union — orders referenced by a live job never age out
      expect(ordersCall.text).toContain('order_id FROM jobs');
      expect(ordersCall.text).toContain('phase2_deleted_at IS NULL AND order_id IS NOT NULL');
      expect(ordersCall.values).toContain(ordersCutoffId());
    });

    it('incremental orders: NOT windowed (cursor already bounds the rows)', async () => {
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      queueResult({ rows: [], rowCount: 0 }); // tombstones
      await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      const ordersCall = callsContaining('FROM orders')[0];
      expect(ordersCall.text).not.toContain('id >=');
    });

    it('fullLists bootstrap: shipped + cancelled rows windowed by imported_at', async () => {
      queueResult({ rows: [], rowCount: 0 }); // shipped full
      queueResult({ rows: [], rowCount: 0 }); // cancelled full
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      await loadBoardDelta(null, { fullLists: true });
      const shippedCall = callsContaining('FROM shipped')[0];
      const cancelledCall = callsContaining('FROM cancelled')[0];
      expect(shippedCall.text).toContain('imported_at > NOW() -');
      expect(shippedCall.values).toContain('12 months');
      expect(cancelledCall.text).toContain('imported_at > NOW() -');
      expect(cancelledCall.values).toContain('12 months');
    });

    it('lists sets: DISTINCT order_id windowed by imported_at (same window)', async () => {
      queueResult({ rows: [], rowCount: 0 }); // sets shipped
      queueResult({ rows: [], rowCount: 0 }); // sets cancelled
      queueResult({ rows: [], rowCount: 0 }); // jobs
      queueResult({ rows: [], rowCount: 0 }); // orders
      await loadBoardDelta(null, { lists: true });
      const setCalls = callsContaining('SELECT DISTINCT order_id');
      expect(setCalls).toHaveLength(2);
      for (const c of setCalls) {
        expect(c.text).toContain('imported_at > NOW() -');
        expect(c.values).toContain('12 months');
      }
    });
  });
});
