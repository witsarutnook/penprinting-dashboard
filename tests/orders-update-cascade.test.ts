import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * L-orders-update-cascade-skip (audit 2026-07-21): when the client didn't
 * send `srcOrder`, nameChanged/dueChanged were hard-false — the cascade
 * rename/due-push of the order's jobs was silently skipped even when the
 * values really changed. These tests pin the fix: the cascade baseline is
 * the freshest known previous state — the DB row whenever we read it
 * (no-src legacy callers AND src-changed paths), the client snapshot only
 * on the read-skip fast path (where it claims nothing changed anyway).
 */

const loadMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderAndJobs: (...a: unknown[]) => loadMock(...a),
}));

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

const updateMock = vi.fn();
const cascadeMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  updateOrderInPostgres: (...a: unknown[]) => updateMock(...a),
  cascadeRenameJobsInPostgres: (...a: unknown[]) => cascadeMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

import { POST } from '@/app/api/orders/update/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/orders/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  id: 5,
  name: 'ชื่อใหม่',
  customer: 'ลูกค้า',
  dateDue: '2026-07-30',
  orderer: 'นุ๊ก',
  assignStaff: 'กบ',
};

describe('POST /api/orders/update — cascade baseline', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ role: 'admin', user: 'นุ๊ก' });
    updateMock.mockResolvedValue({ found: true });
    cascadeMock.mockResolvedValue({ cascaded: 1, failedJobIds: [] });
    auditMock.mockResolvedValue(undefined);
    loadMock.mockResolvedValue({
      order: {
        name: 'ชื่อเก่า',
        dateDue: '2026-07-01',
        dateIn: '2026-06-20',
        price: '100',
        status: 'sent',
        rawData: { pin: '1234' },
        details: null,
      },
      jobs: [],
    });
  });

  it('legacy caller WITHOUT srcOrder still cascades when DB values differ', async () => {
    const res = await POST(mkReq(baseBody));

    expect(res.status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith(5);
    expect(cascadeMock).toHaveBeenCalledWith(5, 'ชื่อเก่า', 'ชื่อใหม่', '2026-07-30', true, true);
  });

  it('read-skip fast path holds: srcOrder unchanged → no read, no cascade', async () => {
    const res = await POST(
      mkReq({
        ...baseBody,
        srcOrder: { name: 'ชื่อใหม่', dateDue: '2026-07-30', status: 'sent', rawData: { pin: '1234' } },
      }),
    );

    expect(res.status).toBe(200);
    expect(loadMock).not.toHaveBeenCalled();
    expect(cascadeMock).toHaveBeenCalledWith(5, 'ชื่อใหม่', 'ชื่อใหม่', '2026-07-30', false, false);
  });

  it('stale srcOrder: cascade oldName comes from the fresh DB row, not the snapshot', async () => {
    const res = await POST(
      mkReq({
        ...baseBody,
        srcOrder: { name: 'ชื่อ stale', dateDue: '2026-07-01', status: 'sent', rawData: { pin: '1234' } },
      }),
    );

    expect(res.status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith(5);
    // Jobs are matched by name = oldName — a stale snapshot name would
    // match nothing; the DB row's name is the one the jobs actually carry.
    expect(cascadeMock).toHaveBeenCalledWith(5, 'ชื่อเก่า', 'ชื่อใหม่', '2026-07-30', true, true);
  });
});
