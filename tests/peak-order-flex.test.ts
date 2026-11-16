import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_BASE, FLEX_LABEL_MAX, TEXT, formatAmount,
  whoCard, choicesCard, statusCard, modeCard, unitCard, graphicCard, pressCard,
  dateCard, summaryCard, dupCard, createdCard, type Card,
} from '@/lib/peak-order/flex';
import { decodePostback, type OrderPostback } from '@/lib/peak-order/postback';
import { QTY_UNITS, ORDERERS } from '@/lib/order-constants';
import { STAFF } from '@/lib/board';
import { NO_NAME } from '@/lib/peak-order/mapper';
import type { DraftRow, DraftUnit } from '@/lib/peak-order/db';
import type { QuotationChoice } from '@/lib/peak-order/resolve';

type Obj = Record<string, unknown>;

// ─── generic walkers ───────────────────────────────────────────────
function walk(node: unknown, fn: (o: Obj) => void): void {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (node && typeof node === 'object') {
    fn(node as Obj);
    Object.values(node as Obj).forEach((v) => walk(v, fn));
  }
}
const actions = (c: Card): Obj[] => { const out: Obj[] = []; walk(c.flex, (o) => { if (o.type === 'postback' || o.type === 'datetimepicker' || o.type === 'uri') out.push(o); }); return out; };
const pbActions = (c: Card) => actions(c).filter((a) => a.type !== 'uri');
const decoded = (c: Card) => pbActions(c).map((a) => ({ a, p: decodePostback(a.data as string) }));
const labels = (c: Card) => actions(c).map((a) => a.label as string);
const bytes = (c: Card) => Buffer.byteLength(JSON.stringify(c.flex), 'utf8');

function invariants(c: Card) {
  const f = c.flex as { type: string; altText: string; contents: Obj };
  expect(f.type).toBe('flex');
  expect(f.altText.length).toBeGreaterThan(0);
  expect(f.altText.length).toBeLessThanOrEqual(400);
  expect(c.text.length).toBeGreaterThan(0);
  expect(c.text.length).toBeLessThanOrEqual(5000);
  expect(f.contents.type).toBe('bubble');
  for (const a of actions(c)) {
    const l = a.label as string;
    expect(l.length).toBeGreaterThan(0);
    expect(l.length).toBeLessThanOrEqual(FLEX_LABEL_MAX);
    expect([...l].length).toBeLessThanOrEqual(FLEX_LABEL_MAX);
  }
  for (const { a, p } of decoded(c)) {
    expect((a.data as string).length).toBeLessThanOrEqual(300);
    expect(p).not.toBeNull();
  }
  walk(c.flex, (o) => { if (o.type === 'text') { expect(typeof o.text).toBe('string'); expect((o.text as string).length).toBeGreaterThan(0); } });
  expect(bytes(c)).toBeLessThan(30000);
}

// ─── fixtures ──────────────────────────────────────────────────────
const lines = (n: number, desc = 'ไวนิลขนาด 1x2 เมตร\nพับขอบ') =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, description: `${desc} ${i}`, quantity: 10, price: 100 }));

function mkUnit(over: Partial<DraftUnit> = {}): DraftUnit {
  return { lineKeys: ['k0'], name: 'ไวนิลขนาด 1x2 เมตร', qty: '10', notes: 'n', choices: {}, ...over };
}
function mkDraft(over: Partial<DraftRow> = {}): DraftRow {
  return {
    id: 'abcdefghijkl', groupId: 'C1', lineUserId: 'U1', orderer: 'กิ๊ฟ', qoCode: 'QO-20260900097',
    snapshot: {
      quotation: { code: 'QO-20260900097', status: 'Approve', issuedDate: '2026-09-15', contactCode: 'C1', netAmount: 3210, lines: lines(1) },
      customerName: 'ไทยฟูดส์ อาหารสัตว์',
    },
    mode: 'single', units: [mkUnit()], unitIdx: 0, step: 'unit', creatingKind: null, lastTouchedAt: '2026-11-14T00:00:00Z',
    ...over,
  };
}
const split = (idx = 1) => mkDraft({ mode: 'split', units: [mkUnit(), mkUnit({ lineKeys: ['k1'] }), mkUnit({ lineKeys: ['k2'] })], unitIdx: idx });
const choice = (i: number, over: Partial<QuotationChoice> = {}): QuotationChoice => ({
  code: `QO-2026090009${i}`, issuedDate: '2026-09-15', customerName: 'ไทยฟูดส์', netAmount: 3210, firstLine: `ไวนิล ${i}`, opened: false, ...over,
});

