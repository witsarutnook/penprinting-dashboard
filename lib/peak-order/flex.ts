/**
 * Flex cards (+ plain-text fallbacks) for every step of the LINE /order flow.
 * PURE module: no 'server-only'; server-only modules are imported with
 * `import type` only (erased at compile time). Runtime imports: postback,
 * mapper, order-constants, @/lib/board, @/lib/jobs — none is server-only.
 *
 * Everything that comes from Peak (codes, customer names, descriptions,
 * status) is untrusted text: it only ever appears as a Flex `text` component
 * (or altText / fallback text), after clip(). A Flex `text` component with an
 * empty string makes LINE reject the whole message, so every dynamic text goes
 * through txt()/clip with a fallback. No builder throws on hostile input: a
 * button whose postback cannot be encoded (e.g. a 400-char quotation code) is
 * simply left out and the card still renders.
 */
import type { DraftRow, DraftUnit } from '@/lib/peak-order/db';
import type { QuotationChoice } from '@/lib/peak-order/resolve';
import { encodePostback, type OrderPostback } from '@/lib/peak-order/postback';
import { NO_NAME, addDaysISO, bangkokISODate, firstLine } from '@/lib/peak-order/mapper';
import { ORDERERS, QTY_UNITS } from '@/lib/order-constants';
import { STAFF } from '@/lib/board';
import { displayDate } from '@/lib/jobs';

export interface Card {
  flex: Record<string, unknown>;
  text: string;
}

export const DASHBOARD_BASE = 'https://dashboard.penprinting.co';

/** LINE Messaging API reference: Flex Message > Button > label = 40 characters (ruling R1). */
export const FLEX_LABEL_MAX = 40;
const ALT_MAX = 400;
const TEXT_MAX = 4500; // LINE text message limit is 5000
const LINE_MAX = 160; // description lines in cards
const MAX_LISTED = 8;
const BRAND = '#c8553d';

type Obj = Record<string, unknown>;

// ─── text helpers ───────────────────────────────────────────────────

/** Collapse whitespace/control chars, cut to n code points (… on cut). Never throws. */
function clip(s: unknown, n: number): string {
  const one = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = Array.from(one);
  return cps.length <= n ? one : cps.slice(0, Math.max(0, n - 1)).join('').trimEnd() + '…';
}

/** clip with a non-empty fallback (Flex text must never be ''). */
function txt(s: unknown, n: number, fallback = '-'): string {
  return clip(s, n) || fallback;
}

