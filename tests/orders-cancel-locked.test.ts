import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Audit M5 (2026-10-08): /api/orders/cancel had no lock check, so a SHIPPED
 * order could be cancelled — cancelOrderInPostgres found no active job to
 * cascade and just flipped `status='cancelled'` with no cancelled row. The
 * surfaces then disagreed: /orders + edit-lock + /archive said ยกเลิก, the
 * lock panel linked to /cancelled where the order wasn't, /shipped still
 * listed it, the monthly report counted it as shipped and /track + LINE told
 * the customer "จัดส่งเรียบร้อยแล้ว". คุณนุ๊ก's call: shipped = final —
 * block at the API (the same lock read /api/orders/update uses) and hide
 * the button. A cancelled order is refused too (re-cancel is a no-op that
 * only re-stamps the row).
 */

const lockMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderLockState: (...a: unknown[]) => lockMock(...a),
}));

vi.mock('@/lib/route-helpers', () => ({
  requireSession: async () => ({ role: 'admin', user: 'นุ๊ก' }),
}));

const cancelMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  cancelOrderInPostgres: (...a: unknown[]) => cancelMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

import { POST } from '@/app/api/orders/cancel/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/orders/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/orders/cancel — shipped/cancelled lock', () => {
  beforeEach(() => {
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: false });
    cancelMock.mockResolvedValue({ found: true, cancelledJobs: [], failedJobs: [] });
    auditMock.mockResolvedValue(undefined);
  });

  it('409 for a shipped order (shipped row) — nothing is written', async () => {
    lockMock.mockResolvedValue({ status: 'sent', shipped: true, cancelled: false });

    const res = await POST(mkReq({ id: 5 }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('ใบสั่งงานนี้จัดส่งแล้ว — ยกเลิกไม่ได้');
    expect(json.locked).toBe('shipped');
    expect(cancelMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('409 for a shipped order known only by its status flag', async () => {
    lockMock.mockResolvedValue({ status: 'shipped', shipped: false, cancelled: false });

    const res = await POST(mkReq({ id: 5 }));

    expect(res.status).toBe(409);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('409 for an already-cancelled order (re-cancel is a no-op)', async () => {
    lockMock.mockResolvedValue({ status: 'cancelled', shipped: false, cancelled: true });

    const res = await POST(mkReq({ id: 5 }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('ใบสั่งงานนี้ยกเลิกแล้ว');
    expect(json.locked).toBe('cancelled');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('404 when the lock read finds no order row', async () => {
    lockMock.mockResolvedValue(null);

    const res = await POST(mkReq({ id: 5 }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('ไม่พบใบสั่งงาน #5');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('502 when the lock read itself fails', async () => {
    lockMock.mockRejectedValue(new Error('Postgres read failed: boom'));

    const res = await POST(mkReq({ id: 5 }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toMatch(/อ่านข้อมูลไม่ได้/);
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('an active order still cancels (lock check is transparent on the happy path)', async () => {
    const res = await POST(mkReq({ id: 5 }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(lockMock).toHaveBeenCalledWith(5);
    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock.mock.calls[0][0]).toMatchObject({ orderId: 5 });
  });
});