// ─── tests ─────────────────────────────────────────────────────────
describe('formatAmount', () => {
  it('is deterministic (no ICU)', () => {
    expect(formatAmount(3210)).toBe('3,210 บ.');
    expect(formatAmount(1234567.5)).toBe('1,234,567.50 บ.');
    expect(formatAmount(0)).toBe('0 บ.');
    expect(formatAmount(null)).toBe('');
    expect(formatAmount(NaN)).toBe('');
  });
});

describe('whoCard', () => {
  it('has one button per ORDERERS + ไม่ใช่ฉัน, all carrying args', () => {
    const c = whoCard('ไทยฟูดส์ ไวนิล');
    invariants(c);
    const d = decoded(c).map((x) => x.p);
    expect(d).toEqual([
      ...ORDERERS.map((_, i) => ({ a: 'who', orderer: i, args: 'ไทยฟูดส์ ไวนิล' })),
      { a: 'who', orderer: -1, args: 'ไทยฟูดส์ ไวนิล' },
    ]);
    expect(labels(c)).toEqual([...ORDERERS, 'ไม่ใช่ฉัน']);
  });
  it('survives a huge args string (dropped from postback, never throws)', () => {
    const c = whoCard('x'.repeat(2000));
    invariants(c);
    expect(decoded(c)).toHaveLength(ORDERERS.length + 1);
  });
});

describe('choicesCard', () => {
  it('lists rows with pick buttons and the opened badge', () => {
    const c = choicesCard('ไทยฟูดส์ ไวนิล เจอ 2 ใบ', [choice(1), choice(2, { opened: true })]);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'pick', code: 'QO-20260900091' }, { a: 'pick', code: 'QO-20260900092' },
    ]);
    expect(labels(c)).toEqual(['ใบที่ 1', 'ใบที่ 2']);
    expect(JSON.stringify(c.flex)).toContain('✅ เปิดงานแล้ว');
    expect(JSON.stringify(c.flex)).toContain('3,210 บ.');
    expect(c.text).toContain('QO-20260900092');
    expect(c.text).toContain('เปิดงานแล้ว');
  });
  it('empty customer name / first line / zero choices still valid', () => {
    invariants(choicesCard('h', [choice(1, { customerName: '', firstLine: '', netAmount: null })]));
    invariants(choicesCard('', []));
    invariants(choicesCard('h', [choice(1)], 'ไม่เจอคำที่ค้น'));
  });
  it('R4: a 400-char code is listed without a button, no throw', () => {
    const big = 'Q'.repeat(400);
    const c = choicesCard('h', [choice(1, { code: big }), choice(2)]);
    invariants(c);
    expect(decoded(c)).toHaveLength(1);
    expect(JSON.stringify(c.flex)).not.toContain(big);
  });
  it('caps listed rows at 8 with an …อีก line', () => {
    const c = choicesCard('h', Array.from({ length: 12 }, (_, i) => choice(i)));
    invariants(c);
    expect(decoded(c)).toHaveLength(8);
    expect(c.text).toContain('…อีก 4 รายการ');
  });
});

