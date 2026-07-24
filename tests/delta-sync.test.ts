import { describe, it, expect } from 'vitest';
import { mergeDelta, fullListsStale, type DeltaState } from '@/lib/delta-sync';
import type { BoardDelta } from '@/lib/board-delta';
import type { Job, Order, Shipped, Cancelled } from '@/lib/types';

/** Minimal Job factory — only the id matters for merge identity. */
function j(id: number, name = `job-${id}`): Job {
  return { id, name, date: '', dateIn: '', staff: '', dept: 'graphic', status: '' };
}
/** Minimal Order factory. */
function o(id: number, name = `order-${id}`): Order {
  return {
    id, name, customer: '', dateIn: '', dateDue: '', price: 0,
    assignDept: '', assignStaff: '', orderer: '', status: '',
  };
}
/** Minimal Shipped factory. */
function s(id: number, name = `shipped-${id}`): Shipped {
  return { id, name, shippedDate: '', orderId: null };
}
/** Minimal Cancelled factory. */
function c(id: number, name = `cancelled-${id}`): Cancelled {
  return {
    id, name, dept: '', staff: '', cancelledBy: '', cancelledAt: '',
    reason: '', orderId: null,
  };
}
/** DeltaState factory — fills all list defaults. */
function st(partial: Partial<DeltaState>): DeltaState {
  return {
    jobs: [], orders: [],
    shippedOrderIds: [], cancelledOrderIds: [],
    shipped: [], cancelled: [],
    ...partial,
  };
}
function delta(partial: Partial<BoardDelta>): BoardDelta {
  return {
    jobs: [], orders: [], deletedJobIds: [],
    serverTime: '2026-05-21T00:00:00.000Z',
    ...partial,
  };
}

describe('mergeDelta', () => {
  it('returns the SAME state reference on a no-op delta (closes PA-M2)', () => {
    const state = st({ jobs: [j(1)], orders: [o(100)] });
    const result = mergeDelta(state, delta({}));
    // Identity — a no-change poll must not trigger a board re-render.
    expect(result).toBe(state);
  });

  it('upserts a changed job in place (same id → replace)', () => {
    const state = st({ jobs: [j(1, 'old'), j(2)], orders: [] });
    const result = mergeDelta(state, delta({ jobs: [j(1, 'new')] }));
    expect(result).not.toBe(state);
    expect(result.jobs.find((x) => x.id === 1)?.name).toBe('new');
    expect(result.jobs).toHaveLength(2);
  });

  it('adds a brand-new job', () => {
    const state = st({ jobs: [j(1)], orders: [] });
    const result = mergeDelta(state, delta({ jobs: [j(5)] }));
    expect(result.jobs.map((x) => x.id)).toEqual([1, 5]);
  });

  it('removes tombstoned job ids', () => {
    const state = st({ jobs: [j(1), j(2), j(3)], orders: [] });
    const result = mergeDelta(state, delta({ deletedJobIds: [2] }));
    expect(result.jobs.map((x) => x.id)).toEqual([1, 3]);
  });

  it('ignores a tombstone for an id not in state (idempotent)', () => {
    const state = st({ jobs: [j(1)], orders: [] });
    const result = mergeDelta(state, delta({ deletedJobIds: [999] }));
    expect(result.jobs.map((x) => x.id)).toEqual([1]);
  });

  it('keeps jobs sorted ascending by id after a merge', () => {
    const state = st({ jobs: [j(10), j(30)], orders: [] });
    const result = mergeDelta(state, delta({ jobs: [j(20), j(5)] }));
    expect(result.jobs.map((x) => x.id)).toEqual([5, 10, 20, 30]);
  });

  it('keeps orders sorted descending by id after a merge', () => {
    const state = st({ jobs: [], orders: [o(300), o(100)] });
    const result = mergeDelta(state, delta({ orders: [o(200), o(400)] }));
    expect(result.orders.map((x) => x.id)).toEqual([400, 300, 200, 100]);
  });

  it('upserts a changed order in place', () => {
    const state = st({ jobs: [], orders: [o(100, 'old')] });
    const result = mergeDelta(state, delta({ orders: [o(100, 'new')] }));
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].name).toBe('new');
  });

  it('leaves the jobs array reference untouched when only orders change', () => {
    const state = st({ jobs: [j(1)], orders: [o(100)] });
    const result = mergeDelta(state, delta({ orders: [o(200)] }));
    expect(result.jobs).toBe(state.jobs);
    expect(result.orders).not.toBe(state.orders);
  });

  it('leaves the orders array reference untouched when only jobs change', () => {
    const state = st({ jobs: [j(1)], orders: [o(100)] });
    const result = mergeDelta(state, delta({ jobs: [j(2)] }));
    expect(result.orders).toBe(state.orders);
    expect(result.jobs).not.toBe(state.jobs);
  });

  it('handles a combined delta — job change + new order + tombstone', () => {
    const state = st({
      jobs: [j(1, 'old'), j(2), j(3)],
      orders: [o(100)],
    });
    const result = mergeDelta(state, delta({
      jobs: [j(1, 'new'), j(4)],
      orders: [o(200)],
      deletedJobIds: [3],
    }));
    expect(result.jobs.map((x) => x.id)).toEqual([1, 2, 4]);
    expect(result.jobs.find((x) => x.id === 1)?.name).toBe('new');
    expect(result.orders.map((x) => x.id)).toEqual([200, 100]);
  });

  it('applies upsert before delete when the same id appears in both buckets', () => {
    // Defensive: loadBoardDelta's IS NULL / IS NOT NULL split makes this
    // mutually exclusive, but the merge must still be deterministic — a
    // tombstoned id wins (job is gone).
    const state = st({ jobs: [j(1)], orders: [] });
    const result = mergeDelta(state, delta({
      jobs: [j(1, 'resurrected')],
      deletedJobIds: [1],
    }));
    expect(result.jobs).toHaveLength(0);
  });
});

