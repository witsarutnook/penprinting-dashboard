import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { resetMockPostgres, queueResult, queueError, sqlCalls } from './helpers/mock-postgres';

// TEMPORARY — goes away with app/api/admin/peak/line-text-census (PATTERNS §2.5).

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

vi.mock('@/lib/peak/mcp-client', () => ({ createPeakClient: () => ({}) }));
const newestMock = vi.fn();
const getMock = vi.fn();
vi.mock('@/lib/peak/read', () => ({
  createPeakReader: () => ({
    newestQuotations: (...a: unknown[]) => newestMock(...a),
    getQuotation: (...a: unknown[]) => getMock(...a),
  }),
}));

import { GET as census } from '@/app/api/admin/peak/line-text-census/route';

const row = (code: string) => ({ code, issuedDate: '2026-11-17', contactCode: 'C-SECRET', netAmount: 98765 });
const quotation = (code: string, lines: Array<{ description: string; quantity: number | null }>) => ({
  ...row(code),
  status: 'Approve',
  lines: lines.map((l, i) => ({ key: `k${i}`, description: l.description, quantity: l.quantity, price: 43210 })),
});

beforeEach(() => {
  vi.resetAllMocks();
  resetMockPostgres();
  sessionMock.mockResolvedValue({ user: 'nook', role: 'admin' });
});

describe('GET /api/admin/peak/line-text-census', () => {
  it('non-admin gets the requireSession response; neither Peak nor the database is read', async () => {
    sessionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await census();
    expect(res.status).toBe(403);
    expect(sessionMock).toHaveBeenCalledWith(['admin']);
    expect(newestMock).not.toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns line text, quantity and what the rules read — no customer, no amounts, contacts redacted', async () => {
    queueResult({ rows: [] });
    newestMock.mockResolvedValue([row('QO-3'), row('QO-2'), row('QO-1')]);
    getMock.mockImplementation(async (code: string) => {
      if (code === 'QO-2') return null; // vanished between list and get
      if (code === 'QO-1') throw new Error('boom');
      return quotation('QO-3', [
        { description: 'ใบปลิว A4\nกระดาษอาร์ตมัน 130 แกรม พิมพ์ 4 สี 2 หน้า\nเคลือบด้าน', quantity: 5000 },
        { description: 'ติดต่อ 081-234-5678 หรือ 043123456 / a.b@example.com เลขบัญชี 1234567890123', quantity: null },
      ]);
    });

    const res = await census();
    const text = await res.text();
    const body = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(newestMock.mock.calls[0][0].dateStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.peak.ok).toBe(true);
    expect(body.peak.asked).toBe(3);
    expect(body.peak.failed).toBe(2);
    expect(body.peak.quotations).toEqual([
      {
        code: 'QO-3',
        status: 'Approve',
        lines: [
          {
            q: 5000,
            d: 'ใบปลิว A4\nกระดาษอาร์ตมัน 130 แกรม พิมพ์ 4 สี 2 หน้า\nเคลือบด้าน',
            f: { size: 'A4', paperInner: 'อาร์ตมัน 130 แกรม', innerColor: '4สี', coatMatte: true },
            s: 'ขนาด A4 · อาร์ตมัน 130 แกรม 4สี · เคลือบด้าน',
            // spec §13: the name line and the line that is nothing but a ticked box leave the notes
            n: 'กระดาษอาร์ตมัน 130 แกรม พิมพ์ 4 สี 2 หน้า',
          },
          // the whole line is the order's name -> nothing left for the notes; still masked
          { q: null, d: 'ติดต่อ [phone] หรือ [phone] / [email] เลขบัญชี [number]', f: {}, s: '', n: '' },
        ],
      },
    ]);
    // what the rule set reads from these lines (plan Task 2)
    expect(body.peak.coverage).toEqual({
      lines: 2,
      anyField: 1,
      perField: { size: 1, paperInner: 1, innerColor: 1, coatMatte: 1 },
      notes: { linesBefore: 4, linesAfter: 1, shorter: 2 },
    });
    // identity and money never leave the server
    expect(text).not.toContain('C-SECRET');
    expect(text).not.toContain('98765');
    expect(text).not.toContain('43210');
  });

  it('counts how the team fills the spec fields of existing orders (aggregates only)', async () => {
    newestMock.mockResolvedValue([]);
    queueResult({
      rows: [
        { r: { size: 'A4', sizeUnit: 'ซม.', paperCover: 'อาร์ตการ์ด 350', coverColor: '4สี', coatMatte: true, glue: true, plateSize: ['ตัด 4'], customer: 'ลูกค้าลับ', notes: 'โน้ตลับ' } },
        { r: { size: 'A4', sizeUnit: 'ซม.', paperInner: 'ปอนด์ 80', innerColor: '1สี', innerColorNote: 'ดำ', coatMatte: true } },
        { r: JSON.stringify({ size: ' 21x29.7 ', sizeUnit: 'ซม.', paperCover: 'อาร์ตการ์ด 350', paperInner: 'ปอนด์ 80', spine: true }) },
        { r: { size: '', paperCover: '  ' } },
        { r: null },
      ],
    });

    const body = await (await census()).json();

    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toContain('FROM orders');
    expect(body.form.ok).toBe(true);
    expect(body.form.rows).toBe(4);
    expect(body.form.paperFields).toEqual({ coverOnly: 1, innerOnly: 1, both: 1, none: 1 });
    expect(body.form.top.size).toEqual([['A4 [ซม.]', 2], ['21x29.7 [ซม.]', 1]]);
    expect(body.form.top.paperCover).toEqual([['อาร์ตการ์ด 350', 2]]);
    expect(body.form.top.paperInner).toEqual([['ปอนด์ 80', 2]]);
    expect(body.form.top.coverColor).toEqual([['4สี', 1]]);
    expect(body.form.top.innerColorNote).toEqual([['ดำ', 1]]);
    expect(body.form.top.plateSize).toEqual([['ตัด 4', 1]]);
    expect(body.form.flags.coatMatte).toBe(2);
    expect(body.form.flags.glue).toBe(1);
    expect(body.form.flags.spine).toBe(1);
    expect(body.form.flags.coatGloss).toBe(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain('ลูกค้าลับ');
    expect(text).not.toContain('โน้ตลับ');
  });

  it('one side failing does not hide the other', async () => {
    queueError(new Error('db down'));
    newestMock.mockResolvedValue([row('QO-9')]);
    getMock.mockResolvedValue(quotation('QO-9', [{ description: 'นามบัตร', quantity: 2 }]));
    let body = await (await census()).json();
    expect(body.form.ok).toBe(false);
    expect(body.peak.quotations).toHaveLength(1);

    queueResult({ rows: [{ r: { size: 'A5' } }] });
    newestMock.mockRejectedValue(new Error('peak down'));
    body = await (await census()).json();
    expect(body.peak.ok).toBe(false);
    expect(typeof body.peak.error).toBe('string');
    expect(body.form.rows).toBe(1);
  });
});