describe('statusCard', () => {
  const opened = [{ orderId: 101, name: 'ไวนิล', isDraft: false }, { orderId: 102, name: 'ป้าย', isDraft: true }];
  it('remaining -> เปิดรายการที่เหลือ rest button; uri links per order', () => {
    const c = statusCard({ qoCode: 'QO-1', customerName: 'ไทยฟูดส์', opened, remaining: [{ name: 'ค่าส่ง' }] });
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([{ a: 'rest', code: 'QO-1' }]);
    expect(labels(c)).toContain('เปิดรายการที่เหลือ');
    const uris = actions(c).filter((a) => a.type === 'uri').map((a) => a.uri);
    expect(uris).toEqual([`${DASHBOARD_BASE}/orders/101/edit`, `${DASHBOARD_BASE}/orders/102/edit`]);
    expect(c.text).toContain('ค่าส่ง');
  });
  it('remaining: [] has no เปิดรายการที่เหลือ', () => {
    const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened, remaining: [] });
    invariants(c);
    expect(labels(c)).not.toContain('เปิดรายการที่เหลือ');
    expect(decoded(c)).toHaveLength(0);
  });
  it('draft is marked as draft in text', () => {
    const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened, remaining: [] });
    expect(c.text).toContain('ใบร่าง');
  });
  it('R4: 400-char code -> no rest button, rows still shown', () => {
    const c = statusCard({ qoCode: 'Q'.repeat(400), customerName: 'x', opened: [], remaining: [{ name: 'ค่าส่ง' }] });
    invariants(c);
    expect(labels(c)).not.toContain('เปิดรายการที่เหลือ');
    expect(c.text).toContain('ค่าส่ง');
  });
  it('empty customer / empty names / 12 remaining lines', () => {
    invariants(statusCard({ qoCode: 'QO-1', customerName: '', opened: [{ orderId: 5, name: '', isDraft: false }], remaining: [{ name: '' }] }));
    const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened: [], remaining: Array.from({ length: 12 }, (_, i) => ({ name: 'บรรทัด ' + i + 'ก'.repeat(5000) })) });
    invariants(c);
    expect(c.text).toContain('…อีก 4 รายการ');
  });
});

describe('statusCard title says what is true', () => {
  const title = (c: Card) => ((c.flex as { contents: { body: { contents: Obj[] } } }).contents.body.contents[0].text as string);
  const one = [{ orderId: 101, name: 'ไวนิล', isDraft: false }];
  it('something opened → "เปิดงานแล้ว"', () => {
    for (const remaining of [[], [{ name: 'ค่าส่ง' }]]) {
      const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened: one, remaining });
      invariants(c);
      expect(title(c)).toBe('QO-1 · เปิดงานแล้ว');
      expect(c.text.split('\n')[0]).toBe('QO-1 · เปิดงานแล้ว');
    }
  });
  it('nothing opened, lines remaining → "ยังไม่ได้เปิดงาน" (+ rest button)', () => {
    const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened: [], remaining: [{ name: 'ค่าส่ง' }] });
    invariants(c);
    expect(title(c)).toBe('QO-1 · ยังไม่ได้เปิดงาน');
    expect(title(c)).not.toContain('เปิดงานแล้ว');
    expect(labels(c)).toContain('เปิดรายการที่เหลือ');
  });
  it('nothing opened, nothing remaining (in-flight claim) → "มีคนกำลังเปิดงานใบนี้อยู่" + try-again line', () => {
    const c = statusCard({ qoCode: 'QO-1', customerName: 'x', opened: [], remaining: [] });
    invariants(c);
    expect(title(c)).toBe('QO-1 · มีคนกำลังเปิดงานใบนี้อยู่');
    expect(c.text).toContain('ลองใหม่อีกครั้งในอีกสักครู่');
    expect(c.text).not.toContain('เปิดงานแล้ว');
    expect(actions(c)).toHaveLength(0);
  });
});

describe('modeCard', () => {
  it('merged / split buttons (+ N) and cancel', () => {
    const d = mkDraft({ mode: null, units: [], step: 'mode', snapshot: { ...mkDraft().snapshot, quotation: { ...mkDraft().snapshot.quotation, lines: lines(4) } } });
    const c = modeCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'mode', draft: d.id, v: 'merged' }, { a: 'mode', draft: d.id, v: 'split' }, { a: 'x', draft: d.id },
    ]);
    expect(labels(c)).toEqual(['รวมเป็น 1 งาน', 'แยกเป็น 4 งาน', 'ยกเลิก']);
  });
  it('Review Focus 1: 5000-char description + 12 lines -> small, 8 lines + …อีก', () => {
    const big = 'ก'.repeat(5000);
    const q = { ...mkDraft().snapshot.quotation, lines: lines(12, big) };
    const d = mkDraft({ mode: null, units: [], snapshot: { quotation: q, customerName: 'ค'.repeat(5000) } });
    const c = modeCard(d);
    invariants(c);
    expect(bytes(c)).toBeLessThan(30000);
    expect(c.text).toContain('…อีก 4 รายการ');
    expect(c.text).toContain('8.');
    expect(c.text).not.toContain('9.');
    expect(JSON.stringify(c.flex)).toContain('…อีก 4 รายการ');
    expect(c.text).not.toContain(big);
  });
  it('empty / whitespace description falls back to NO_NAME', () => {
    const q = { ...mkDraft().snapshot.quotation, lines: [{ key: 'a', description: '   \n ', quantity: null, price: null }, { key: 'b', description: '', quantity: 0, price: null }], status: '', netAmount: null };
    const c = modeCard(mkDraft({ mode: null, units: [], snapshot: { quotation: q, customerName: '' } }));
    invariants(c);
    expect(c.text).toContain(NO_NAME);
  });
});

