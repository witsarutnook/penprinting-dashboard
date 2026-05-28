import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  setConfigured,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  loadAllFromPostgres,
  loadOrderFromPostgres,
  getAuditByTargetFromPostgres,
  PostgresReadError,
} from '@/lib/api-postgres';

describe('loadOrderFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresReadError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadOrderFromPostgres(123)).rejects.toBeInstanceOf(PostgresReadError);
  });

  it('throws on invalid orderId', async () => {
    await expect(loadOrderFromPostgres('abc')).rejects.toThrow('Invalid orderId');
    await expect(loadOrderFromPostgres(0)).rejects.toThrow('Invalid orderId');
  });

  it('returns the order from Postgres without consulting sync_meta', async () => {
    // Regression (2026-05-18 print-page 404 + 2026-05-28 /analytics "mirror
    // stale"): post §12 Postgres is authoritative — there is no Sheet→Postgres
    // cron and no sync_meta gate. A single-order read must never query
    // sync_meta or short-circuit on its freshness.
    const orderRaw = { id: 202605100, name: 'เคสด่วน', customer: 'ลูกค้า A', status: 'sent' };
    const jobRaw = { id: 5001, orderId: 202605100, dept: 'graphic' };
    queueResult({ rows: [{ raw: orderRaw }], rowCount: 1 }); // orders
    queueResult({ rows: [{ raw: jobRaw }], rowCount: 1 });   // jobs
    queueResult({ rows: [], rowCount: 0 });                  // shipped
    queueResult({ rows: [], rowCount: 0 });                  // cancelled

    const r = await loadOrderFromPostgres(202605100);

    expect(r.order).toEqual(orderRaw);
    expect(r.job).toEqual(jobRaw);
    expect(callsContaining('sync_meta')).toHaveLength(0);
  });

  it('throws PostgresReadError when the order is not in Postgres', async () => {
    queueResult({ rows: [], rowCount: 0 }); // orders — empty
    await expect(loadOrderFromPostgres(999999)).rejects.toBeInstanceOf(PostgresReadError);
  });

  it('orderOnly runs a single query and leaves job/shipped/cancelled null', async () => {
    const orderRaw = { id: 202605100, name: 'เคสด่วน', customer: 'ลูกค้า A', status: 'sent' };
    queueResult({ rows: [{ raw: orderRaw }], rowCount: 1 }); // orders — the only query

    const r = await loadOrderFromPostgres(202605100, { orderOnly: true });

    expect(r.order).toEqual(orderRaw);
    expect(r.job).toBeNull();
    expect(r.shipped).toBeNull();
    expect(r.cancelled).toBeNull();
    // The point of orderOnly — skip the jobs/shipped/cancelled lookups.
    expect(callsContaining('FROM jobs')).toHaveLength(0);
    expect(callsContaining('FROM shipped')).toHaveLength(0);
    expect(callsContaining('FROM cancelled')).toHaveLength(0);
  });

  it('orderOnly still throws PostgresReadError when the order is missing', async () => {
    queueResult({ rows: [], rowCount: 0 }); // orders empty
    await expect(
      loadOrderFromPostgres(999999, { orderOnly: true }),
    ).rejects.toBeInstanceOf(PostgresReadError);
  });
});

describe('loadAllFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresReadError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadAllFromPostgres()).rejects.toBeInstanceOf(PostgresReadError);
  });

  it('returns the snapshot without consulting sync_meta', async () => {
    // Regression (2026-05-28 /analytics "Postgres mirror stale: jobs last
    // synced 1491 min ago"): the §12 ship retired sync-from-sheet.ts cron
    // → nothing updated sync_meta → the old `checkStaleness()` pre-gate
    // threw on every loadAll after the 30-min threshold. Post §12 Postgres
    // is authoritative — loadAll must never query sync_meta.
    queueResult({ rows: [{ raw: { id: 5001, orderId: 202605100 } }], rowCount: 1 }); // jobs
    queueResult({ rows: [{ raw: { id: 202605100, name: 'เคสด่วน' } }], rowCount: 1 }); // orders
    queueResult({ rows: [], rowCount: 0 }); // shipped
    queueResult({ rows: [], rowCount: 0 }); // cancelled
    queueResult({ rows: [], rowCount: 0 }); // templates
    queueResult({ rows: [], rowCount: 0 }); // audit_log

    const r = await loadAllFromPostgres();

    expect(r.jobs).toHaveLength(1);
    expect(r.orders).toHaveLength(1);
    expect(callsContaining('sync_meta')).toHaveLength(0);
  });

  it('skips the audit_log query when audit=false', async () => {
    queueResult({ rows: [], rowCount: 0 }); // jobs
    queueResult({ rows: [], rowCount: 0 }); // orders
    queueResult({ rows: [], rowCount: 0 }); // shipped
    queueResult({ rows: [], rowCount: 0 }); // cancelled
    queueResult({ rows: [], rowCount: 0 }); // templates

    const r = await loadAllFromPostgres({ audit: false });

    expect(r.audit).toEqual([]);
    expect(callsContaining('FROM audit_log')).toHaveLength(0);
  });
});

describe('getAuditByTargetFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresReadError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(getAuditByTargetFromPostgres(123, null)).rejects.toBeInstanceOf(PostgresReadError);
  });

  it('returns the audit entries without consulting sync_meta', async () => {
    // Regression (2026-05-28): same sync_meta gate removal as loadAll.
    queueResult({
      rows: [
        { timestamp: new Date('2026-05-27T10:00:00Z'), role: 'admin', action: 'addJob', target_id: '5001', summary: 'เพิ่มงาน' },
      ],
      rowCount: 1,
    });

    const r = await getAuditByTargetFromPostgres(5001, null);

    expect(r.entries).toHaveLength(1);
    expect(callsContaining('sync_meta')).toHaveLength(0);
  });

  it('returns empty when both jobId and orderId are null', async () => {
    const r = await getAuditByTargetFromPostgres(null, null);
    expect(r.entries).toEqual([]);
    // Short-circuit before any query.
    expect(callsContaining('FROM audit_log')).toHaveLength(0);
  });
});
