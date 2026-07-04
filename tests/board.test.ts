import { describe, it, expect } from 'vitest';
import { computeBoard } from '@/lib/board';
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

describe('computeBoard — OrderSummary.hasSpec (PERF-H2/M2)', () => {
  it('maps the slim order.hasSpec flag onto the job OrderSummary', () => {
    const snap = computeBoard({ orders: [order(1, { hasSpec: true })], jobs: [job(50, 1)] });
    const j = snap.allJobs.find((x) => x.orderId === 1);
    expect(j?.order?.hasSpec).toBe(true);
  });

  it('hasSpec is false when the slim order reports no spec', () => {
    const snap = computeBoard({ orders: [order(1, { hasSpec: false })], jobs: [job(50, 1)] });
    const j = snap.allJobs.find((x) => x.orderId === 1);
    expect(j?.order?.hasSpec).toBe(false);
  });
});
