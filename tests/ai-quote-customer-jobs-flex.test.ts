import { describe, it, expect } from 'vitest';
import { buildCustomerJobsFlex } from '@/lib/ai-quote/customer-jobs-flex';
import type { CustomerJob } from '@/lib/customer-track';

const job = (over: Partial<CustomerJob> = {}): CustomerJob => ({
  orderId: 100, name: 'ใบปลิว', customer: 'บ.เอ', dateIn: '01/07/2026', dateDue: '10/07/2026',
  kind: 'in_progress', currentDept: 'print', awaitingShipment: false, daysLeft: 9, ...over,
});

describe('buildCustomerJobsFlex', () => {
  it('renders a flex bubble with altText counting the jobs', () => {
    const flex = buildCustomerJobsFlex([job({ orderId: 100 }), job({ orderId: 101, name: 'นามบัตร' })]);
    expect(flex).toMatchObject({ type: 'flex' });
    expect(String(flex.altText)).toContain('2');
  });

  it('includes each order number in the serialized bubble', () => {
    const flex = buildCustomerJobsFlex([job({ orderId: 100 }), job({ orderId: 101 })]);
    const json = JSON.stringify(flex);
    expect(json).toContain('#100');
    expect(json).toContain('#101');
  });

  it('shows an overdue hint for negative daysLeft', () => {
    const flex = buildCustomerJobsFlex([job({ daysLeft: -3 }), job({ orderId: 101 })]);
    expect(JSON.stringify(flex)).toContain('เลยกำหนด 3 วัน');
  });
});
