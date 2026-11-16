import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/jobs/restore × work orders opened from a Peak quotation (2026-11-16).
 *
 * Cancel a job on the board → `/order` reopens the same quotation line as a
 * new work order → restoring the old job must be refused, otherwise one Peak
 * line has two live work orders. The route runs the REAL restore guard here,
 * on the in-memory fake of the link table; only the session, the SQL reads of
 * the route itself and the job write are stubbed.
 */

const h = vi.hoisted(() => ({
  db: null as unknown as import('./helpers/peak-order-fakes').FakeDb,
  cancelledRaw: null as Record<string, unknown> | null,
  markerReadFails: false,
  markerReads: 0,
}));

vi.mock('@/lib/route-helpers', () => ({
  requireSession: async () => ({ role: 'admin', user: 'นุ๊ก' }),
}));

const loadOrderMock = vi.fn();
vi.mock('@/lib/api', () => ({ loadOrder: (...a: unknown[]) => loadOrderMock(...a) }));

vi.mock('@/lib/postgres', () => ({
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM cancelled WHERE id')) {
      return { rows: h.cancelledRaw ? [{ raw: h.cancelledRaw }] : [] };
    }
    if (text.includes("raw_data->'peak'")) {
      h.markerReads++;
      if (h.markerReadFails) throw new Error('connection terminated');
      const peak = h.db.orders.get(Number(values[0]))?.peak ?? null;
      return { rows: [{ peak }] };
    }
    throw new Error(`unexpected SQL in test: ${text}`);
  },
}));

vi.mock('@/lib/peak-order/db', () => ({
  peakOrderDb: new Proxy(
    {},
    { get: (_t, key: string) => (...a: unknown[]) => (h.db as unknown as Record<string, (...x: unknown[]) => unknown>)[key](...a) },
  ),
}));

const restoreMock = vi.fn();
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  restoreJobInPostgres: (...a: unknown[]) => restoreMock(...a),
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
  PostgresWriteError: class PostgresWriteError extends Error {},
}));

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { fakeDb, type FakeDbSeed } from './helpers/peak-order-fakes';
import { POST } from '@/app/api/jobs/restore/route';

const QO = 'QO-20261100012';
const OLD = 501;
const NEW = 502;
const JOB = 9001;
const NOW = 1_800_000_000_000;

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/jobs/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const oldOrder = (lineKeys = ['L1']) => ({
  name: 'ไวนิล 1x2 เมตร',
  status: 'sent',
  peak: { code: QO, lineKeys },
  jobCancelled: true,
});
const link = (lineKey: string, orderId: number | null, draftId: string) => ({
  qoCode: QO,
  lineKey,
  orderId,
  draftId,
  claimedAtMs: NOW,
});
const seed = (s: FakeDbSeed) => {
  h.db = fakeDb({ ...s, nowMs: () => NOW });
};
const restoreRows = () => h.db.links.filter((l) => l.draftId.startsWith('restore:'));

beforeEach(() => {
  h.cancelledRaw = { id: JOB, name: 'ไวนิล 1x2 เมตร', dept: 'graphic', staff: 'pook', orderId: OLD };
  h.markerReadFails = false;
  h.markerReads = 0;
  seed({ orders: { [OLD]: oldOrder() }, links: [link('L1', OLD, 'dOld')] });
  loadOrderMock.mockResolvedValue({ order: { status: 'sent', dateDue: '2026-11-20', dateIn: '2026-11-14' } });
  // The real write deletes the `cancelled` row — the order is alive again.
  restoreMock.mockImplementation(async () => {
    const o = h.db.orders.get(OLD);
    if (o) o.jobCancelled = false;
    return { ok: true };
  });
  auditMock.mockResolvedValue(undefined);
});

describe('POST /api/jobs/restore — Peak quotation line guard', () => {
  it('409 when /order already reopened the line as another live work order — nothing is written', async () => {
    seed({
      orders: { [OLD]: oldOrder(), [NEW]: { name: 'ไวนิล (ใบใหม่)', status: 'sent', peak: { code: QO, lineKeys: ['L1'] } } },
      links: [link('L1', NEW, 'dNew')],
    });

    const res = await POST(mkReq({ id: JOB }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain(QO);
    expect(json.error).toContain(`#${NEW}`);
    expect(restoreMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(h.db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: NEW, draftId: 'dNew' })]);
  });

  it('409 while someone is opening the line through /order right now', async () => {
    seed({ orders: { [OLD]: oldOrder() }, links: [link('L1', null, 'dNew')] });

    const res = await POST(mkReq({ id: JOB }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('2 นาที');
    expect(restoreMock).not.toHaveBeenCalled();
    expect(h.db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: null, draftId: 'dNew' })]);
  });

  it('502 when the quotation check itself cannot run — the job is not restored on a guess', async () => {
    h.markerReadFails = true;

    const res = await POST(mkReq({ id: JOB }));
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toContain('ลองใหม่');
    expect(json.error).not.toContain('connection terminated');
    expect(restoreMock).not.toHaveBeenCalled();
  });

  it('restores a Peak order whose line is still its own: the line is held during the write and linked to it afterwards', async () => {
    let heldDuringWrite: unknown;
    restoreMock.mockImplementation(async () => {
      heldDuringWrite = structuredClone(h.db.links);
      h.db.orders.get(OLD)!.jobCancelled = false;
      return { ok: true };
    });

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: JOB });
    expect(heldDuringWrite).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: null, draftId: `restore:${JOB}` })]);
    expect(h.db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: OLD })]);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('gives the line back when the job write fails', async () => {
    restoreMock.mockRejectedValue(new Error('insert failed'));

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(500);
    expect(restoreRows()).toEqual([]);
    expect(await h.db.claimLines(QO, ['L1'], 'dNew', 'กิ๊ฟ')).toBe(true); // /order can still open it
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('still answers ok when linking the line back fails after the job was restored', async () => {
    h.db.finalizeLinks = async () => {
      throw new Error('connection terminated');
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('connection terminated');
  });

  it('an order that did not come from Peak is restored exactly as before — no link is touched', async () => {
    seed({ orders: { [OLD]: { name: 'งานทั่วไป', status: 'sent', jobCancelled: true } }, links: [] });

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalledWith(expect.objectContaining({ id: JOB, orderId: OLD, name: 'ไวนิล 1x2 เมตร' }));
    expect(h.db.links).toEqual([]);
  });

  it('a job without a parent order never asks about a quotation', async () => {
    h.cancelledRaw = { id: JOB, name: 'งานเดี่ยว', dept: 'print', staff: 'sm74', orderId: null };

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(200);
    expect(h.markerReads).toBe(0);
  });

  it('a cancelled parent order is refused before any line is claimed', async () => {
    loadOrderMock.mockResolvedValue({ order: { status: 'cancelled' } });

    const res = await POST(mkReq({ id: JOB }));

    expect(res.status).toBe(409);
    expect(restoreRows()).toEqual([]);
    expect(h.db.links).toEqual([expect.objectContaining({ lineKey: 'L1', orderId: OLD, draftId: 'dOld' })]);
  });
});
