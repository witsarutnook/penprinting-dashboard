import { describe, it, expect } from 'vitest';
import { mergeDelta, type DeltaState } from '@/lib/delta-sync';
import type { BoardDelta } from '@/lib/board-delta';
import type { Job, Order } from '@/lib/types';

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
/** DeltaState factory — fills the shipped/cancelled list defaults. */
function st(partial: Partial<DeltaState>): DeltaState {
  return { jobs: [], orders: [], shippedOrderIds: [], cancelledOrderIds: [], ...partial };
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
