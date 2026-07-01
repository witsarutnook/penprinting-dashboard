import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/postgres', () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

import { loadActiveJobsByCustomer } from '@/lib/customer-track';

beforeEach(() => sqlMock.mockReset());

const row = (over: Record<string, unknown> = {}) => ({
  order_id: 1,
  order_raw: { id: 1, name: 'ใบปลิว A', customer: 'บ.เอ', dateIn: '01/07/2026', dateDue: '10/07/2026', ...(over.order_raw as object ?? {}) },
  job_raw: { dept: 'print', date: '10/07/2026', ...(over.job_raw as object ?? {}) },
  ...over,
});

describe('loadActiveJobsByCustomer', () => {
  it('returns [] without querying when names is empty', async () => {
    const jobs = await loadActiveJobsByCustomer([]);
    expect(jobs).toEqual([]);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('maps rows to CustomerJob with derived status', async () => {
    sqlMock.mockResolvedValue({ rows: [row()] });
    const jobs = await loadActiveJobsByCustomer(['บ.เอ']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ orderId: 1, name: 'ใบปลิว A', customer: 'บ.เอ', currentDept: 'print', kind: 'in_progress' });
  });

  it('filters by keyword against name OR customer (case-insensitive)', async () => {
    sqlMock.mockResolvedValue({ rows: [
      row({ order_id: 1, order_raw: { id: 1, name: 'ใบปลิว A', customer: 'บ.เอ' }, job_raw: { dept: 'print', date: '10/07/2026' } }),
      row({ order_id: 2, order_raw: { id: 2, name: 'นามบัตร B', customer: 'บ.เอ' }, job_raw: { dept: 'graphic', date: '11/07/2026' } }),
    ] });
    const jobs = await loadActiveJobsByCustomer(['บ.เอ'], { keyword: 'ใบปลิว' });
    expect(jobs.map((j) => j.orderId)).toEqual([1]);
  });

  it('sorts by soonest due first, null daysLeft last', async () => {
    sqlMock.mockResolvedValue({ rows: [
      row({ order_id: 1, order_raw: { id: 1, name: 'later', customer: 'c' }, job_raw: { dept: 'print', date: '31/12/2026' } }),
      row({ order_id: 2, order_raw: { id: 2, name: 'nodept', customer: 'c' }, job_raw: { dept: '' } }),
      row({ order_id: 3, order_raw: { id: 3, name: 'soon', customer: 'c' }, job_raw: { dept: 'print', date: '02/07/2026' } }),
    ] });
    const jobs = await loadActiveJobsByCustomer(['c']);
    expect(jobs.map((j) => j.name)).toEqual(['soon', 'later', 'nodept']);
  });
});