/** Deterministic money format (no ICU dependency): 1,234 / 1,234.5 -> 1,234.50. */
export function formatAmount(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const r = Math.round(Math.abs(n) * 100) / 100;
  const [int, frac] = r.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 && r !== 0 ? '-' : ''}${grouped}${frac === '00' ? '' : '.' + frac} บ.`;
}

function pb(p: OrderPostback): string | null {
  try {
    return encodePostback(p);
  } catch {
    return null;
  }
}

// ─── Flex building blocks ───────────────────────────────────────────

const C = {
  title: '#1a202c',
  body: '#4a5568',
  muted: '#a0aec0',
  good: '#059669',
  warn: '#b45309',
};

function t(text: string, extra: Obj = {}): Obj {
  return { type: 'text', text: text === '' ? '-' : text, wrap: true, size: 'sm', color: C.body, ...extra };
}

type BtnKind = 'primary' | 'secondary' | 'link';

function action(label: string, a: Obj): Obj {
  return { ...a, label: clip(label, FLEX_LABEL_MAX) || '-' };
}

function button(label: string, a: Obj, kind: BtnKind = 'secondary'): Obj {
  return {
    type: 'button',
    style: kind,
    height: 'sm',
    ...(kind === 'primary' ? { color: BRAND } : {}),
    action: action(label, a),
  };
}

/** Postback button; null when the postback cannot be encoded. */
function pbButton(label: string, p: OrderPostback, kind: BtnKind = 'secondary'): Obj | null {
  const data = pb(p);
  return data === null ? null : button(label, { type: 'postback', data }, kind);
}

function uriButton(label: string, uri: string, kind: BtnKind = 'secondary'): Obj {
  return button(label, { type: 'uri', uri }, kind);
}

function compact<T>(xs: Array<T | null | undefined>): T[] {
  return xs.filter((x): x is T => x !== null && x !== undefined);
}

/** Rows of up to `per` buttons; the last row may be shorter (no filler/padding is added). */
function grid(buttons: Obj[], per: number): Obj[] {
  const rows: Obj[] = [];
  for (let i = 0; i < buttons.length; i += per) {
    const slice = buttons.slice(i, i + per);
    rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: slice });
  }
  return rows;
}

interface Parts {
  c: Obj[]; // flex body components
  t: string[]; // text-fallback lines
}

function newParts(): Parts {
  return { c: [], t: [] };
}

function add(p: Parts, text: string, extra: Obj = {}, asText = true): void {
  p.c.push(t(text, extra));
  if (asText) p.t.push(text);
}

function build(
  title: string,
  p: Parts,
  footer: Obj[],
  fallbackTail: string,
  altText?: string,
): Card {
  const body: Obj[] = [
    { type: 'text', text: title || '-', weight: 'bold', size: 'md', color: C.title, wrap: true },
    ...p.c.map((x, i) => (i === 0 ? { ...x, margin: 'md' } : x)),
  ];
  const bubble: Obj = {
    type: 'bubble',
    size: 'mega',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    ...(footer.length
      ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer } }
      : {}),
  };
  const text = clipUnits([title, ...p.t, fallbackTail].filter((s) => s !== '').join('\n'), TEXT_MAX);
  const alt = clipUnits(clip(altText ?? [title, ...p.t].join(' / '), ALT_MAX), ALT_MAX) || 'ใบสั่งงานจาก Peak';
  return { flex: { type: 'flex', altText: alt, contents: bubble }, text: text || title || '-' };
}

/** Hard cap by UTF-16 length (astral chars count 2), never splitting a pair. */
function clipUnits(s: string, n: number): string {
  if (s.length <= n) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > n - 1) break;
    out += ch;
  }
  return out + '…';
}

const TAIL = 'ถ้าปุ่มไม่แสดง ให้พิมพ์ /order ใหม่อีกครั้งนะคะ';

// ─── draft helpers ──────────────────────────────────────────────────

const EMPTY_UNIT: DraftUnit = { lineKeys: [], name: NO_NAME, qty: '', notes: '', choices: {} };

function curUnit(d: DraftRow): DraftUnit {
  return d.units?.[d.unitIdx] ?? EMPTY_UNIT;
}

function qtyText(u: DraftUnit, withUnit: boolean): string {
  if (!u.qty) return '';
  const unit = withUnit ? u.choices?.qtyUnit ?? '' : '';
  return clip(`${u.qty} ${unit}`, 40);
}

/** Common header of a per-unit card. money = also net amount + Peak status. */
function draftHeader(d: DraftRow, p: Parts, money: boolean): void {
  const q = d.snapshot?.quotation;
  const customer = txt(d.snapshot?.customerName, 80);
  if (d.mode === 'split') {
    add(p, `รายการที่ ${d.unitIdx + 1}/${d.units.length}`, { weight: 'bold', color: BRAND });
  }
  add(p, txt(q?.code, 40), { size: 'xs', color: C.muted });
  const u = curUnit(d);
  add(p, txt(u.name, LINE_MAX, NO_NAME), { size: 'md', weight: 'bold', color: C.title });
  const qty = qtyText(u, true);
  if (qty) add(p, `จำนวน ${qty}`);
  add(p, `ลูกค้า ${customer}`);
  if (money) {
    const amount = formatAmount(q?.netAmount);
    if (amount) add(p, `ยอดสุทธิ ${amount}`);
    const status = clip(q?.status, 30);
    if (status) add(p, `สถานะใน Peak: ${status}`, { size: 'xs', color: C.muted });
  }
}

const cancelBtn = (d: DraftRow): Obj | null => pbButton('ยกเลิก', { a: 'x', draft: d.id }, 'link');

// ─── cards ──────────────────────────────────────────────────────────

export function whoCard(args: string): Card {
  const p = newParts();
  add(p, 'ขอทราบก่อนว่าใครเป็นผู้สั่งงาน (จำไว้ให้ ครั้งต่อไปไม่ถามอีก)');
  const names = ORDERERS.map((n, i) => ({ n, i }));
  const btns = compact(names.map(({ n, i }) => pbButton(n, { a: 'who', orderer: i, args }, 'primary')));
  const no = pbButton('ไม่ใช่ฉัน', { a: 'who', orderer: -1, args }, 'link');
  p.t.push(`ตัวเลือก: ${ORDERERS.join(' / ')} / ไม่ใช่ฉัน`);
  return build('คุณคือใคร?', p, [...grid(btns, 3), ...(no ? [no] : [])], TAIL);
}

export function choicesCard(heading: string, choices: QuotationChoice[], note?: string): Card {
  const p = newParts();
  const n = clip(note, LINE_MAX);
  if (n) add(p, n, { color: C.warn });
  const list = Array.isArray(choices) ? choices : [];
  const shown = list.slice(0, MAX_LISTED);
  const btns: Obj[] = [];
  shown.forEach((c, i) => {
    const code = txt(c.code, 40);
    const head = `${i + 1}) ${code} · ${txt(displayDate(c.issuedDate), 20)}`;
    const amount = formatAmount(c.netAmount);
    const sub = [txt(c.customerName, 50), amount].filter(Boolean).join(' · ');
    const first = txt(c.firstLine, LINE_MAX, NO_NAME);
    p.c.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'xs',
      contents: [
        t(head, { weight: 'bold', color: C.title }),
        t(sub),
        t(first),
        ...(c.opened ? [t('✅ เปิดงานแล้ว', { size: 'xs', color: C.good, weight: 'bold' })] : []),
      ],
    });
    p.t.push(`${head}\n   ${sub}\n   ${first}${c.opened ? '\n   ✅ เปิดงานแล้ว' : ''}`);
    const b = pbButton(`ใบที่ ${i + 1}`, { a: 'pick', code: c.code }, 'primary');
    if (b) btns.push(b);
  });
  if (list.length > shown.length) add(p, `…อีก ${list.length - shown.length} รายการ`, { color: C.muted });
  if (list.length === 0) add(p, 'ไม่มีรายการให้เลือก');
  return build(`🔎 ${txt(heading, LINE_MAX)}`, p, grid(btns, 3), TAIL);
}

export function statusCard(p0: {
  qoCode: string;
  customerName: string;
  opened: Array<{ orderId: number; name: string; isDraft: boolean }>;
  remaining: Array<{ name: string }>;
}): Card {
  const p = newParts();
  add(p, `ลูกค้า ${txt(p0.customerName, 80)}`);
  const opened = p0.opened ?? [];
  const remaining = p0.remaining ?? [];
  const footer: Obj[] = [];
  if (opened.length) add(p, 'เปิดงานไปแล้ว:', { weight: 'bold', color: C.title, margin: 'md' });
  opened.slice(0, MAX_LISTED).forEach((o) => {
    const ok = Number.isSafeInteger(o.orderId) && o.orderId > 0;
    const line = `${o.isDraft ? '📝 ใบร่าง (ยังไม่ส่งงาน)' : '✅ งาน'}${ok ? ` #${o.orderId}` : ''} · ${txt(o.name, LINE_MAX, NO_NAME)}`;
    add(p, line);
    if (ok) {
      footer.push(
        uriButton(
          o.isDraft ? `เปิดใบร่างในแดชบอร์ด #${o.orderId}` : `เปิดใบสั่งงาน #${o.orderId}`,
          `${DASHBOARD_BASE}/orders/${o.orderId}/edit`,
        ),
      );
    }
  });
  if (opened.length > MAX_LISTED) add(p, `…อีก ${opened.length - MAX_LISTED} รายการ`, { color: C.muted });
  if (remaining.length) {
    add(p, `ยังไม่ได้เปิดงาน ${remaining.length} บรรทัด:`, { weight: 'bold', color: C.title, margin: 'md' });
    remaining.slice(0, MAX_LISTED).forEach((r, i) => add(p, `${i + 1}. ${txt(r.name, LINE_MAX, NO_NAME)}`));
    if (remaining.length > MAX_LISTED) {
      add(p, `…อีก ${remaining.length - MAX_LISTED} รายการ`, { color: C.muted });
    }
    const rest = pbButton('เปิดรายการที่เหลือ', { a: 'rest', code: p0.qoCode }, 'primary');
    if (rest) footer.unshift(rest);
  }
  // The title says what is true: something opened / nothing opened yet / only
  // an in-flight claim of someone else (nothing opened, nothing free).
  let state: string;
  if (opened.length) state = 'เปิดงานแล้ว';
  else if (remaining.length) state = 'ยังไม่ได้เปิดงาน';
  else {
    state = 'มีคนกำลังเปิดงานใบนี้อยู่';
    add(p, 'ลองใหม่อีกครั้งในอีกสักครู่', { color: C.muted, margin: 'md' });
  }
  return build(`${txt(p0.qoCode, 40)} · ${state}`, p, footer, remaining.length ? TAIL : '');
}

