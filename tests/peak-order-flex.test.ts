import { describe, it, expect } from 'vitest';
import {
  DASHBOARD_BASE, FLEX_LABEL_MAX, TEXT, formatAmount,
  whoCard, choicesCard, statusCard, modeCard, unitCard, graphicCard, pressCard, plateCard,
  dateCard, summaryCard, dupCard, createdCard, type Card,
} from '@/lib/peak-order/flex';
import { decodePostback, type OrderPostback } from '@/lib/peak-order/postback';
import { QTY_UNITS, ORDERERS } from '@/lib/order-constants';
import { STAFF } from '@/lib/board';
import { NO_NAME } from '@/lib/peak-order/mapper';
import { plateQuestion } from '@/lib/peak-order/plate';
import { specFromText, withoutPrintMethod } from '@/lib/peak-order/spec-from-text';
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
  it('button labels keep the whole order id visible (prod 2026-11-17: the draft label was cut at "#20261…")', () => {
    const c = statusCard({
      qoCode: 'QO-1',
      customerName: 'x',
      opened: [{ orderId: 202611092, name: 'คู่มือ', isDraft: false }, { orderId: 202611091, name: 'แผ่นพับ', isDraft: true }],
      remaining: [],
    });
    const uriLabels = actions(c).filter((a) => a.type === 'uri').map((a) => String(a.label));
    expect(uriLabels).toEqual(['เปิดใบสั่งงาน #202611092', 'เปิดใบร่าง #202611091']);
    // Width on the card = code points that are not Thai combining marks. The job
    // label is the one seen to fit on a phone; the draft label must not be wider.
    const cells = (s: string) => Array.from(s.replace(/[ัิ-ฺ็-๎]/g, '')).length;
    expect(cells(uriLabels[1])).toBeLessThanOrEqual(cells(uriLabels[0]));
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
    const cards = [modeCard(d), unitCard(d), graphicCard(d, true), pressCard(d), plateCard(d), dateCard(d, '2026-11-14'), summaryCard(d), dupCard(d, [])];
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

// ─── spec read from the line text (spec 2026-11-18) ────────────────
describe('summaryCard — spec that was read', () => {
  const NOTEBOOK =
    'สมุดบันทึก ขนาดเอ 5\nเนื้อใน 80 แผ่น(160หน้า)\nกระดาษถนอมสายตา(จริงใจ AA) 75 แกรม พิมพ์ 1 สี-น้ำเงิน\nปก อาร์ทการ์ดหน้าเดียว 350 แกรม พิมพ์ 4 สี\nปกนอกเคลือบลามิเนตด้าน\nเข้าเล่มแบบห่วงลวดกระดูกงู ไดคัทมุม 2 ด้านนอก';
  const READ =
    'สเปกที่อ่านได้: ขนาด A5 · ปก อาร์ทการ์ดหน้าเดียว 350 แกรม 4สี · เนื้อใน ถนอมสายตา(จริงใจ AA) 75 แกรม 1สี (น้ำเงิน) · เคลือบด้าน · กระดูกงู';
  const choices = { qtyUnit: 'เล่ม', graphic: 'pook', press: 'sm74', dateDue: '2026-11-24' };
  const withLines = (descs: string[], over: Partial<DraftRow> = {}): DraftRow => {
    const base = mkDraft();
    return mkDraft({
      snapshot: {
        ...base.snapshot,
        quotation: {
          ...base.snapshot.quotation,
          lines: descs.map((description, i) => ({ key: `k${i}`, description, quantity: 1000, price: 1 })),
        },
      },
      units: [mkUnit({ name: 'สมุดบันทึก ขนาดเอ 5', qty: '1000', choices })],
      step: 'confirm',
      ...over,
    });
  };
  const texts = (c: Card): string[] => { const out: string[] = []; walk(c.flex, (o) => { if (o.type === 'text') out.push(o.text as string); }); return out; };

  it('one line with a spec: the card shows what was read, after the orderer line (flex and text)', () => {
    const c = summaryCard(withLines([NOTEBOOK]));
    invariants(c);
    const flex = texts(c);
    expect(flex).toContain(READ);
    expect(flex.indexOf(READ)).toBeGreaterThan(flex.findIndex((t) => t.startsWith('ผู้สั่งงาน')));
    const rows = c.text.split('\n');
    expect(rows).toContain(READ);
    expect(rows.indexOf(READ)).toBeGreaterThan(rows.findIndex((t) => t.startsWith('ผู้สั่งงาน')));
  });

  it('the line is as readable as the other summary lines (it is the check before ✅)', () => {
    const objs: Obj[] = [];
    walk(summaryCard(withLines([NOTEBOOK])).flex, (o) => { if (o.type === 'text') objs.push(o); });
    const spec = objs.find((o) => o.text === READ)!;
    const orderer = objs.find((o) => (o.text as string).startsWith('ผู้สั่งงาน'))!;
    expect(spec.color).toBe(orderer.color);
    expect(spec.size).toBe(orderer.size);
  });

  it('nothing read: no such line at all', () => {
    const c = summaryCard(withLines(['ค่าจัดส่ง']));
    invariants(c);
    expect(c.text).not.toContain('สเปกที่อ่านได้');
    expect(JSON.stringify(c.flex)).not.toContain('สเปกที่อ่านได้');
  });

  it('merged unit (several lines in one order): no such line', () => {
    const d = withLines([NOTEBOOK, NOTEBOOK], { mode: 'merged' });
    d.units = [mkUnit({ lineKeys: ['k0', 'k1'], choices })];
    const c = summaryCard(d);
    invariants(c);
    expect(c.text).not.toContain('สเปกที่อ่านได้');
  });

  it('split: the spec of the current unit, not of another line', () => {
    const d = withLines(['ค่าจัดส่ง', NOTEBOOK], { mode: 'split', unitIdx: 1 });
    d.units = [mkUnit({ lineKeys: ['k0'], choices }), mkUnit({ lineKeys: ['k1'], choices })];
    expect(summaryCard(d).text).toContain(READ);
    d.unitIdx = 0;
    expect(summaryCard(d).text).not.toContain('สเปกที่อ่านได้');
  });

  it('damaged draft (no snapshot): the card still builds, without the line', () => {
    const d = withLines([NOTEBOOK]);
    (d as { snapshot?: unknown }).snapshot = undefined;
    const c = summaryCard(d);
    invariants(c);
    expect(c.text).not.toContain('สเปกที่อ่านได้');
  });
});

// ─── plate (spec 2026-11-28) ───────────────────────────────────────
describe('plateCard', () => {
  const at = (press: string | undefined, over: Partial<DraftRow> = {}) =>
    mkDraft({ units: [mkUnit({ choices: { graphic: 'pook', ...(press === undefined ? {} : { press }) } })], step: 'plate', ...over });
  const both = (c: Card, s: string) => {
    expect(c.text).toContain(s);
    expect(JSON.stringify(c.flex)).toContain(s);
  };

  it('an offset press: names the press and its size, asks new / old, can cancel', () => {
    const d = at('mo');
    const c = plateCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'plate', draft: d.id, u: 0, v: 'new' },
      { a: 'plate', draft: d.id, u: 0, v: 'old' },
      { a: 'x', draft: d.id },
    ]);
    expect(labels(c)).toEqual(['เพลทใหม่', 'เพลทเก่า', 'ยกเลิก']);
    both(c, 'ส่งต่อพิมพ์: MO (วล) · ตัด 4');
    both(c, 'เพลท:');
    expect(c.text).toContain('ตัวเลือก: เพลทใหม่ / เพลทเก่า / ยกเลิก');
  });

  it.each([
    ['sm74', 'ส่งต่อพิมพ์: SM74 (ต้อม) · ตัด 3'],
    ['mo5', 'ส่งต่อพิมพ์: MO 5สี (เกมส์) · ตัด 4'],
    ['hamada', 'ส่งต่อพิมพ์: Hamada (กุ้ง) · ตัด 5'],
  ])('%s shows its own size', (press, line) => {
    const c = plateCard(at(press));
    invariants(c);
    both(c, line);
    expect(labels(c)).toEqual(['เพลทใหม่', 'เพลทเก่า', 'ยกเลิก']);
  });

  it('แป๋: three kinds of print, no plate size', () => {
    const d = at('inkjet');
    const c = plateCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'plate', draft: d.id, u: 0, v: 'copyprint' },
      { a: 'plate', draft: d.id, u: 0, v: 'inkjet' },
      { a: 'plate', draft: d.id, u: 0, v: 'digital' },
      { a: 'x', draft: d.id },
    ]);
    expect(labels(c)).toEqual(['Copyprint', 'Inkjet', 'Print Digital', 'ยกเลิก']);
    both(c, 'ส่งต่อพิมพ์: Inkjet/Copyprint (แป๋)');
    both(c, 'ประเภทงานพิมพ์:');
    expect(c.text).not.toContain('ตัด ');
    expect(JSON.stringify(c.flex)).not.toContain('ตัด ');
    expect(c.text).toContain('ตัวเลือก: Copyprint / Inkjet / Print Digital / ยกเลิก');
  });

  it('the buttons are exactly what the rules table offers for the press', () => {
    for (const s of STAFF.print) {
      const d = at(s.id);
      const want = (plateQuestion(s.id)?.options ?? []).map((v) => ({ a: 'plate', draft: d.id, u: 0, v }));
      expect(decoded(plateCard(d)).map((x) => x.p)).toEqual([...want, { a: 'x', draft: d.id }]);
    }
  });

  it.each([[''], ['outsource'], ['nobody'], [undefined]])('press %j has nothing to ask (never shown in the flow): cancel only, never throws', (press) => {
    const d = at(press);
    const c = plateCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([{ a: 'x', draft: d.id }]);
  });

  it('split: the unit index is on every plate button', () => {
    const d = split(2);
    d.units[2].choices = { graphic: 'pook', press: 'hamada' };
    const c = plateCard(d);
    invariants(c);
    expect(decoded(c).map((x) => x.p)).toEqual([
      { a: 'plate', draft: d.id, u: 2, v: 'new' },
      { a: 'plate', draft: d.id, u: 2, v: 'old' },
      { a: 'x', draft: d.id },
    ]);
    expect(c.text).toContain('รายการที่ 3/3');
  });
});

