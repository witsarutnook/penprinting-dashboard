import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Characterization tests for POST /api/orders/add — pinned BEFORE the
 * createOrderFromForm extraction so the refactor is provably no-behaviour-change.
 */

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

const mintOrderIdMock = vi.fn();
const mintJobIdMock = vi.fn();
vi.mock('@/lib/id-allocation', () => ({
  mintOrderId: (...a: unknown[]) => mintOrderIdMock(...a),
  mintJobId: (...a: unknown[]) => mintJobIdMock(...a),
}));

const createMock = vi.fn();
const dupMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  createOrderInPostgres: (...a: unknown[]) => createMock(...a),
  findDuplicateOrdersInPostgres: (...a: unknown[]) => dupMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from '@/app/api/orders/add/route';

const BASE = {
  name: 'ใบปลิว A5',
  customer: 'ร้านเอ',
  dateDue: '2026-11-20',
  orderer: 'กิ๊ฟ',
  assignStaff: 'pook',
};

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/orders/add', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function call(body: unknown) {
  const res = await POST(mkReq(body));
  return { status: res.status, json: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ role: 'sales', user: 'กิ๊ฟ' });
  mintOrderIdMock.mockResolvedValue(2611001);
  mintJobIdMock.mockResolvedValue(9001);
  dupMock.mockResolvedValue([]);
  createMock.mockResolvedValue(undefined);
  auditMock.mockResolvedValue(undefined);
});

describe('POST /api/orders/add — validation', () => {
  it('rejects a missing name', async () => {
    const { status, json } = await call({ ...BASE, name: '' });
    expect(status).toBe(400);
    expect(json.error).toContain('กรุณาระบุชื่องาน');
  });

  it('rejects non-draft missing customer/dateDue/orderer/assignment', async () => {
    const { status, json } = await call({ name: 'x' });
    expect(status).toBe(400);
    expect(json.error).toBe(
      [
        'กรุณาระบุชื่อลูกค้า',
        'กรุณาระบุกำหนดส่ง',
        'กรุณาระบุผู้สั่งงาน',
        'กรุณาเลือก มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์ อย่างน้อย 1 อย่าง',
      ].join(' • '),
    );
  });

  it('rejects an unknown graphic staff id', async () => {
    const { status, json } = await call({ ...BASE, assignStaff: 'zzz' });
    expect(status).toBe(400);
    expect(json.error).toContain('กราฟฟิก "zzz" ไม่ถูกต้อง');
  });

  it('rejects an unknown forwardPrint id', async () => {
    const { status, json } = await call({ ...BASE, assignStaff: '', forwardPrint: 'zzz' });
    expect(status).toBe(400);
    expect(json.error).toContain('ส่งต่อพิมพ์ "zzz" ไม่ถูกต้อง');
  });
});

describe('POST /api/orders/add — success', () => {
  it('creates a normal order + job and returns ids without a draft key', async () => {
    const { status, json } = await call(BASE);
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: true, orderId: 2611001, jobId: 9001, orderType: 'normal' });
    expect(json.pin).toMatch(/^\d{4}$/);
    expect('draft' in json).toBe(false);

    const arg = createMock.mock.calls[0][0];
    expect(arg.orderId).toBe(2611001);
    expect(arg.jobId).toBe(9001);
    expect(arg.order.status).toBe('sent');
    expect(arg.order.assignDept).toBe('graphic');
    expect(arg.order.assignStaff).toBe('pook');
    expect(arg.job).toEqual({
      name: 'ใบปลิว A5',
      date: '2026-11-20',
      dateIn: expect.any(String),
      staff: 'pook',
      dept: 'graphic',
      status: 'pending',
    });
    expect(arg.order.details).toEqual(arg.order.rawData);
    expect(arg.order.rawData.pin).toBe(json.pin);
    expect('force' in arg.order.rawData).toBe(false);
    expect('status' in arg.order.rawData).toBe(false);
  });

  it('forwardPrint without graphic assigns to the print dept', async () => {
    await call({ ...BASE, assignStaff: '', forwardPrint: 'sm74' });
    const arg = createMock.mock.calls[0][0];
    expect(arg.order.assignDept).toBe('print');
    expect(arg.order.assignStaff).toBe('sm74');
  });

  it('graphic wins when both are set, snapshot keeps forwardPrint', async () => {
    await call({ ...BASE, forwardPrint: 'sm74' });
    const arg = createMock.mock.calls[0][0];
    expect(arg.order.assignDept).toBe('graphic');
    expect(arg.order.assignStaff).toBe('pook');
    expect(arg.order.rawData.forwardPrint).toBe('sm74');
  });

  it('preserves unknown extra keys in the snapshot', async () => {
    await call({ ...BASE, peak: { code: 'QO-1' } });
    expect(createMock.mock.calls[0][0].order.rawData.peak).toEqual({ code: 'QO-1' });
  });

  it('writes one createOrder audit row', async () => {
    await call(BASE);
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'createOrder',
      role: 'sales',
      user: 'กิ๊ฟ',
      targetId: 2611001,
    });
  });
});

describe('POST /api/orders/add — duplicates', () => {
  it('409s on an open duplicate without minting ids', async () => {
    const dups = [{ id: 5, name: 'ใบปลิว A5', customer: 'ร้านเอ' }];
    dupMock.mockResolvedValue(dups);
    const { status, json } = await call(BASE);
    expect(status).toBe(409);
    expect(json.error).toBe('duplicate');
    expect(json.duplicates).toEqual(dups);
    expect(mintOrderIdMock).not.toHaveBeenCalled();
  });

  it('force=true skips the duplicate block', async () => {
    dupMock.mockResolvedValue([{ id: 5 }]);
    const { status } = await call({ ...BASE, force: true });
    expect(status).toBe(200);
  });

  it('a failing dedupe scan is non-fatal', async () => {
    dupMock.mockRejectedValue(new Error('db down'));
    const { status } = await call(BASE);
    expect(status).toBe(200);
  });
});

describe('POST /api/orders/add — draft', () => {
  it('saves a draft with only a name: no job, no dedupe', async () => {
    const { status, json } = await call({ name: 'ร่าง', status: 'draft' });
    expect(status).toBe(200);
    expect(json.draft).toBe(true);
    expect(json.jobId).toBeNull();
    expect(mintJobIdMock).not.toHaveBeenCalled();
    expect(dupMock).not.toHaveBeenCalled();
    const arg = createMock.mock.calls[0][0];
    expect(arg.order.status).toBe('draft');
    expect(arg.job).toBeNull();
  });
});

describe('POST /api/orders/add — failures', () => {
  it('502 when id allocation fails', async () => {
    mintOrderIdMock.mockRejectedValue(new Error('counter'));
    const { status, json } = await call(BASE);
    expect(status).toBe(502);
    expect(json.error.startsWith('id allocation failed')).toBe(true);
  });

  it('500 when the insert fails', async () => {
    createMock.mockRejectedValue(new Error('insert'));
    const { status, json } = await call(BASE);
    expect(status).toBe(500);
    expect(json.error.startsWith('createOrder failed')).toBe(true);
  });
});