export function modeCard(d: DraftRow): Card {
  const p = newParts();
  const q = d.snapshot?.quotation;
  add(p, `ลูกค้า ${txt(d.snapshot?.customerName, 80)}`);
  const amount = formatAmount(q?.netAmount);
  if (amount) add(p, `ยอดสุทธิ ${amount}`);
  const status = clip(q?.status, 30);
  if (status) add(p, `สถานะใน Peak: ${status}`, { size: 'xs', color: C.muted });
  const lines = q?.lines ?? [];
  add(p, `มี ${lines.length} รายการ:`, { weight: 'bold', color: C.title, margin: 'md' });
  lines.slice(0, MAX_LISTED).forEach((l, i) => add(p, `${i + 1}. ${txt(firstLine(l.description), LINE_MAX, NO_NAME)}`));
  if (lines.length > MAX_LISTED) add(p, `…อีก ${lines.length - MAX_LISTED} รายการ`, { color: C.muted });
  add(p, 'จะเปิดเป็นงานเดียว หรือแยกเป็นหลายงาน?', { margin: 'md', color: C.title });
  const footer = compact([
    pbButton('รวมเป็น 1 งาน', { a: 'mode', draft: d.id, v: 'merged' }, 'primary'),
    pbButton(`แยกเป็น ${lines.length} งาน`, { a: 'mode', draft: d.id, v: 'split' }, 'secondary'),
    cancelBtn(d),
  ]);
  return build(`📄 ร่างใบสั่งงาน · ${txt(q?.code, 40)}`, p, footer, TAIL);
}

