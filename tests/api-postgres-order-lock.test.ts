import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  setConfigured,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadOrderLockStateFromPostgres, PostgresReadError } from '@/lib/api-postgres';

/**
 * Server-authoritative lock read for /api/orders/update (2026-09-05). One
 * round-trip that returns the order's status plus EXISTS flags for the
 * shipped / cancelled tables — the same three inputs lib/orders-list uses
 * to paint the status pill, so the API and the /orders UI can never
 * disagree about whether an order is editable.
 */
describe('loadOrderLockStateFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresReadError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadOrderLockStateFromPostgres(5)).rejects.toBeInstanceOf(PostgresReadError);
  });

  it('throws on invalid order id', async () => {
    await expect(loadOrderLockStateFromPostgres('abc')).rejects.toThrow('Invalid orderId');
    await expect(loadOrderLockStateFromPostgres(0)).rejects.toThrow('Invalid orderId');
  });

  it('returns null when the order row is missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadOrderLockStateFromPostgres(404)).toBeNull();
  });

  it('returns status + shipped/cancelled EXISTS flags from ONE query', async () => {
    queueResult({ rows: [{ status: 'sent', has_shipped: true, has_cancelled: false }], rowCount: 1 });

    const r = await loadOrderLockStateFromPostgres(202609050);

    expect(r).toEqual({ status: 'sent', shipped: true, cancelled: false });
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toMatch(/FROM orders/);
    expect(sqlCalls[0].text).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM shipped/);
    expect(sqlCalls[0].text).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM cancelled/);
    expect(sqlCalls[0].values).toContain(202609050);
  });

  it('coerces a null status to "" and string-ish flags to booleans', async () => {
    // pg can hand back "t"/"f" strings for booleans on some drivers; a
    // missing raw->>'status' is null. Neither may leak into the lock decision.
    queueResult({ rows: [{ status: null, has_shipped: 'f', has_cancelled: 't' }], rowCount: 1 });

    const r = await loadOrderLockStateFromPostgres(7);

    expect(r).toEqual({ status: '', shipped: false, cancelled: true });
  });
});
