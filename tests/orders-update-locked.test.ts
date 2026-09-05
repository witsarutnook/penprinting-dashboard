import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Edit-lock at the API (2026-09-05): /api/orders/update must refuse
 * shipped / cancelled orders with 409 regardless of which UI (or curl)
 * sent the request — the /orders table only hid the ✏️ button, and the
 * new /archive rows + a hand-typed /orders/<id>/edit could still reach
 * the form. Pre-fix the route preserved `status` but cascaded name/dateDue
 * into the tombstoned job rows.
 *
 * The lock read is server-authoritative (`loadOrderLockState` → one query
 * with EXISTS flags) and runs BEFORE the srcOrder perf gate, so a client
 * snapshot claiming "nothing changed" cannot skip it.
 */

const loadMock = vi.fn();
const lockMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderAndJobs: (...a: unknown[]) => loadMock(...a),
  loadOrderLockState: (...a: unknown[]) => lockMock(...a),
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

const dbOrder = {
  name: 'ชื่อเก่า',
  dateDue: '2026-07-01',
  dateIn: '2026-06-20',
  price: '100',
  status: 'sent',
  rawData: { pin: '1234' },
  details: null,
};

describe('POST /api/orders/update — shipped/cancelled edit-lock', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ role: 'admin', user: 'นุ๊ก' });
    updateMock.mockResolvedValue({ found: true });
    cascadeMock.mockResolvedValue({ cascaded: 0, failedJobIds: [] });
    auditMock.mockResolvedValue(undefined);
    loadMock.mockResolvedValue({ order: dbOrder, jobs: [] });
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: false });
  });

  it('409 for a shipped order (status flag only, no shipped row) — nothing is written', async () => {
    lockMock.mockResolvedValue({ status: 'shipped', shipped: false, cancelled: false });

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('ใบสั่งงานนี้จัดส่งแล้ว — แก้ไขไม่ได้');
    expect(json.locked).toBe('shipped');
    expect(updateMock).not.toHaveBeenCalled();
    expect(cascadeMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('409 for a cancelled order known only via the cancelled table (status still "sent")', async () => {
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: true });

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe('ใบสั่งงานนี้ยกเลิกแล้ว — แก้ไขไม่ได้');
    expect(json.locked).toBe('cancelled');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('the srcOrder "nothing changed" perf gate cannot bypass the lock', async () => {
    lockMock.mockResolvedValue({ status: 'shipped', shipped: true, cancelled: false });

    const res = await POST(mkReq({
      ...baseBody,
      srcOrder: { name: baseBody.name, dateDue: baseBody.dateDue, status: 'sent' },
    }));

    expect(res.status).toBe(409);
    expect(lockMock).toHaveBeenCalledWith(5);
    expect(loadMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('lock runs BEFORE field validation — locked + invalid body is 409, not 400 (audit M1)', async () => {
    lockMock.mockResolvedValue({ status: 'shipped', shipped: true, cancelled: false });

    const res = await POST(mkReq({ id: 5 })); // no name/customer/dateDue/orderer
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.locked).toBe('shipped');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('404 when the lock read finds no order row', async () => {
    lockMock.mockResolvedValue(null);

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('ไม่พบใบสั่งงาน #5');
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('502 when the lock read itself fails', async () => {
    lockMock.mockRejectedValue(new Error('Postgres read failed: boom'));

    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toMatch(/อ่านข้อมูลไม่ได้/);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('an active order still saves (lock check is transparent on the happy path)', async () => {
    const res = await POST(mkReq(baseBody));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(lockMock).toHaveBeenCalledWith(5);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ id: 5, name: 'ชื่อใหม่', status: 'sent' });
  });
});