export function unitCard(d: DraftRow): Card {
  const p = newParts();
  draftHeader(d, p, true);
  add(p, 'หน่วยของจำนวน:', { margin: 'md', weight: 'bold', color: C.title, });
  p.t.push(`ตัวเลือก: ${QTY_UNITS.join(' / ')}${d.mode === 'split' ? ' / ข้ามรายการนี้' : ''} / ยกเลิก`);
  const unitBtns = compact(QTY_UNITS.map((n, i) => pbButton(n, { a: 'unit', draft: d.id, u: d.unitIdx, v: i })));
  const footer: Obj[] = [...grid(unitBtns, 3)];
  if (d.mode === 'split') {
    const skip = pbButton('ข้ามรายการนี้', { a: 'unit', draft: d.id, u: d.unitIdx, v: 'skip' }, 'link');
    if (skip) footer.push(skip);
  }
  const cancel = cancelBtn(d);
  if (cancel) footer.push(cancel);
  return build('📄 ร่างใบสั่งงาน', p, footer, TAIL);
}

export function graphicCard(d: DraftRow, canCopyPrevious: boolean): Card {
  const p = newParts();
  draftHeader(d, p, d.mode === 'merged');
  add(p, 'มอบหมายกราฟฟิก:', { margin: 'md', weight: 'bold', color: C.title });
  const names = STAFF.graphic.map((s) => s.name);
  p.t.push(`ตัวเลือก: ${names.join(' / ')} / ไม่ผ่านกราฟฟิก${canCopyPrevious ? ' / เหมือนใบก่อน' : ''}`);
  const u = d.unitIdx;
  const staff = compact(STAFF.graphic.map((s) => pbButton(s.name, { a: 'gfx', draft: d.id, u, v: s.id }, 'primary')));
  const footer: Obj[] = [...grid(staff, 3)];
  const none = pbButton('ไม่ผ่านกราฟฟิก', { a: 'gfx', draft: d.id, u, v: 'none' });
  if (none) footer.push(none);
  if (canCopyPrevious) {
    const same = pbButton('เหมือนใบก่อน', { a: 'gfx', draft: d.id, u, v: 'same' }, 'link');
    if (same) footer.push(same);
  }
  return build('มอบหมายกราฟฟิก', p, footer, TAIL);
}

