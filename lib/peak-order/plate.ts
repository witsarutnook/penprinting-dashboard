/**
 * The press chosen in /order → the order form's "PLATE / การพิมพ์" fields.
 * Spec: docs/superpowers/specs/2026-11-28-peak-order-plate-design.md
 *
 * ONE table (RULES) says, per press, what is asked after it and what the answer writes. The
 * postback codec, the cards, the state machine and the order body all read it — nothing else
 * may know a plate size or which answers a press offers.
 *
 * Uncertain = blank: a press that asks a question and has no valid answer decides nothing
 * (plateFields → null), and so does Outsource. Nothing here throws; `plate` is untrusted.
 * Pure — no 'server-only' (imported by postback.ts, which the LINE channel adapter imports).
 */
import type { OrderFormData } from '@/lib/photobook';

export const PLATE_ANSWERS = ['new', 'old', 'copyprint', 'inkjet', 'digital'] as const;
export type PlateAnswer = (typeof PLATE_ANSWERS)[number];

export const PLATE_LABEL: Record<PlateAnswer, string> = {
  new: 'เพลทใหม่',
  old: 'เพลทเก่า',
  copyprint: 'Copyprint',
  inkjet: 'Inkjet',
  digital: 'Print Digital',
};

export type PlateFields = Pick<OrderFormData, 'plateOld' | 'plateNew' | 'copyprint' | 'inkjet' | 'digital' | 'plateSize'>;

export interface PlateQuestion {
  /** The plate size this press always uses; null when the press has none. */
  size: string | null;
  options: readonly PlateAnswer[];
}

/** The form flag each answer ticks. */
const FLAG: Record<PlateAnswer, Exclude<keyof PlateFields, 'plateSize'>> = {
  new: 'plateNew',
  old: 'plateOld',
  copyprint: 'copyprint',
  inkjet: 'inkjet',
  digital: 'digital',
};

const OFFSET: readonly PlateAnswer[] = ['new', 'old'];
const DIGITAL_PRESS: readonly PlateAnswer[] = ['copyprint', 'inkjet', 'digital'];

/**
 * One row per press id of STAFF.print (a test fails when the board gets a press this table
 * does not have). `null` = nothing is asked and LINE writes no PLATE field.
 * A Map, not an object: a press id is untrusted text ("__proto__", "constructor").
 */
const RULES: ReadonlyMap<string, PlateQuestion | null> = new Map<string, PlateQuestion | null>([
  ['sm74', { size: 'ตัด 3', options: OFFSET }], // ต้อม
  ['mo5', { size: 'ตัด 4', options: OFFSET }], // เกมส์
  ['mo', { size: 'ตัด 4', options: OFFSET }], // วล
  ['hamada', { size: 'ตัด 5', options: OFFSET }], // กุ้ง
  ['inkjet', { size: null, options: DIGITAL_PRESS }], // แป๋ — the Inkjet answer ticks Inkjet alone
  ['outsource', null],
]);

/** The press ids the table has a row for. */
export const PLATE_PRESS_IDS: readonly string[] = [...RULES.keys()];

const blank = (): PlateFields => ({ plateOld: false, plateNew: false, copyprint: false, inkjet: false, digital: false, plateSize: [] });

const isAnswer = (v: unknown): v is PlateAnswer => typeof v === 'string' && (PLATE_ANSWERS as readonly string[]).includes(v);

/** What to ask after this press; null = nothing to ask (no press, Outsource, not a press). */
export function plateQuestion(press: string): PlateQuestion | null {
  const q = typeof press === 'string' ? RULES.get(press) : undefined;
  return q ? { size: q.size, options: [...q.options] } : null;
}

/** The answer when it is one this press offers, else null. */
function answerFor(press: string, plate: unknown): { q: PlateQuestion; v: PlateAnswer } | null {
  const q = plateQuestion(press);
  if (!q || !isAnswer(plate) || !q.options.includes(plate)) return null;
  return { q, v: plate };
}

/**
 * All six PLATE fields as LINE decides them, or null when LINE decides nothing:
 *   no press ('')            → Print Digital (the owner's rule; nothing is asked)
 *   a press with a question  → its size + the flag of the answer; no valid answer → null
 *   Outsource / not a press  → null
 */
export function plateFields(press: string, plate: unknown): PlateFields | null {
  if (press === '') return { ...blank(), digital: true };
  const a = answerFor(press, plate);
  if (!a) return null;
  return { ...blank(), [FLAG[a.v]]: true, plateSize: a.q.size === null ? [] : [a.q.size] };
}

/** The same decision in words for the summary card: 'ตัด 4 · เพลทใหม่', 'Copyprint', 'Print Digital'; '' = nothing decided. */
export function plateSummary(press: string, plate: unknown): string {
  if (press === '') return PLATE_LABEL.digital;
  const a = answerFor(press, plate);
  if (!a) return '';
  return a.q.size === null ? PLATE_LABEL[a.v] : `${a.q.size} · ${PLATE_LABEL[a.v]}`;
}