describe('summaryCard — PLATE', () => {
  const DIGITAL_LINE = 'เมนูอาหาร ขนาด A3\nพิมพ์ดิจิตอล 4 สี 2 หน้า\nเคลือบด้าน';
  const withChoices = (choices: DraftUnit['choices'], description = 'ไวนิลขนาด 1x2 เมตร'): DraftRow => {
    const base = mkDraft();
    return mkDraft({
      snapshot: {
        ...base.snapshot,
        quotation: { ...base.snapshot.quotation, lines: [{ key: 'k0', description, quantity: 10, price: 1 }] },
      },
      units: [mkUnit({ choices: { graphic: 'pook', dateDue: '2026-11-20', ...choices } })],
      step: 'confirm',
    });
  };
  const rows = (c: Card): string[] => c.text.split('\n');
  const flexTexts = (c: Card): string[] => { const out: string[] = []; walk(c.flex, (o) => { if (o.type === 'text') out.push(o.text as string); }); return out; };
  const hasRow = (c: Card, row: string) => {
    expect(rows(c)).toContain(row);
    expect(flexTexts(c)).toContain(row);
  };
  const specRow = (c: Card) => rows(c).find((r) => r.startsWith('สเปกที่อ่านได้'));

  it.each([
    [{ press: 'mo', plate: 'new' }, 'ส่งต่อพิมพ์ MO (วล) · ตัด 4 · เพลทใหม่'],
    [{ press: 'sm74', plate: 'old' }, 'ส่งต่อพิมพ์ SM74 (ต้อม) · ตัด 3 · เพลทเก่า'],
    [{ press: 'hamada', plate: 'new' }, 'ส่งต่อพิมพ์ Hamada (กุ้ง) · ตัด 5 · เพลทใหม่'],
    [{ press: 'inkjet', plate: 'copyprint' }, 'ส่งต่อพิมพ์ Inkjet/Copyprint (แป๋) · Copyprint'],
    [{ press: 'inkjet', plate: 'inkjet' }, 'ส่งต่อพิมพ์ Inkjet/Copyprint (แป๋) · Inkjet'],
    [{ press: '' }, 'ส่งต่อพิมพ์ ยังไม่ระบุ · Print Digital'],
    // nothing decided: the press alone, as before
    [{ press: 'outsource' }, 'ส่งต่อพิมพ์ Outsource'],
    [{ press: 'sm74' }, 'ส่งต่อพิมพ์ SM74 (ต้อม)'], // a draft from before the plate step
    [{ press: 'sm74', plate: 'copyprint' }, 'ส่งต่อพิมพ์ SM74 (ต้อม)'], // an answer the press does not offer
    [{ press: 'outsource', plate: 'new' }, 'ส่งต่อพิมพ์ Outsource'],
  ] as Array<[DraftUnit['choices'], string]>)('%j → %s', (choices, row) => {
    const c = summaryCard(withChoices(choices));
    invariants(c);
    hasRow(c, row);
  });

  it('the line text reads Digital (precondition of the cases below)', () => {
    const spec = specFromText(DIGITAL_LINE);
    expect(spec.fields.digital).toBe(true);
    expect(spec.summary).toContain(' · Digital');
  });

  it.each([
    [{ press: 'mo', plate: 'old' }],
    [{ press: 'inkjet', plate: 'copyprint' }],
    [{ press: 'inkjet', plate: 'digital' }],
    [{ press: '' }],
  ] as Array<[DraftUnit['choices']]>)('LINE decided the print method (%j): the spec line does not repeat or contradict it', (choices) => {
    const c = summaryCard(withChoices(choices, DIGITAL_LINE));
    invariants(c);
    const want = 'สเปกที่อ่านได้: ' + withoutPrintMethod(specFromText(DIGITAL_LINE)).summary;
    expect(want).not.toContain('Digital');
    hasRow(c, want);
    expect(specRow(c)).toBe(want);
  });

  it.each([
    [{ press: 'outsource' }],
    [{ press: 'sm74' }],
    [{ press: 'sm74', plate: 'digital' }],
  ] as Array<[DraftUnit['choices']]>)('LINE decided nothing (%j): the spec line still says Digital — the order is created with it', (choices) => {
    const c = summaryCard(withChoices(choices, DIGITAL_LINE));
    const want = 'สเปกที่อ่านได้: ' + specFromText(DIGITAL_LINE).summary;
    hasRow(c, want);
  });

  it('a line that reads only the print method + an offset press: no spec line at all', () => {
    const c = summaryCard(withChoices({ press: 'mo', plate: 'new' }, 'ใบปลิว\nพิมพ์ดิจิทัล'));
    invariants(c);
    expect(specRow(c)).toBeUndefined();
    expect(flexTexts(c).some((t) => t.startsWith('สเปกที่อ่านได้'))).toBe(false);
  });
});
