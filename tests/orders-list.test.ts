import { describe, it, expect } from 'vitest';
import { computeOrdersList } from '@/lib/orders-list';
import type { Job, Order } from '@/lib/types';

function order(id: number, partial: Partial<Order> = {}): Order {
  return {
    id, name: `order-${id}`, customer: 'CustA', dateIn: '', dateDue: '',
    price: 0, assignDept: '', assignStaff: '', orderer: '', status: 'sent',
    ...partial,
  };
}
function job(id: number, orderId: number, partial: Partial<Job> = {}): Job {
  return {
    id, name: `order-${orderId}`, date: '', dateIn: '', staff: 'mo',
    dept: 'graphic', status: 'pending', orderId, ...partial,
  };
}
const noFilter = { query: '', statusFilter: '', fromIso: '', toIso: '' };

describe('computeOrdersList', () => {
  it('enriches a sent order with an active job — not an orphan', () => {
    const r = computeOrdersList(
      { orders: [order(1)], jobs: [job(50, 1)], shippedOrderIds: [], cancelledOrderIds: [] },
      noFilter,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].isOrphan).toBe(false);
    expect(r.rows[0].orderStatus).toBe('sent');
    expect(r.orphans).toHaveLength(0);
  });

  it('flags a sent order with no job anywhere as an orphan', () => {
    const r = computeOrdersList(
      { orders: [order(1)], jobs: [], shippedOrderIds: [], cancelledOrderIds: [] },
      noFilter,
    );
    expect(r.rows[0].isOrphan).toBe(true);
    expect(r.orphans.map((x) => x.id)).toEqual([1]);
  });

  it('marks a sent order shipped when its id is in shippedOrderIds (cross-ref)', () => {
    // The core reason /orders delta needs the shipped set: order.status is
    // still "sent" but all its jobs have already moved to the shipped table.
    const r = computeOrdersList(
      { orders: [order(1, { status: 'sent' })], jobs: [], shippedOrderIds: [1], cancelledOrderIds: [] },
      noFilter,
    );
    expect(r.rows[0].orderStatus).toBe('shipped');
    expect(r.rows[0].isOrphan).toBe(false); // shipped ≠ orphan
  });

  it('marks an order cancelled when its id is in cancelledOrderIds', () => {
    const r = computeOrdersList(
      { orders: [order(1, { status: 'sent' })], jobs: [], shippedOrderIds: [], cancelledOrderIds: [1] },
      noFilter,
    );
    expect(r.rows[0].orderStatus).toBe('cancelled');
  });

  it('filters by status and reports the pre-filter total', () => {
    const r = computeOrdersList(
      {
        orders: [order(1, { status: 'sent' }), order(2, { status: 'draft' })],
        jobs: [job(50, 1)],
        shippedOrderIds: [], cancelledOrderIds: [],
      },
      { ...noFilter, statusFilter: 'draft' },
    );
    expect(r.rows.map((x) => x.id)).toEqual([2]);
    expect(r.totalCount).toBe(2);
  });

  it('filters by free-text query against name / customer / id', () => {
    const r = computeOrdersList(
      {
        orders: [order(1, { customer: 'Penprint' }), order(2, { customer: 'อื่น' })],
        jobs: [job(50, 1), job(51, 2)],
        shippedOrderIds: [], cancelledOrderIds: [],
      },
      { ...noFilter, query: 'penprint' },
    );
    expect(r.rows.map((x) => x.id)).toEqual([1]);
  });

  it('surfaces pin from the top-level slim field (not from rawData)', () => {
    // PERF-H2/M2: the slim board-delta loader projects `pin` to the top level
    // so the /orders row can show it without shipping the full rawData spec.
    const r = computeOrdersList(
      { orders: [order(1, { pin: '4821' })], jobs: [job(50, 1)], shippedOrderIds: [], cancelledOrderIds: [] },
      noFilter,
    );
    expect(r.rows[0].pin).toBe('4821');
  });

  it('leaves row.rawData null so the detail modal lazy-fetches the full spec', () => {
    const r = computeOrdersList(
      { orders: [order(1, { pin: '4821' })], jobs: [job(50, 1)], shippedOrderIds: [], cancelledOrderIds: [] },
      noFilter,
    );
    expect(r.rows[0].rawData).toBeNull();
  });

  it('groups jobs with the same orderId+name into a duplicate group', () => {
    const r = computeOrdersList(
      {
        orders: [order(1)],
        jobs: [job(50, 1), job(51, 1)], // same orderId + same name
        shippedOrderIds: [], cancelledOrderIds: [],
      },
      noFilter,
    );
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].orderId).toBe(1);
    expect(r.duplicates[0].rows.map((x) => x.id)).toEqual([51, 50]); // newest first
  });
});