export function pressCard(d: DraftRow): Card {
  const p = newParts();
  draftHeader(d, p, false);
  const gfxId = curUnit(d).choices?.graphic;
  const gfx = gfxId ? STAFF.graphic.find((s) => s.id === gfxId)?.name : undefined;
  add(p, `กราฟฟิก: ${gfx ?? (gfxId === '' ? 'ไม่ผ่านกราฟฟิก' : '-')}`);
  add(p, 'ส่งต่อพิมพ์:', { margin: 'md', weight: 'bold', color: C.title });
  const allowNone = gfxId !== '';
  const names = STAFF.print.map((s) => s.name);
  p.t.push(`ตัวเลือก: ${names.join(' / ')}${allowNone ? ' / ยังไม่ระบุ' : ''}`);
  const u = d.unitIdx;
  const staff = compact(STAFF.print.map((s) => pbButton(s.name, { a: 'press', draft: d.id, u, v: s.id }, 'primary')));
  const footer: Obj[] = [...grid(staff, 2)];
  if (allowNone) {
    const none = pbButton('ยังไม่ระบุ', { a: 'press', draft: d.id, u, v: 'none' }, 'link');
    if (none) footer.push(none);
  }
  return build('ส่งต่อพิมพ์', p, footer, TAIL);
}

const DATE_BUTTONS: Array<{ label: string; v: string; days: number }> = [
  { label: 'พรุ่งนี้', v: '+1', days: 1 },
  { label: '+2 วัน', v: '+2', days: 2 },
  { label: '+3 วัน', v: '+3', days: 3 },
  { label: '+5 วัน', v: '+5', days: 5 },
  { label: '+7 วัน', v: '+7', days: 7 },
];

export function dateCard(d: DraftRow, todayISO: string): Card {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(todayISO)) ? todayISO : bangkokISODate(new Date());
  let tomorrow: string;
  try {
    tomorrow = addDaysISO(today, 1);
  } catch {
    tomorrow = addDaysISO(bangkokISODate(new Date()), 1);
  }
  const p = newParts();
  draftHeader(d, p, false);
  add(p, 'วันกำหนดส่ง:', { margin: 'md', weight: 'bold', color: C.title });
  add(p, `วันนี้ ${displayDate(today)}`, { size: 'xs', color: C.muted });
  p.t.push(`ตัวเลือก: ${DATE_BUTTONS.map((b) => b.label).join(' / ')} / เลือกวันเอง`);
  const u = d.unitIdx;
  const quick = compact(DATE_BUTTONS.map((b) => pbButton(b.label, { a: 'date', draft: d.id, u, v: b.v })));
  const pickData = pb({ a: 'date', draft: d.id, u, v: 'pick' });
  const footer: Obj[] = [...grid(quick, 3)];
  if (pickData !== null) {
    footer.push(
      button('📅 เลือกวันเอง', { type: 'datetimepicker', data: pickData, mode: 'date', initial: tomorrow, min: today }, 'primary'),
    );
  }
  return build('วันกำหนดส่ง', p, footer, TAIL);
}