describe('unitCard', () => {
  it('9 unit buttons idx 0-8 matching QTY_UNITS, cancel, no skip for single', () => {
    const d = mkDraft();
    const c = decoded(unitCard(d));
    invariants(unitCard(d));
    const units = c.filter((x) => x.p?.a === 'unit');
    expect(units).toHaveLength(9);
    expect(units.map((x) => (x.p as Extract<OrderPostback, { a: 'unit' }>).v)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(units.map((x) => x.a.label)).toEqual([...QTY_UNITS]);
    expect(c.filter((x) => x.p?.a === 'unit' && (x.p as { v: unknown }).v === 'skip')).toHaveLength(0);
    expect(c.at(-1)?.p).toEqual({ a: 'x', draft: d.id });
    expect(labels(unitCard(d))).not.toContain('ข้ามรายการนี้');
  });
  it('split: skip button with unitIdx, header รายการที่ 2/3', () => {
    const d = split(1);
    const c = unitCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toContainEqual({ a: 'unit', draft: d.id, u: 1, v: 'skip' });
    expect(decoded(c).filter((x) => x.p?.a === 'unit').every((x) => (x.p as { u: number }).u === 1)).toBe(true);
    expect(JSON.stringify(c.flex)).toContain('รายการที่ 2/3');
    expect(c.text).toContain('รายการที่ 2/3');
    expect(c.text).toContain('ข้ามรายการนี้');
  });
  it('shows net amount and status; empty qty omits quantity', () => {
    const c = unitCard(mkDraft());
    expect(JSON.stringify(c.flex)).toContain('3,210 บ.');
    expect(JSON.stringify(c.flex)).toContain('Approve');
    const e = unitCard(mkDraft({ units: [mkUnit({ qty: '' })] }));
    expect(e.text).not.toMatch(/จำนวน \d/);
  });
  it('does not throw on empty units / out-of-range unitIdx', () => {
    invariants(unitCard(mkDraft({ units: [], unitIdx: 5 })));
  });
});

describe('graphicCard', () => {
  it('staff buttons + none; same only when canCopyPrevious', () => {
    const d = split(1);
    const on = graphicCard(d, true);
    const off = graphicCard(d, false);
    invariants(on); invariants(off);
    const ps = decoded(on).map((x) => x.p);
    expect(ps).toEqual([
      ...STAFF.graphic.map((s) => ({ a: 'gfx', draft: d.id, u: 1, v: s.id })),
      { a: 'gfx', draft: d.id, u: 1, v: 'none' },
      { a: 'gfx', draft: d.id, u: 1, v: 'same' },
    ]);
    expect(labels(on)).toEqual([...STAFF.graphic.map((s) => s.name), 'ไม่ผ่านกราฟฟิก', 'เหมือนใบก่อน']);
    expect(labels(off)).not.toContain('เหมือนใบก่อน');
    expect(labels(off)).toContain('ไม่ผ่านกราฟฟิก');
  });
  it('merged first card shows amount; others do not', () => {
    expect(JSON.stringify(graphicCard(mkDraft({ mode: 'merged' }), false).flex)).toContain('3,210 บ.');
    expect(JSON.stringify(graphicCard(mkDraft({ mode: 'single' }), false).flex)).not.toContain('3,210 บ.');
  });
});

describe('pressCard', () => {
  it('has ยังไม่ระบุ when a graphic was chosen', () => {
    const d = mkDraft({ units: [mkUnit({ choices: { graphic: 'pook' } })] });
    const c = pressCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      ...STAFF.print.map((s) => ({ a: 'press', draft: d.id, u: 0, v: s.id })),
      { a: 'press', draft: d.id, u: 0, v: 'none' },
    ]);
    expect(labels(c)).toContain('ยังไม่ระบุ');
    expect(c.text).toContain('ปุ๊ก');
  });
  it('omits ยังไม่ระบุ when graphic is empty', () => {
    const d = mkDraft({ units: [mkUnit({ choices: { graphic: '' } })] });
    const c = pressCard(d);
    invariants(c);
    expect(labels(c)).not.toContain('ยังไม่ระบุ');
    expect(decoded(c)).toHaveLength(STAFF.print.length);
    expect(c.text).not.toContain('ยังไม่ระบุ');
  });
});

