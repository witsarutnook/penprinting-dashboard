import { describe, expect, it } from 'vitest';
import type { PeakQuotation } from '@/lib/peak/read';
import { emptyOrderForm } from '@/lib/photobook';
import { QTY_UNITS } from '@/lib/order-constants';
import { NO_NAME, addDaysISO, bangkokISODate, buildOrderBody, firstLine, formatQty, planUnits } from '@/lib/peak-order/mapper';

const Q = (lines: Array<[string, string, number | null]>): PeakQuotation => ({
  code: 'QO-20261100072',
  status: 'approved',
  issuedDate: '2026-11-01',
  contactCode: 'C1',
  netAmount: null,
  lines: lines.map(([key, description, quantity]) => ({ key, description, quantity, price: 5 })),
});

describe('firstLine', () => {
  it('strips bullets and takes the first non-empty line', () => {
    expect(firstLine('- สติกเกอร์ขาวมุกขนาด 14x10 ซม.\n- พิมพ์ 4 สี')).toBe('สติกเกอร์ขาวมุกขนาด 14x10 ซม.');
    expect(firstLine('\n  \n• * ป้าย')).toBe('ป้าย');
  });
  it('empty / whitespace -> NO_NAME', () => {
    expect(firstLine('')).toBe(NO_NAME);
    expect(firstLine('\n  \n')).toBe(NO_NAME);
    expect(firstLine('- \n * ')).toBe(NO_NAME);
  });
  it('clips to 120 chars', () => {
    expect(Array.from(firstLine('ก'.repeat(300)))).toHaveLength(120);
  });
});

describe('formatQty', () => {
  it('plain integers and decimals', () => {
    expect(formatQty(10)).toBe('10');
    expect(formatQty(50000)).toBe('50000');
    expect(formatQty(0.125)).toBe('0.125');
    expect(formatQty(12.5)).toBe('12.5');
  });
  it('no float noise', () => {
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
    expect(formatQty(1.1 * 3)).toBe('3.3');
  });
  it('0 / null / NaN -> empty', () => {
    expect(formatQty(0)).toBe('');
    expect(formatQty(null)).toBe('');
    expect(formatQty(NaN)).toBe('');
  });
});