export function summaryCard(d: DraftRow): Card {
  const p = newParts();
  const u = curUnit(d);
  const c = u.choices ?? {};
  const q = d.snapshot?.quotation;
  if (d.mode === 'split') {
    add(p, `รายการที่ ${d.unitIdx + 1}/${d.units.length}`, { weight: 'bold', color: BRAND });
  }
  add(p, txt(u.name, LINE_MAX, NO_NAME), { size: 'md', weight: 'bold', color: C.title });
  const qty = qtyText(u, true);
  if (qty) add(p, `จำนวน ${qty}`);
  add(p, `ลูกค้า ${txt(d.snapshot?.customerName, 80)}`);
  const gfx = c.graphic ? STAFF.graphic.find((s) => s.id === c.graphic)?.name ?? c.graphic : 'ไม่ผ่านกราฟฟิก';
  const press = c.press ? STAFF.print.find((s) => s.id === c.press)?.name ?? c.press : 'ยังไม่ระบุ';
  add(p, `กราฟฟิก ${txt(gfx, 60)}`);
  add(p, `ส่งต่อพิมพ์ ${txt(press, 60)}`);
  add(p, `ส่ง ${displayDate(c.dateDue)}`);
  add(p, `ผู้สั่งงาน ${txt(d.orderer, 40)}`);
  add(p, txt(q?.code, 40), { size: 'xs', color: C.muted });
  p.t.push('ตัวเลือก: สร้างงาน / บันทึกเป็นใบร่างในแดชบอร์ด / ยกเลิก');
  p.c.push(
    t('✅ สร้างงาน = ขึ้นบอร์ดทันที · 📝 ใบร่าง = ไปเติมสเปกในแดชบอร์ดก่อนส่งงาน', {
      size: 'xs',
      color: C.muted,
      margin: 'md',
    }),
  );
  const footer = compact([
    pbButton('✅ สร้างงาน', { a: 'ok', draft: d.id, u: d.unitIdx, v: 'create' }, 'primary'),
    pbButton('📝 บันทึกเป็นใบร่างในแดชบอร์ด', { a: 'ok', draft: d.id, u: d.unitIdx, v: 'draft' }),
    cancelBtn(d),
  ]);
  return build('สรุปใบสั่งงาน', p, footer, TAIL);
}

export function dupCard(d: DraftRow, duplicates: Array<{ id: number; name: string }>): Card {
  const p = newParts();
  const u = curUnit(d);
  add(p, `มีใบสั่งงานที่ยังทำอยู่ ชื่องานและลูกค้าตรงกับ "${txt(u.name, 80, NO_NAME)}" (${txt(d.snapshot?.customerName, 60)}):`);
  const dups = duplicates ?? [];
  dups.slice(0, MAX_LISTED).forEach((x) => add(p, `#${Number.isFinite(x.id) ? x.id : '-'} · ${txt(x.name, LINE_MAX, NO_NAME)}`));
  if (dups.length > MAX_LISTED) add(p, `…อีก ${dups.length - MAX_LISTED} รายการ`, { color: C.muted });
  add(p, 'สร้างต่อหรือไม่?', { margin: 'md', weight: 'bold', color: C.title });
  p.t.push('ตัวเลือก: สร้างต่อ / ยกเลิก');
  const footer = compact([
    pbButton('สร้างต่อ', { a: 'dup', draft: d.id, u: d.unitIdx, v: 'force' }, 'primary'),
    cancelBtn(d),
  ]);
  return build('⚠️ อาจซ้ำกับงานที่มีอยู่', p, footer, TAIL);
}