describe('dateCard', () => {
  it('quick buttons + datetimepicker (mode date, min today, initial tomorrow)', () => {
    const d = split(2);
    const c = dateCard(d, '2026-11-14');
    invariants(c);
    expect(labels(c)).toEqual(['พรุ่งนี้', '+2 วัน', '+3 วัน', '+5 วัน', '+7 วัน', '📅 เลือกวันเอง']);
    expect(decoded(c).map((x) => x.p)).toEqual(
      ['+1', '+2', '+3', '+5', '+7', 'pick'].map((v) => ({ a: 'date', draft: d.id, u: 2, v })),
    );
    const picker = actions(c).find((a) => a.type === 'datetimepicker')!;
    expect(picker.mode).toBe('date');
    expect(picker.min).toBe('2026-11-14');
    expect(picker.initial).toBe('2026-11-15');
    expect(actions(c).filter((a) => a.type === 'datetimepicker')).toHaveLength(1);
  });
  it('month/year rollover and malformed today do not throw', () => {
    const p = actions(dateCard(mkDraft(), '2026-12-31')).find((a) => a.type === 'datetimepicker')!;
    expect(p.initial).toBe('2027-01-01');
    const q = actions(dateCard(mkDraft(), 'garbage')).find((a) => a.type === 'datetimepicker')!;
    expect(q.initial).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('summaryCard', () => {
  const d = mkDraft({
    orderer: 'กิ๊ฟ',
    units: [mkUnit({ qty: '10', choices: { qtyUnit: 'ชิ้น', graphic: 'pook', press: 'inkjet', dateDue: '2026-11-20' } })],
    step: 'confirm',
  });
  it('exactly 3 buttons: create, draft, x with fixed labels', () => {
    const c = summaryCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'ok', draft: d.id, u: 0, v: 'create' }, { a: 'ok', draft: d.id, u: 0, v: 'draft' }, { a: 'x', draft: d.id },
    ]);
    expect(labels(c)).toEqual(['✅ สร้างงาน', '📝 บันทึกเป็นใบร่างในแดชบอร์ด', 'ยกเลิก']);
    expect(actions(c)).toHaveLength(3);
  });
  it('shows name, qty+unit, customer, graphic, press, date, orderer (text and flex)', () => {
    const c = summaryCard(d);
    for (const s of ['ไวนิลขนาด 1x2 เมตร', '10 ชิ้น', 'ไทยฟูดส์ อาหารสัตว์', 'ปุ๊ก', 'Inkjet/Copyprint (แป๋)', '20/11/2026', 'กิ๊ฟ']) {
      expect(c.text).toContain(s);
      expect(JSON.stringify(c.flex)).toContain(s);
    }
  });
  it('none/blank choices -> ไม่ผ่านกราฟฟิก / ยังไม่ระบุ; no qty -> no จำนวน', () => {
    const e = mkDraft({ units: [mkUnit({ qty: '', choices: { graphic: '', press: '', dateDue: '2026-11-20' } })] });
    const c = summaryCard(e);
    invariants(c);
    expect(c.text).toContain('ไม่ผ่านกราฟฟิก');
    expect(c.text).toContain('ยังไม่ระบุ');
    expect(c.text).not.toContain('จำนวน');
  });
  it('split shows รายการที่ n/N; empty name -> NO_NAME; empty customer ok', () => {
    const e = split(0);
    e.units[0] = mkUnit({ name: '', choices: { graphic: 'pook', press: 'mo', dateDue: '2026-11-20' } });
    e.snapshot = { ...e.snapshot, customerName: '' };
    const c = summaryCard(e);
    invariants(c);
    expect(c.text).toContain('รายการที่ 1/3');
    expect(c.text).toContain(NO_NAME);
  });
});

describe('dupCard', () => {
  it('สร้างต่อ (dup force) + ยกเลิก; lists duplicates', () => {
    const d = mkDraft();
    const c = dupCard(d, [{ id: 7, name: 'ไวนิล' }, { id: 8, name: '' }]);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([{ a: 'dup', draft: d.id, u: 0, v: 'force' }, { a: 'x', draft: d.id }]);
    expect(labels(c)).toEqual(['สร้างต่อ', 'ยกเลิก']);
    expect(c.text).toContain('#7');
  });
  it('12 duplicates -> 8 + …อีก', () => {
    const c = dupCard(mkDraft(), Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'ก'.repeat(5000) })));
    invariants(c);
    expect(c.text).toContain('…อีก 4 รายการ');
  });
});

