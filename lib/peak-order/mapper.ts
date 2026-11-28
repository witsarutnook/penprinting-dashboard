/**
 * Pure mapping: Peak quotation -> unit plans -> order-form body.
 * No 'server-only': types only are imported from server modules.
 * All quotation text is untrusted: treated as text, never interpreted.
 */
import type { PeakQuotation } from '@/lib/peak/read';
import type { CreateOrderBody } from '@/lib/orders-create';
import type { SpecFields } from '@/lib/peak-order/spec-from-text';
import { emptyOrderForm } from '@/lib/photobook';
import { plateFields } from '@/lib/peak-order/plate';

export const NO_NAME = '(ไม่มีชื่อรายการ)';
const NAME_MAX = 120;

function clip(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join('').trimEnd();
}

/** Calendar day in Asia/Bangkok (UTC+7, no DST) as 'yyyy-mm-dd'; independent of process TZ. */
export function bangkokISODate(d: Date): string {
  const t = new Date(d.getTime() + 7 * 3600 * 1000);
  return isoFromUTC(t);
}

function isoFromUTC(t: Date): string {
  const y = String(t.getUTCFullYear()).padStart(4, '0');
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const day = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pure calendar arithmetic on a 'yyyy-mm-dd' string. */
export function addDaysISO(iso: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError('Invalid ISO date');
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return isoFromUTC(t);
}

/** A line without its leading bullets / whitespace. */
const bare = (line: string): string => line.replace(/^[-•*\s]+/, '').trim();

/** First non-empty line, leading bullets/whitespace stripped, <= 120 chars; '' -> NO_NAME. */
export function firstLine(description: string): string {
  for (const raw of String(description ?? '').split(/\r\n|\r|\n/)) {
    const line = bare(raw);
    if (line !== '') return clip(line, NAME_MAX);
  }
  return NO_NAME;
}

/**
 * The line text for an order's notes (spec §13.7): without the first line when it is the order's
 * `name` as written (the name field holds it). No other line ever leaves.
 * Kept lines are untouched; blank lines left behind do not pile up. Nothing dropped = the text as it is.
 */
export function notesBody(description: string, name: string): string {
  const text = String(description ?? '');
  const lines = text.split(/\r\n|\r|\n/);
  const first = lines.findIndex((l) => bare(l) !== '');
  if (first < 0 || bare(lines[first]) !== name) return text;
  const kept: string[] = [];
  lines.forEach((line, n) => {
    if (n === first) return;
    const blank = line.trim() === '';
    if (blank && (kept.length === 0 || kept[kept.length - 1].trim() === '')) return;
    kept.push(line);
  });
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join('\n');
}

/** Clean decimal string (no float noise); '' for 0 / null / NaN / non-positive. */
export function formatQty(q: number | null): string {
  if (q === null || typeof q !== 'number' || !Number.isFinite(q) || q <= 0) return '';
  const n = Number(q.toPrecision(12));
  let s = String(n);
  if (/e/i.test(s)) s = n.toFixed(6).replace(/\.?0+$/, '');
  return s === '0' || s === '' ? '' : s;
}

export interface UnitPlan {
  lineKeys: string[];
  name: string;
  qty: string;
  notes: string;
}

const refLine = (code: string) => `อ้างอิง Peak: ${code}`;

function withRef(body: string, code: string): string {
  return body.trim() === '' ? refLine(code) : `${body}\n\n${refLine(code)}`;
}

/**
 * single: the quotation must have exactly one line (else throws a plain Error).
 * split: one unit per line (only `onlyKeys` when given). merged: one unit for all lines.
 * Zero lines yields [] for split/merged (callers refuse zero-line quotations).
 */
export function planUnits(q: PeakQuotation, mode: 'single' | 'merged' | 'split', onlyKeys?: string[]): UnitPlan[] {
  const oneLine = (l: PeakQuotation['lines'][number]): UnitPlan => ({
    lineKeys: [l.key],
    name: firstLine(l.description),
    qty: formatQty(l.quantity),
    notes: withRef(l.description, q.code),
  });
  if (mode === 'single') {
    if (q.lines.length !== 1) throw new Error('planUnits single requires exactly one line');
    return [oneLine(q.lines[0])];
  }
  if (mode === 'split') {
    const keys = onlyKeys ? new Set(onlyKeys) : null;
    return q.lines.filter((l) => !keys || keys.has(l.key)).map(oneLine);
  }
  if (q.lines.length === 0) return [];
  const extra = q.lines.length - 1;
  const suffix = extra > 0 ? ` (+${extra} รายการ)` : '';
  const base = firstLine(q.lines[0].description);
  const blocks = q.lines.map((l, i) => `รายการ ${i + 1} (จำนวน ${formatQty(l.quantity) || '-'}): ${l.description}`);
  return [
    {
      lineKeys: q.lines.map((l) => l.key),
      name: clip(base, NAME_MAX - Array.from(suffix).length) + suffix,
      qty: '',
      notes: withRef(blocks.join('\n\n'), q.code),
    },
  ];
}

/**
 * The notes an order is created with (spec §13.7). A unit that is exactly one quotation line:
 * the line text without its first line when that line is the order's name (notesBody), plus the
 * Peak reference. A merged unit, a missing snapshot or a line that is gone: the notes as planned
 * (the full text).
 *
 * Every other line stays, also when all it says is in a form field. Dropping those lines was
 * live for one day (2026-11-18 → 19) and was taken out by the owner's decision; its code was
 * deleted on 2026-11-21 (spec §13.7 has the reasons and what a new attempt must pass first):
 * what a line means depends on the lines around it — a heading, a second item, "not included" —
 * and the keyword rules cannot see that. The notes are where a wrongly filled field can be checked.
 */
export function unitNotes(q: PeakQuotation | null | undefined, unit: UnitPlan, code: string): string {
  if (!q || !Array.isArray(q.lines) || unit.lineKeys.length !== 1) return unit.notes;
  const line = q.lines.find((l) => l?.key === unit.lineKeys[0]);
  if (!line || typeof line.description !== 'string') return unit.notes;
  return withRef(notesBody(line.description, unit.name), code);
}

export interface UnitChoices {
  qtyUnit?: string;
  graphic: string;
  press: string;
  /** The answer of the plate step (a PlateAnswer) — only for a press that asks one. Not a form field. */
  plate?: string;
  dateDue: string;
}

/**
 * Order body for createOrderFromForm. Never sets `price`. `peak` is read by findOrderByPeakMarker (raw_data->'peak').
 * `spec` = form fields read from the line text (spec-from-text.ts). It is spread first, so everything
 * that comes from Peak or was chosen in LINE always wins over it.
 * The PLATE fields come from the press and the plate answer (plate.ts) and are spread right after
 * `spec`: where LINE decides them, all six are set (a "digital" read from the text does not survive an
 * offset press); where it decides nothing (Outsource, a question left unanswered) they are as before.
 * `notes` = the notes to create the order with (unitNotes); without it, the unit's planned notes.
 */
export function buildOrderBody(p: {
  unit: UnitPlan;
  choices: UnitChoices;
  customerName: string;
  orderer: string;
  qoCode: string;
  draftId: string;
  todayISO: string;
  asDraft: boolean;
  force?: boolean;
  spec?: SpecFields;
  notes?: string;
}): CreateOrderBody {
  const body: CreateOrderBody = {
    ...emptyOrderForm(p.orderer),
    ...p.spec,
    ...(plateFields(p.choices.press, p.choices.plate) ?? {}),
    name: p.unit.name,
    customer: p.customerName,
    dateIn: p.todayISO,
    dateDue: p.choices.dateDue,
    qty: p.unit.qty,
    notes: p.notes ?? p.unit.notes,
    assignStaff: p.choices.graphic,
    forwardPrint: p.choices.press,
    orderer: p.orderer,
    orderType: 'normal',
    peak: { code: p.qoCode, lineKeys: p.unit.lineKeys, draftId: p.draftId },
  };
  if (p.choices.qtyUnit) body.qtyUnit = p.choices.qtyUnit;
  if (p.asDraft) body.status = 'draft';
  if (p.force) body.force = true;
  return body;
}