describe('dates', () => {
  it('bangkokISODate is the Asia/Bangkok calendar day', () => {
    expect(bangkokISODate(new Date('2026-11-14T18:30:00Z'))).toBe('2026-11-15');
    expect(bangkokISODate(new Date('2026-11-14T16:59:59Z'))).toBe('2026-11-14');
  });
  it('addDaysISO is pure calendar arithmetic', () => {
    expect(addDaysISO('2026-11-28', 3)).toBe('2026-12-01');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysISO('2026-11-14', -30)).toBe('2026-10-15');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('planUnits', () => {
  it('single', () => {
    const q = Q([['a', '- ไวนิล 1x2\nรายละเอียด', 3]]);
    expect(planUnits(q, 'single')).toEqual([
      { lineKeys: ['a'], name: 'ไวนิล 1x2', qty: '3', notes: '- ไวนิล 1x2\nรายละเอียด\n\nอ้างอิง Peak: QO-20261100072' },
    ]);
  });
  it('single requires exactly one line', () => {
    expect(() => planUnits(Q([]), 'single')).toThrow('planUnits single requires exactly one line');
    expect(() => planUnits(Q([['a', 'x', 1], ['b', 'y', 1]]), 'single')).toThrow('planUnits single requires exactly one line');
  });
  it('split with and without onlyKeys', () => {
    const q = Q([['a', 'A', 1], ['b', 'B', 2], ['c', 'C', 3]]);
    expect(planUnits(q, 'split').map((u) => u.lineKeys)).toEqual([['a'], ['b'], ['c']]);
    expect(planUnits(q, 'split', ['c', 'a']).map((u) => u.name)).toEqual(['A', 'C']);
  });
  it('merged of 3 lines', () => {
    const q = Q([['a', 'งาน A', 1000], ['b', 'งาน B', 3000], ['c', 'งาน C', null]]);
    const [u, ...rest] = planUnits(q, 'merged');
    expect(rest).toHaveLength(0);
    expect(u.lineKeys).toEqual(['a', 'b', 'c']);
    expect(u.name).toBe('งาน A (+2 รายการ)');
    expect(u.qty).toBe('');
    expect(u.notes).toContain('รายการ 2 (จำนวน 3000): งาน B');
    expect(u.notes.endsWith('\n\nอ้างอิง Peak: QO-20261100072')).toBe(true);
  });
  it('empty description still yields a unit named NO_NAME; long text kept in notes', () => {
    const [u] = planUnits(Q([['a', '   ', 2]]), 'single');
    expect(u.name).toBe(NO_NAME);
    const long = 'ข'.repeat(500);
    const [v] = planUnits(Q([['a', long, 2]]), 'single');
    expect(Array.from(v.name)).toHaveLength(120);
    expect(v.notes).toContain(long);
  });
  it('merged name stays within 120 chars', () => {
    const [u] = planUnits(Q([['a', 'ก'.repeat(300), 1], ['b', 'x', 1]]), 'merged');
    expect(Array.from(u.name).length).toBeLessThanOrEqual(120);
    expect(u.name.endsWith(' (+1 รายการ)')).toBe(true);
  });
});

describe('buildOrderBody', () => {
  const unit = { lineKeys: ['a', 'b'], name: 'ป้าย', qty: '10', notes: 'n' };
  const base = {
    unit,
    choices: { qtyUnit: 'ชิ้น', graphic: 'pook', press: 'inkjet', dateDue: '2026-11-20' },
    customerName: 'ไทยฟูดส์',
    orderer: 'นุ๊ก',
    qoCode: 'QO-20261100072',
    draftId: 'd-1',
    todayISO: '2026-11-14',
    asDraft: false,
  };
  it('maps fields and the peak marker; never sets price or status', () => {
    const b = buildOrderBody(base);
    expect(b).toMatchObject({
      name: 'ป้าย', customer: 'ไทยฟูดส์', dateIn: '2026-11-14', dateDue: '2026-11-20', qty: '10', qtyUnit: 'ชิ้น',
      notes: 'n', assignStaff: 'pook', forwardPrint: 'inkjet', orderer: 'นุ๊ก', orderType: 'normal',
      peak: { code: 'QO-20261100072', lineKeys: ['a', 'b'], draftId: 'd-1' },
    });
    expect(QTY_UNITS).toContain(b.qtyUnit);
    expect(b.peak).toEqual({ code: 'QO-20261100072', lineKeys: ['a', 'b'], draftId: 'd-1' });
    expect('price' in b).toBe(false);
    expect('status' in b).toBe(false);
    expect('force' in b).toBe(false);
  });
  it('asDraft / force / empty graphic', () => {
    const b = buildOrderBody({ ...base, asDraft: true, force: true, choices: { ...base.choices, graphic: '' } });
    expect(b.status).toBe('draft');
    expect(b.force).toBe(true);
    expect(b.assignStaff).toBe('');
  });
  it('merged unit marker lists every line key, exactly', () => {
    const q = Q([['a', 'A', 1], ['b', 'B', 2], ['c', 'C', 3]]);
    const [u] = planUnits(q, 'merged');
    const b = buildOrderBody({ ...base, unit: u, choices: { graphic: 'pook', press: '', dateDue: '2026-11-20' } });
    expect(b.peak).toEqual({ code: 'QO-20261100072', lineKeys: ['a', 'b', 'c'], draftId: 'd-1' });
    expect(Object.keys(b.peak as object).sort()).toEqual(['code', 'draftId', 'lineKeys']);
  });
  it('no qtyUnit keeps the form default', () => {
    const b = buildOrderBody({ ...base, choices: { graphic: 'pook', press: '', dateDue: '2026-11-20' } });
    expect(b.qtyUnit).toBe(emptyOrderForm().qtyUnit);
  });
});