describe('mergeDelta — shipped/cancelled orderId lists (/orders delta)', () => {
  it('keeps the SAME state ref when lists are carried but unchanged', () => {
    const state = st({
      jobs: [j(1)], orders: [o(100)],
      shippedOrderIds: [10, 20], cancelledOrderIds: [30],
    });
    const result = mergeDelta(state, delta({ shippedOrderIds: [10, 20], cancelledOrderIds: [30] }));
    expect(result).toBe(state);
  });

  it('updates shippedOrderIds (and a new state ref) when it changed', () => {
    const state = st({ shippedOrderIds: [10] });
    const result = mergeDelta(state, delta({ shippedOrderIds: [10, 20], cancelledOrderIds: [] }));
    expect(result).not.toBe(state);
    expect(result.shippedOrderIds).toEqual([10, 20]);
  });

  it('keeps the existing shippedOrderIds ref when only cancelled changed', () => {
    const state = st({ shippedOrderIds: [10], cancelledOrderIds: [30] });
    const result = mergeDelta(state, delta({ shippedOrderIds: [10], cancelledOrderIds: [30, 40] }));
    expect(result.shippedOrderIds).toBe(state.shippedOrderIds);
    expect(result.cancelledOrderIds).toEqual([30, 40]);
  });

  it('leaves lists untouched for a /board-style delta that omits them', () => {
    // /board + /calendar polls never request ?lists=1 → delta carries no
    // shippedOrderIds; a state holding lists must keep them + stay ref-stable.
    const state = st({ jobs: [j(1)], shippedOrderIds: [10], cancelledOrderIds: [30] });
    const result = mergeDelta(state, delta({}));
    expect(result).toBe(state);
  });
});

describe('mergeDelta — full shipped/cancelled rows (/shipped + /cancelled delta)', () => {
  it('appends a new shipped row on an incremental delta', () => {
    const state = st({ shipped: [s(100)], cancelled: [] });
    const result = mergeDelta(state, delta({
      shipped: [s(101)],
      shippedAllIds: [100, 101],
      cancelled: [],
      cancelledAllIds: [],
    }));
    expect(result).not.toBe(state);
    expect(result.shipped.map((x) => x.id)).toEqual([101, 100]); // id-desc sort
  });

  it('drops a shipped row when allowedIds no longer contains it (restore)', () => {
    // Admin /restore deletes the shipped row + reinserts the job → next delta
    // shows the job in jobs[], and shippedAllIds omits the gone id.
    const state = st({ shipped: [s(100), s(101)], cancelled: [] });
    const result = mergeDelta(state, delta({
      shipped: [],
      shippedAllIds: [101],
      cancelled: [],
      cancelledAllIds: [],
    }));
    expect(result.shipped.map((x) => x.id)).toEqual([101]);
  });

  it('returns the SAME shipped ref when allowedIds matches state', () => {
    // The hot path: idle poll, server returns full ID list but nothing
    // changed. mergeDelta must not allocate a new array (would re-render
    // the table even though nothing visible moved).
    const state = st({ shipped: [s(100), s(101)], cancelled: [c(50)] });
    const result = mergeDelta(state, delta({
      shipped: [],
      shippedAllIds: [100, 101],
      cancelled: [],
      cancelledAllIds: [50],
    }));
    expect(result.shipped).toBe(state.shipped);
    expect(result.cancelled).toBe(state.cancelled);
    expect(result).toBe(state); // entire state ref preserved
  });

  it('upserts a changed shipped row (same id replaces)', () => {
    const state = st({ shipped: [s(100, 'old')], cancelled: [] });
    const result = mergeDelta(state, delta({
      shipped: [s(100, 'new')],
      shippedAllIds: [100],
      cancelled: [],
      cancelledAllIds: [],
    }));
    expect(result.shipped[0].name).toBe('new');
    expect(result.shipped).toHaveLength(1);
  });

  it('processes a cancelled-row restore the same way as shipped', () => {
    const state = st({ cancelled: [c(80), c(90)] });
    const result = mergeDelta(state, delta({
      cancelled: [],
      cancelledAllIds: [80],
      shipped: [],
      shippedAllIds: [],
    }));
    expect(result.cancelled.map((x) => x.id)).toEqual([80]);
  });

  it('leaves shipped/cancelled untouched when delta omits the fullLists fields', () => {
    // /board /calendar /orders never request fullLists → delta has no
    // shippedAllIds; a state holding the rows must keep them + stay ref-stable.
    const state = st({
      jobs: [j(1)],
      shipped: [s(100)],
      cancelled: [c(80)],
    });
    const result = mergeDelta(state, delta({}));
    expect(result).toBe(state);
  });

  it('handles a combined fullLists delta — new shipped + restored cancelled', () => {
    const state = st({
      shipped: [s(100)],
      cancelled: [c(80), c(81)],
    });
    const result = mergeDelta(state, delta({
      shipped: [s(102)],
      shippedAllIds: [100, 102],
      cancelled: [],
      cancelledAllIds: [80],
    }));
    expect(result.shipped.map((x) => x.id)).toEqual([102, 100]);
    expect(result.cancelled.map((x) => x.id)).toEqual([80]);
  });
});

