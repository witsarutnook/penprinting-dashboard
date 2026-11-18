/**
 * Keyword rules: a Peak quotation line -> the order form's spec fields.
 * Spec: docs/superpowers/specs/2026-11-18-peak-order-spec-from-text-design.md
 *
 * Pure and deterministic — no AI, no network, no database. Uncertain = blank:
 * a field with two different candidate values is left out, and wording never
 * seen in real quotations has no rule. The text is untrusted; nothing here throws.
 * No 'server-only': types only are imported from server modules.
 */
import type { OrderFormData } from '@/lib/photobook';
import type { PeakQuotation } from '@/lib/peak/read';

export type SpecFields = Partial<
  Pick<
    OrderFormData,
    | 'size' | 'sizeUnit'
    | 'paperCover' | 'paperInner'
    | 'coverColor' | 'innerColor' | 'coverColorNote' | 'innerColorNote'
    | 'coatGloss' | 'coatMatte' | 'coatUV' | 'coatSpotUV'
    | 'glue' | 'saddle' | 'spine' | 'perf' | 'digital'
  >
>;

export interface SpecFromText {
  /** Only the fields that were read. Booleans appear only as true. */
  fields: SpecFields;
  /** One line for the LINE summary card; '' when nothing was read. */
  summary: string;
}

export const EMPTY_SPEC: SpecFromText = Object.freeze({ fields: Object.freeze({}), summary: '' });

const MAX_INPUT = 4000;
const PAPER_MAX = 60;

/** `เนื้อใน`, or `ปก` that starts a word (not รองปก / รวมปก / หน้าปก / ปกอ่อน after text, not ปกติ). */
const MARKER = /เนื้อใน|(?<![\u0E00-\u0E7F])ปก(?!ติ)/g;
/** In a calendar, ภู่ / ไส้ start a part that stays in the notes only; ป้าย ends it. */
const MARKER_CALENDAR = new RegExp(`${MARKER.source}|ภู่|ไส้|ป้าย`, 'g');
const PAPER_WORD = /^(?:อาร์ต|อาร์ท|art|ปอนด์|การ์ด|ถนอมสายตา|น้ำตาล|คาร์บอน|กล่องแป้ง|ปรู๊ฟ|ปรุ๊ฟ)/i;
const PAPER_STOP = /กระดาษ|พิมพ์|ปริ้น|เคลือบ|ขนาด|จำนวน|เข้าเล่ม|ไดคัท/;
const WEIGHT = /\d{2,3}\s*(?:แกรม|กรัม|gsm|g)(?![a-z])/i;

const COLOUR_WORD = '(?:น้ำเงิน|น้ำตาล|ดำ|แดง|เขียว|ฟ้า|ชมพู|เหลือง|ส้ม|ม่วง|ทอง|เงิน)';
/** "4 สี" (not the 4 of A4 / เอ 4, not สี่, not "N สีเดียว"), "สีเดียว", "ขาวดำ". */
const COLOUR = /(?<![\dA-Za-z.])(?<!เอ\s{0,2})([1-4])\s*สี(?!่|เดียว)|สีเดียว|ขาว\s*-?\s*ดำ/g;
const NOTE_DASH = new RegExp(`^\\s*[-–]\\s*(${COLOUR_WORD})`);
const NOTE_PAREN = /^\s*\(([^)]{1,20})\)/;
const NOTE_SPACE = new RegExp(`^\\s+(${COLOUR_WORD})`);
const NOTE_LATER = new RegExp(`สี\\s*(${COLOUR_WORD})`);
const HAS_COLOUR_WORD = new RegExp(COLOUR_WORD);

