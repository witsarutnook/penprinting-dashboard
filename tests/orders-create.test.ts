import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));

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

import { createOrderFromForm } from '@/lib/orders-create';

const BASE = {
  name: 'ใบปลิว A5',
  customer: 'ร้านเอ',
  dateDue: '2026-11-20',
  orderer: 'กิ๊ฟ',
  assignStaff: 'pook',
};
const ACTOR = { role: 'sales', user: 'กิ๊ฟ' };

beforeEach(() => {
  vi.clearAllMocks();
  mintOrderIdMock.mockResolvedValue(2611001);
  mintJobIdMock.mockResolvedValue(9001);
  dupMock.mockResolvedValue([]);
  createMock.mockResolvedValue(undefined);
  auditMock.mockResolvedValue(undefined);
});

describe('createOrderFromForm result arms', () => {
  it('normal success -> ok, draft false', async () => {
    const r = await createOrderFromForm(BASE, ACTOR);
    expect(r).toMatchObject({
      ok: true,
      orderId: 2611001,
      jobId: 9001,
      orderType: 'normal',
      draft: false,
    });
    expect(r.ok && r.pin).toMatch(/^\d{4}$/);
  });

  it('draft success -> ok, draft true, jobId null', async () => {
    const r = await createOrderFromForm({ name: 'ร่าง', status: 'draft' }, ACTOR);
    expect(r).toMatchObject({ ok: true, draft: true, jobId: null });
  });

  // The LINE /order flow calls this directly with the marker of the quotation line it opens.
  // (The web route drops a `peak` key before it gets here — orders-add-route.test.ts.)
  it('keeps the Peak marker it is given, in both copies of the snapshot', async () => {
    const peak = { code: 'QO-20261100111', lineKeys: ['line-a'], draftId: 'draft-1' };
    await createOrderFromForm({ ...BASE, peak }, ACTOR);
    const arg = createMock.mock.calls[0][0];
    expect(arg.order.rawData.peak).toEqual(peak);
    expect(arg.order.details.peak).toEqual(peak);
  });

  it('validation -> kind validation, status 400', async () => {
    const r = await createOrderFromForm({ ...BASE, name: '' }, ACTOR);
    expect(r).toMatchObject({ ok: false, kind: 'validation', status: 400 });
    expect(!r.ok && r.kind === 'validation' && r.error).toContain('กรุณาระบุชื่องาน');
  });

  it('duplicate -> kind duplicate, status 409', async () => {
    const dups = [{ id: 5 }];
    dupMock.mockResolvedValue(dups);
    const r = await createOrderFromForm(BASE, ACTOR);
    expect(r).toMatchObject({ ok: false, kind: 'duplicate', status: 409, duplicates: dups });
    expect(!r.ok && r.kind === 'duplicate' && r.message).toContain('1');
  });

  it('id allocation failure -> kind failure, status 502', async () => {
    mintOrderIdMock.mockRejectedValue(new Error('counter'));
    const r = await createOrderFromForm(BASE, ACTOR);
    expect(r).toMatchObject({ ok: false, kind: 'failure', status: 502 });
    expect(!r.ok && r.kind === 'failure' && r.error.startsWith('id allocation failed')).toBe(true);
  });

  it('insert failure -> kind failure, status 500', async () => {
    createMock.mockRejectedValue(new Error('insert'));
    const r = await createOrderFromForm(BASE, ACTOR);
    expect(r).toMatchObject({ ok: false, kind: 'failure', status: 500 });
    expect(!r.ok && r.kind === 'failure' && r.error.startsWith('createOrder failed')).toBe(true);
  });
});
