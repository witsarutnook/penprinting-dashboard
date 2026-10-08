import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queueResult, resetMockPostgres } from './helpers/mock-postgres';

/**
 * Audit M4 (2026-10-08): /api/jobs/add only asked "does this order already
 * have an ACTIVE job?" — so "เพิ่มงาน" with the orderId of a shipped or
 * cancelled order sailed through and produced a live job under a terminal
 * order: /orders showed จัดส่งแล้ว and hid the job, /track + LINE told the
 * customer the order had shipped, the card's "แก้ใบสั่ง" opened a form that
 * 409'd on save, and the next ship wrote a second shipped row. Restore
 * already refuses a cancelled parent; add (and update, when it re-points a
 * job) now run the same lock read as /api/orders/update. Re-prints are a
 * new order ("สั่งซ้ำ"), never a job attached to the finished one.
 */

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

const lockMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderLockState: (...a: unknown[]) => lockMock(...a),
}));

vi.mock('@/lib/route-helpers', () => ({
  requireSession: async () => ({ role: 'sales', user: 'กบ' }),
}));

vi.mock('@/lib/id-allocation', () => ({
  mintJobId: async () => 101,
}));

const addMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  addJobToPostgres: (...a: unknown[]) => addMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  isActiveJobConflict: () => false,
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

import { POST } from '@/app/api/jobs/add/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/jobs/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const baseBody = { name: 'ใบปลิวพิมพ์ซ้ำ', date: '2026-10-20', dept: 'graphic', staff: 'pook', orderId: 5 };

describe('POST /api/jobs/add — attaching to a shipped/cancelled order', () => {
  beforeEach(() => {
    resetMockPostgres();
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: false });
    addMock.mockResolvedValue(undefined);
    auditMock.mockResolvedValue(undefined);
  });

  it('409 when the order is shipped — no job is created', async () => {
    lockMock.mockResolvedValue({ status: 'sent', shipped: true, cancelled: false });

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('ใบสั่งงาน #5 จัดส่งแล้ว — เพิ่มงานไม่ได้ ถ้าต้องพิมพ์ซ้ำให้ "สั่งซ้ำ" เป็นใบใหม่');
    expect(json.locked).toBe('shipped');
    expect(addMock).not.toHaveBeenCalled();
  });

  it('409 when the order is cancelled', async () => {
    lockMock.mockResolvedValue({ status: 'cancelled', shipped: false, cancelled: true });

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.locked).toBe('cancelled');
    expect(addMock).not.toHaveBeenCalled();
  });

  it('404 when the orderId does not exist (a typo, not a standalone job)', async () => {
    lockMock.mockResolvedValue(null);

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('ไม่พบใบสั่งงาน #5');
    expect(addMock).not.toHaveBeenCalled();
  });

  it('502 when the lock read fails', async () => {
    lockMock.mockRejectedValue(new Error('Postgres read failed: boom'));

    const res = await POST(mkReq(baseBody));

    expect(res.status).toBe(502);
    expect(addMock).not.toHaveBeenCalled();
  });

  it('an active order with no live job still accepts the add', async () => {
    queueResult({ rows: [], rowCount: 0 }); // active-job precheck: none

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(lockMock).toHaveBeenCalledWith(5);
    expect(addMock.mock.calls[0][0]).toMatchObject({ id: 101, orderId: 5 });
  });

  it('a standalone job (no orderId) never reads a lock', async () => {
    const { orderId: _omit, ...standalone } = baseBody;
    void _omit;

    const res = await POST(mkReq(standalone));

    expect(res.status).toBe(200);
    expect(lockMock).not.toHaveBeenCalled();
    expect(addMock.mock.calls[0][0]).toMatchObject({ id: 101, orderId: '' });
  });
});