const SIZE_TOKEN =
  /(?<![A-Za-z0-9])A([3-6])(?![0-9A-Za-z])|เอ\s?([3-6])(?!\d)|(?<![\d.])(\d+(?:\.\d+)?)\s*[x×*]\s*(?:สูง\s*)?(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(ซม\.?|นิ้ว|มม\.?|"|(?:cm|mm|inch(?:es)?)(?![a-z])\.?)?/gi;
const SIZE_ANCHOR = /ขนาด[^\d\n]{0,15}$/;
/** "ครึ่ง A4" = A5 (exact for A sizes). Any other halved / unfolded / fraction size is not read. */
const SIZE_HALF = /ครึ่ง\s*$/;
const SIZE_QUALIFIER = /(?:ครึ่ง|กางออก|1\/3|1\/2)\s*$/;
const WHOLE_BOOK = /^\s*ทั้งเล่ม/;

const COAT = /เคลือบ/g;
const COAT_TAIL = 20;

type Section = 'general' | 'cover' | 'inner';
/** 'sub' = the ภู่ / ไส้ part of a calendar: read into no field. */
type Where = Section | 'sub';

function sizeUnitOf(raw: string | undefined): string {
  const u = (raw ?? '').toLowerCase();
  if (u.startsWith('ซม') || u.startsWith('cm')) return 'ซม.';
  if (u.startsWith('นิ้ว') || u.startsWith('inch') || u === '"') return 'นิ้ว';
  if (u.startsWith('มม') || u.startsWith('mm')) return 'มม.';
  return '';
}

/** The one value of a set, or '' when it is empty or holds more than one. */
function only(values: Set<string>): string {
  return values.size === 1 ? [...values][0] : '';
}

function paperFrom(body: string): string | null {
  let b = body;
  const stop = b.search(PAPER_STOP);
  if (stop >= 0) b = b.slice(0, stop);
  const w = WEIGHT.exec(b);
  if (w) b = b.slice(0, w.index + w[0].length);
  b = b.replace(/\s+/g, ' ').replace(/^[\s:：\-–]+/, '').trim();
  if (b === '' || Array.from(b).length > PAPER_MAX) return null;
  return w || PAPER_WORD.test(b) ? b : null;
}

function colourNote(rest: string): string {
  const dash = NOTE_DASH.exec(rest);
  if (dash) return dash[1];
  const paren = NOTE_PAREN.exec(rest);
  if (paren) {
    const inner = paren[1].replace(/\s+/g, ' ').trim();
    return HAS_COLOUR_WORD.test(inner) ? inner : '';
  }
  const space = NOTE_SPACE.exec(rest);
  if (space) return space[1];
  const later = NOTE_LATER.exec(rest);
  if (later && !rest.slice(0, later.index).includes('กระดาษ')) return later[1];
  return '';
}

interface Bucket {
  paper: Set<string>;
  colour: Set<string>;
  note: Set<string>;
}
const bucket = (): Bucket => ({ paper: new Set(), colour: new Set(), note: new Set() });

/** `whole` collects a colour written as "N สี ทั้งเล่ม" outside any section: it is the cover's and the inner's. */
function readSegment(text: string, afterMarker: boolean, into: Bucket, whole: Set<string> | null): void {
  for (let i = text.indexOf('กระดาษ'); i >= 0; i = text.indexOf('กระดาษ', i + 6)) {
    const p = paperFrom(text.slice(i + 6));
    if (p) into.paper.add(p);
  }
  if (afterMarker) {
    const lead = text.trimStart();
    if (PAPER_WORD.test(lead)) {
      const p = paperFrom(lead);
      if (p) into.paper.add(p);
    }
  }
  for (const m of text.matchAll(COLOUR)) {
    const value = m[1] ? `${m[1]}สี` : '1สี';
    const rest = text.slice(m.index + m[0].length);
    into.colour.add(value);
    if (whole && WHOLE_BOOK.test(rest)) whole.add(value);
    if (!m[1] || m[1] === '1' || m[1] === '2') {
      const note = colourNote(rest);
      if (note) into.note.add(note);
    }
  }
}

function readSize(lines: string[], fields: SpecFields): void {
  const tokens: Array<{ value: string; unit: string; dim: boolean; anchored: boolean; qualified: boolean }> = [];
  for (const line of lines) {
    for (const m of line.matchAll(SIZE_TOKEN)) {
      const prefix = line.slice(0, m.index);
      const a = m[1] ?? m[2];
      const half = !!a && SIZE_HALF.test(prefix);
      tokens.push({
        value: a ? `A${half ? Number(a) + 1 : a}` : [m[3], m[4], m[5]].filter(Boolean).join('x'),
        unit: a ? '' : sizeUnitOf(m[6]),
        dim: !a,
        anchored: SIZE_ANCHOR.test(prefix),
        qualified: !half && SIZE_QUALIFIER.test(prefix),
      });
    }
  }
  const anchored = tokens.filter((t) => t.anchored);
  const pool = anchored.length > 0 ? anchored : tokens;
  if (pool.length === 0 || pool.some((t) => t.qualified)) return;
  if (new Set(pool.map((t) => `${t.value}|${t.unit}`)).size !== 1) return;
  const t = pool[0];
  if (!t.dim) {
    fields.size = t.value;
  } else if (t.unit !== '') {
    fields.size = t.value;
    fields.sizeUnit = t.unit;
  }
}

function readFlags(lines: string[], text: string, fields: SpecFields): void {
  for (const line of lines) {
    for (const m of line.matchAll(COAT)) {
      if (line.slice(0, m.index).endsWith('ไม่')) continue;
      const tail = line.slice(m.index + m[0].length, m.index + m[0].length + COAT_TAIL);
      if (tail.includes('หรือ')) continue;
      if (/^\s*(?:spot\s*uv|สปอต\s*ยูวี)/i.test(tail)) fields.coatSpotUV = true;
      else if (/^\s*(?:uv|ยูวี)/i.test(tail)) fields.coatUV = true;
      else if (/^\s*(?:ลามิเนต|pvc|opp)?\s*ด้าน/i.test(tail)) fields.coatMatte = true;
      else if (/^\s*(?:ลามิเนต|pvc|opp)?\s*เงา/i.test(tail)) fields.coatGloss = true;
    }
  }
  if (/spot\s*uv|สปอต\s*ยูวี/i.test(text)) fields.coatSpotUV = true;
  if (text.includes('ไสกาว')) fields.glue = true;
  if (text.includes('มุงหลังคา')) fields.saddle = true;
  if (/กระดูกงู|เข้าห่วง|ห่วงลวด/.test(text)) fields.spine = true;
  if (/ปรุ(?![\u0E00-\u0E7F])/.test(text)) fields.perf = true;
  if (/ดิจิตอล|ดิจิทัล|digital/i.test(text)) fields.digital = true;
}

function part(label: string, paper: string | undefined, colour: string | undefined, note: string | undefined): string {
  const body = [paper, colour].filter(Boolean).join(' ');
  if (body === '') return '';
  return `${label}${body}${colour && note ? ` (${note})` : ''}`;
}

function summarise(f: SpecFields, sectioned: boolean): string {
  const labelled = sectioned || !!f.paperCover || !!f.coverColor;
  const parts = [
    f.size ? `ขนาด ${f.size}${f.sizeUnit ? ` ${f.sizeUnit}` : ''}` : '',
    labelled ? part('ปก ', f.paperCover, f.coverColor, f.coverColorNote) : '',
    part(labelled ? 'เนื้อใน ' : '', f.paperInner, f.innerColor, f.innerColorNote),
    f.coatGloss ? 'เคลือบเงา' : '',
    f.coatMatte ? 'เคลือบด้าน' : '',
    f.coatUV ? 'เคลือบ UV' : '',
    f.coatSpotUV ? 'Spot UV' : '',
    f.glue ? 'ไสกาว' : '',
    f.saddle ? 'มุงหลังคา' : '',
    f.spine ? 'กระดูกงู' : '',
    f.perf ? 'ปรุ' : '',
    f.digital ? 'Digital' : '',
  ];
  return parts.filter((p) => p !== '').join(' · ');
}

function read(description: string): SpecFromText {
  const text = description.slice(0, MAX_INPUT).replace(/[\t\u00a0\u200b]/g, ' ');
  const lines = text.split(/\r\n|\r|\n/);

  const buckets: Record<Section, Bucket> = { general: bucket(), cover: bucket(), inner: bucket() };
  const whole = new Set<string>();
  const marker = text.includes('ปฏิทิน') ? MARKER_CALENDAR : MARKER;
  /** The lines without the ภู่ / ไส้ part — what size and the checkboxes are read from. */
  const main: string[] = [];
  let section: Where = 'general';
  let sectioned = false;
  for (const line of lines) {
    let from = 0;
    let afterMarker = false;
    let kept = '';
    const take = (end: number): void => {
      if (section === 'sub') return;
      const seg = line.slice(from, end);
      kept += seg;
      readSegment(seg, afterMarker, buckets[section], section === 'general' ? whole : null);
    };
    for (const m of line.matchAll(marker)) {
      let next: Where;
      if (m[0] === 'เนื้อใน') next = 'inner';
      else if (m[0] === 'ปก') next = 'cover';
      else if (m[0] !== 'ป้าย') next = 'sub';
      else if (section === 'sub') next = 'general';
      else continue; // ป้าย outside a ภู่ / ไส้ part is ordinary text
      take(m.index);
      section = next;
      kept += next === 'sub' ? ' ' : m[0];
      from = m.index + m[0].length;
      afterMarker = next === 'cover' || next === 'inner';
      if (afterMarker) sectioned = true;
    }
    take(line.length);
    main.push(kept);
  }

  const fields: SpecFields = {};
  readSize(main, fields);

  // No ปก / เนื้อใน anywhere = a single-sheet job: the team fills the inner fields.
  // With sections, paper / colour written before the first one is not used.
  const cover = buckets.cover;
  const inner = sectioned ? buckets.inner : buckets.general;
  const paperCover = only(cover.paper);
  const paperInner = only(inner.paper);
  const coverColor = only(new Set([...cover.colour, ...whole]));
  const innerColor = only(new Set([...inner.colour, ...whole]));
  if (paperCover) fields.paperCover = paperCover;
  if (paperInner) fields.paperInner = paperInner;
  if (coverColor) {
    fields.coverColor = coverColor;
    const note = only(cover.note);
    if (note) fields.coverColorNote = note;
  }
  if (innerColor) {
    fields.innerColor = innerColor;
    const note = only(inner.note);
    if (note) fields.innerColorNote = note;
  }

  readFlags(main, main.join('\n'), fields);
  return { fields, summary: summarise(fields, sectioned) };
}

/** Spec fields read from one quotation line. Any input; never throws. */
export function specFromText(description: unknown): SpecFromText {
  if (typeof description !== 'string' || description === '') return EMPTY_SPEC;
  try {
    return read(description);
  } catch {
    return EMPTY_SPEC;
  }
}

/**
 * Spec of a draft unit: read only when the unit is exactly one quotation line
 * (single / split). A merged unit, an unknown line key or a missing snapshot
 * gives the empty spec.
 */
export function specForUnit(
  q: PeakQuotation | null | undefined,
  lineKeys: readonly string[] | null | undefined,
): SpecFromText {
  if (!q || !Array.isArray(q.lines) || !Array.isArray(lineKeys) || lineKeys.length !== 1) return EMPTY_SPEC;
  const line = q.lines.find((l) => l?.key === lineKeys[0]);
  return line ? specFromText(line.description) : EMPTY_SPEC;
}
