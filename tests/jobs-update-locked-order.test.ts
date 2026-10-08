import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit M4 (2026-10-08), second entry point: /api/jobs/update can re-point a
 * job at any orderId. Same lock read as /api/jobs/add — a job may not be
 * attached to a shipped/cancelled order. Jobs without an order never read it.
 */

const lockMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderLockState: (...a: unknown[]) => lockMock(...a),
}));

vi.mock('@/lib/route-helpers', () => ({
  requireSession: async () => ({ role: 'admin', user: 'นุ๊ก' }),
}));

const updateMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  updateJobInPostgres: (...a: unknown[]) => updateMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

import { POST } from '@/app/api/jobs/update/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/jobs/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = { id: 77, name: 'งาน', date: '2026-10-20', dept: 'graphic', staff: 'pook', orderId: 5 };

describe('POST /api/jobs/update — re-pointing a job at a shipped/cancelled order', () => {
  beforeEach(() => {
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: false });
    updateMock.mockResolvedValue({ ok: true, found: true });
    auditMock.mockResolvedValue(undefined);
  });

  it('409 when the target order is shipped — nothing is written', async () => {
    lockMock.mockResolvedValue({ status: 'shipped', shipped: true, cancelled: false });

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.locked).toBe('shipped');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('404 when the target orderId does not exist', async () => {
    lockMock.mockResolvedValue(null);

    const res = await POST(mkReq(baseBody));

    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('an active target order still saves', async () => {
    const res = await POST(mkReq(baseBody));

    expect(res.status).toBe(200);
    expect(lockMock).toHaveBeenCalledWith(5);
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('a job without an order never reads a lock', async () => {
    const res = await POST(mkReq({ ...baseBody, orderId: '' }));

    expect(res.status).toBe(200);
    expect(lockMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