export function createdCard(p0: { orderId: number; name: string; pin: string; isDraft: boolean }): Card {
  const p = newParts();
  const ok = Number.isSafeInteger(p0.orderId) && p0.orderId > 0;
  add(p, txt(p0.name, LINE_MAX, NO_NAME), { size: 'md', weight: 'bold', color: C.title });
  const pin = clip(p0.pin, 20);
  if (pin) add(p, `PIN ${pin}`);
  if (p0.isDraft) add(p, 'ยังไม่ขึ้นบอร์ด — ไปเติมสเปกแล้วกดส่งงานในแดชบอร์ดได้เลย', { size: 'xs', color: C.muted });
  const footer: Obj[] = [];
  if (ok) {
    footer.push(
      uriButton(p0.isDraft ? 'เปิดใบร่างในแดชบอร์ด' : 'เปิดใบสั่งงาน', `${DASHBOARD_BASE}/orders/${p0.orderId}/edit`, 'primary'),
    );
    if (!p0.isDraft) footer.push(uriButton('พิมพ์ใบสั่งงาน', `${DASHBOARD_BASE}/orders/${p0.orderId}/print`));
    p.t.push(`เปิดใบสั่งงาน: ${DASHBOARD_BASE}/orders/${p0.orderId}/edit`);
    if (!p0.isDraft) p.t.push(`พิมพ์ใบสั่งงาน: ${DASHBOARD_BASE}/orders/${p0.orderId}/print`);
  }
  const title = p0.isDraft ? `📝 บันทึกเป็นใบร่างแล้ว${ok ? ` #${p0.orderId}` : ''}` : `✅ เปิดงานแล้ว${ok ? ` #${p0.orderId}` : ''}`;
  return build(title, p, footer, '');
}

export const TEXT = {
  noUser: 'ขออภัยค่ะ ระบุตัวผู้ใช้ไม่ได้ จึงเปิดร่างใบสั่งงานให้ไม่ได้',
  expired: 'ร่างนี้หมดอายุแล้วค่ะ พิมพ์ /order ใหม่อีกครั้งนะคะ',
  notOwner: (orderer: string): string =>
    `ร่างนี้เป็นของคุณ${txt(orderer, 40)} ค่ะ ให้คุณ${txt(orderer, 40)} กดแทน หรือพิมพ์ /order เพื่อเปิดร่างของตัวเองนะคะ`,
  cancelled: 'ยกเลิกร่างแล้วค่ะ ไม่มีอะไรเกิดขึ้นในแดชบอร์ด',
  peakNotConnected:
    'ยังเชื่อมต่อ Peak ไม่ได้ค่ะ (ยังไม่เคยเชื่อมต่อ หรือต่ออายุสิทธิ์ไม่ได้) ให้แอดมินกด "เชื่อมต่อ Peak" ที่หน้าแอดมินของแดชบอร์ดก่อนนะคะ',
  peakUnavailable: 'Peak ไม่ตอบในตอนนี้ค่ะ ลองใหม่อีกครั้งในอีกสักครู่นะคะ',
  createFailed: 'สร้างงานไม่สำเร็จค่ะ ร่างยังอยู่ กดยืนยันอีกครั้งได้เลยค่ะ',
  voided: 'ใบเสนอราคานี้ถูกยกเลิกใน Peak (Voided) จึงเปิดงานไม่ได้ค่ะ',
  noLines: 'ใบเสนอราคานี้ไม่มีรายการสินค้า จึงเปิดงานไม่ได้ค่ะ',
  badDate: 'วันที่ที่เลือกใช้ไม่ได้ค่ะ (ต้องเป็นวันนี้หรือหลังจากนี้) เลือกวันกำหนดส่งใหม่อีกครั้งนะคะ',
  whoDeclined: 'รับทราบค่ะ ยังไม่ได้ทำอะไรต่อ ถ้าจะใช้ /order ให้เลือกชื่อของตัวเองนะคะ',
  adopted:
    'ใบสั่งงานนี้ถูกสร้างไว้แล้วจากการกดครั้งก่อนค่ะ รบกวนเปิดดูในแดชบอร์ด และเช็คว่างานขึ้นบอร์ดแล้วนะคะ',
  unexpected: 'ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่นะคะ ถ้ายังเป็นอยู่ แจ้งแอดมินด้วยนะคะ',
};
