import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  setConfigured,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadOrderFromPostgres, PostgresStaleError } from '@/lib/api-postgres';

describe('loadOrderFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresStaleError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadOrderFromPostgres(123)).rejects.toBeInstanceOf(PostgresStaleError);
  });

  it('throws on invalid orderId', async () => {
    await expect(loadOrderFromPostgres('abc')).rejects.toThrow('Invalid orderId');
    await expect(loadOrderFromPostgres(0)).rejects.toThrow('Invalid orderId');
  });

  it('returns the order from Postgres even when the cron mirror is stale', async () => {
    // Regression (2026-05-18 print-page 404): a brand-new Phase 2 order must
    // be returned straight from Postgres regardless of Sheet→Postgres cron
    // health. The old checkStaleness(['orders']) pre-gate threw here when the
    // mirror was briefly unhealthy → loadOrder() fell back to Apps Script →
    // the Sheet had no row for the new order yet → print page notFound().
    const orderRaw = { id: 202605100, name: 'เคสด่วน', customer: 'ลูกค้า A', status: 'sent' };
    const jobRaw = { id: 5001, orderId: 202605100, dept: 'graphic' };
    queueResult({ rows: [{ raw: orderRaw }], rowCount: 1 }); // orders
    queueResult({ rows: [{ raw: jobRaw }], rowCount: 1 });   // jobs
    queueResult({ rows: [], rowCount: 0 });                  // shipped
    queueResult({ rows: [], rowCount: 0 });                  // cancelled

    const r = await loadOrderFromPostgres(202605100);

    expect(r.order).toEqual(orderRaw);
    expect(r.job).toEqual(jobRaw);
    // The order row IS the source of truth under Phase 2 — staleness of the
    // mirror must never short-circuit a single-order read. No sync_meta query.
    expect(callsContaining('sync_meta')).toHaveLength(0);
  });

  it('throws PostgresStaleError when the order is not in Postgres (fallback signal)', async () => {
    queueResult({ rows: [], rowCount: 0 }); // orders — empty → caller falls back to Apps Script
    await expect(loadOrderFromPostgres(999999)).rejects.toBeInstanceOf(PostgresStaleError);
  });
});
