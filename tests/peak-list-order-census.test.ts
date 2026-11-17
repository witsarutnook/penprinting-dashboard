import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';

// TEMPORARY — goes away with app/api/admin/peak/list-order-census (PATTERNS §2.5).

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

const callMock = vi.fn();
vi.mock('@/lib/peak/mcp-client', () => ({ createPeakClient: () => ({ call: (...a: unknown[]) => callMock(...a) }) }));
const listMock = vi.fn();
vi.mock('@/lib/peak/read', () => ({
  createPeakReader: () => ({ listQuotations: (...a: unknown[]) => listMock(...a) }),
}));

import { GET as census } from '@/app/api/admin/peak/list-order-census/route';

const row = (code: string, issuedDate: string) => ({ code, issuedDate, contactCode: 'C1', netAmount: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  sessionMock.mockResolvedValue({ user: 'nook', role: 'admin' });
});

describe('GET /api/admin/peak/list-order-census', () => {
  it('non-admin gets the requireSession response and Peak is not called', async () => {
    sessionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await census();
    expect(res.status).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
    expect(callMock).not.toHaveBeenCalled();
    expect(sessionMock).toHaveBeenCalledWith(['admin']);
  });

  it('dumps every page in wire order, where the highest codes sit, and what "newest" returns today', async () => {
    // 3 pages; the highest code (QO-0118) is NOT last on the wire.
    const p1 = Array.from({ length: 50 }, (_, i) => row(`QO-${String(i + 1).padStart(4, '0')}`, '2026-10-20'));
    const p2 = Array.from({ length: 50 }, (_, i) => row(`QO-${String(i + 51).padStart(4, '0')}`, '2026-11-10'));
    const p3 = [row('QO-0118', '2026-11-17'), row('QO-0101', '2026-11-16'), row('QO-0110', '2026-11-17')];
    listMock.mockImplementation(async (q: { page: number }) => ({ rows: [p1, p2, p3][q.page - 1] ?? [], total: 103 }));
    callMock.mockImplementation(async (name: string) =>
      name === 'list_quotation'
        ? { PeakQuotations: { resCode: '200', totalQuotation: 103, quotations: [{ code: 'QO-0001', issuedDate: '20261020', secretField: 'x' }] } }
        : { PeakQuotations: { quotations: [{ code: 'QO-0118', status: 'Approve', issuedDate: '20261117', updatedDate: '20261117130500', contactName: 'ลูกค้า ก', products: [] }] } },
    );

    const res = await census();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.total).toBe(103);
    expect(body.pages).toBe(3);
    expect(body.pagesRead).toBe(3);
    expect(listMock.mock.calls.map((c) => c[0].page)).toEqual([1, 2, 3]);
    expect(listMock.mock.calls[0][0].dateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // wire order is kept exactly as received
    expect(body.wire[2]).toEqual({ page: 3, rows: ['QO-0118 2026-11-17', 'QO-0101 2026-11-16', 'QO-0110 2026-11-17'] });
    // highest codes with their wire position (0-based index over the whole window)
    expect(body.topByCode.slice(0, 2)).toEqual([
      { code: 'QO-0118', issuedDate: '2026-11-17', i: 100, page: 3 },
      { code: 'QO-0110', issuedDate: '2026-11-17', i: 102, page: 3 },
    ]);
    // what the current "tail reversed" helper calls newest
    expect(body.tailNewestFirst.slice(0, 3)).toEqual(['QO-0110', 'QO-0101', 'QO-0118']);
    // one date goes backwards along the wire (11-17 -> 11-16)
    expect(body.dateInversions).toBe(1);
    // field NAMES only for the raw payloads, plus values of date/status-like fields
    expect(body.listEnvelopeKeys).toEqual(['quotations', 'resCode', 'totalQuotation']);
    expect(body.listRowKeys).toEqual(['code', 'issuedDate', 'secretField']);
    expect(body.quotationKeys).toEqual(['code', 'contactName', 'issuedDate', 'products', 'status', 'updatedDate']);
    expect(body.quotationDateLike).toEqual({ issuedDate: '20261117', status: 'Approve', updatedDate: '20261117130500' });
    expect(JSON.stringify(body)).not.toContain('ลูกค้า ก');
    expect(typeof body.ms).toBe('number');
  });

  it('reads at most 10 pages and says so', async () => {
    listMock.mockImplementation(async () => ({ rows: [row('QO-1', '2026-11-01')], total: 5000 }));
    callMock.mockResolvedValue({});
    const body = await (await census()).json();
    expect(body.pages).toBe(100);
    expect(body.pagesRead).toBe(10);
    expect(listMock).toHaveBeenCalledTimes(10);
  });

  it('a Peak failure returns only the error class name', async () => {
    class PeakToolError extends Error {
      name = 'PeakToolError';
    }
    listMock.mockRejectedValue(new PeakToolError('Bearer sekret-token leaked'));
    const res = await census();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: 'PeakToolError' });
    expect(text).not.toContain('sekret');
  });

  it('raw-payload key probing never fails the census', async () => {
    listMock.mockImplementation(async () => ({ rows: [row('QO-1', '2026-11-01')], total: 1 }));
    callMock.mockRejectedValue(new Error('boom'));
    const body = await (await census()).json();
    expect(body.ok).toBe(true);
    expect(body.listRowKeys).toEqual([]);
    expect(body.quotationKeys).toEqual([]);
  });
});