describe('createdCard', () => {
  it('real order: edit + print uri buttons, PIN shown', () => {
    const c = createdCard({ orderId: 260900123, name: 'ไวนิล', pin: '4821', isDraft: false });
    invariants(c);
    expect(actions(c).map((a) => [a.type, a.uri, a.label])).toEqual([
      ['uri', `${DASHBOARD_BASE}/orders/260900123/edit`, 'เปิดใบสั่งงาน'],
      ['uri', `${DASHBOARD_BASE}/orders/260900123/print`, 'พิมพ์ใบสั่งงาน'],
    ]);
    expect(c.text).toContain('4821');
    expect(c.text).toContain('#260900123');
  });
  it('draft: one uri button to /edit, none to /print', () => {
    const c = createdCard({ orderId: 55, name: 'ไวนิล', pin: '', isDraft: true });
    invariants(c);
    expect(actions(c)).toHaveLength(1);
    expect(actions(c)[0]).toMatchObject({ type: 'uri', uri: `${DASHBOARD_BASE}/orders/55/edit`, label: 'เปิดใบร่างในแดชบอร์ด' });
    expect(JSON.stringify(c.flex)).not.toContain('/print');
    expect(c.text).toContain('ใบร่าง');
  });
  it('empty name / bad id / empty pin do not break the card', () => {
    invariants(createdCard({ orderId: 0, name: '', pin: '', isDraft: false }));
  });
});

describe('TEXT', () => {
  it('all strings non-empty, notOwner names the owner', () => {
    for (const [k, v] of Object.entries(TEXT)) {
      if (typeof v === 'string') expect(v.length, k).toBeGreaterThan(0);
    }
    expect(TEXT.notOwner('กิ๊ฟ')).toContain('กิ๊ฟ');
    expect(TEXT.notOwner('')).toBeTruthy();
  });
});

describe('every button of every card round-trips through decodePostback', () => {
  it('draft id and unitIdx are right on every draft-bound button', () => {
    const d = split(2);
    d.units[2].choices = { graphic: 'pook', qtyUnit: 'ชิ้น', press: 'mo', dateDue: '2026-11-20' };
    const cards = [modeCard(d), unitCard(d), graphicCard(d, true), pressCard(d), dateCard(d, '2026-11-14'), summaryCard(d), dupCard(d, [])];
    for (const c of cards) {
      invariants(c);
      for (const { p } of decoded(c)) {
        const x = p as { draft: string; u?: number };
        expect(x.draft).toBe(d.id);
        if ('u' in x) expect(x.u).toBe(2);
      }
    }
  });
});

describe('FLEX_LABEL_MAX', () => {
  it('is 40 (R1) and the long 📝 label fits unshortened', () => {
    expect(FLEX_LABEL_MAX).toBe(40);
    expect([...'📝 บันทึกเป็นใบร่างในแดชบอร์ด'].length).toBeLessThanOrEqual(40);
  });
});