// M-fulllists-id-array-every-poll: the incremental fullLists poll no longer
// ships the full PK id arrays — it ships cheap {count, maxId} checks. New
// rows still arrive via the imported_at cursor and must be UPSERTED even
// without an id set; hard-deletes are detected by comparing the checks
// against the merged state (fullListsStale), which triggers ONE reconcile
// poll carrying ?ids=1 (the old full-array shape).
describe('mergeDelta — fullLists rows WITHOUT allIds (checks protocol)', () => {
  it('upserts new rows when the delta carries rows but no id set', () => {
    const state = st({ shipped: [s(100)], cancelled: [c(80)] });
    const result = mergeDelta(state, delta({
      shipped: [s(102), s(100, 'updated')],
      cancelled: [],
    }));
    expect(result.shipped.map((x) => x.id)).toEqual([102, 100]);
    expect(result.shipped[1].name).toBe('updated');
    // no id set → nothing may be dropped
    expect(result.cancelled).toBe(state.cancelled);
  });

  it('keeps the SAME state ref on an idle poll (empty rows, checks only)', () => {
    const state = st({ shipped: [s(100)], cancelled: [c(80)] });
    const result = mergeDelta(state, delta({
      shipped: [],
      cancelled: [],
      shippedCheck: { count: 1, maxId: 100 },
      cancelledCheck: { count: 1, maxId: 80 },
    }));
    expect(result).toBe(state);
  });
});

describe('fullListsStale', () => {
  it('false when the delta carries no checks (/board-style delta)', () => {
    const state = st({ shipped: [s(100)] });
    expect(fullListsStale(state, delta({}))).toBe(false);
  });

  it('false when count + maxId both match the merged state', () => {
    const state = st({ shipped: [s(100), s(102)], cancelled: [c(80)] });
    expect(fullListsStale(state, delta({
      shippedCheck: { count: 2, maxId: 102 },
      cancelledCheck: { count: 1, maxId: 80 },
    }))).toBe(false);
  });

  it('true when the server count is lower (hard-delete from /restore)', () => {
    const state = st({ shipped: [s(100), s(102)], cancelled: [c(80)] });
    expect(fullListsStale(state, delta({
      shippedCheck: { count: 2, maxId: 102 },
      cancelledCheck: { count: 0, maxId: 0 },
    }))).toBe(true);
  });

  it('true when maxId disagrees even at equal counts', () => {
    // delete-oldest + add-newest between polls where the add was missed is
    // the pathological shape count alone cannot see.
    const state = st({ shipped: [s(100), s(102)] });
    expect(fullListsStale(state, delta({
      shippedCheck: { count: 2, maxId: 103 },
    }))).toBe(true);
  });

  it('treats an empty list vs zero-check as clean', () => {
    const state = st({});
    expect(fullListsStale(state, delta({
      shippedCheck: { count: 0, maxId: 0 },
      cancelledCheck: { count: 0, maxId: 0 },
    }))).toBe(false);
  });
});
