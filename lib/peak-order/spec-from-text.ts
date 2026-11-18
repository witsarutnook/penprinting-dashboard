/**
 * Keyword rules: a Peak quotation line -> the order form's spec fields.
 * Spec: docs/superpowers/specs/2026-11-18-peak-order-spec-from-text-design.md
 *
 * Pure and deterministic — no AI, no network, no database. Uncertain = blank:
 * a field with two different candidate values is left out; an alternative ("หรือ",
 * "เงา/ด้าน"), a negation ("ไม่…") or a condition ("หาก…") next to a trigger word
 * fills nothing; wording never seen in real quotations has no rule.
 * The text is untrusted; nothing here throws.
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

const THAI = /[\u0E00-\u0E7F]/;
const isThai = (ch: string | undefined): boolean => ch !== undefined && THAI.test(ch);

// ─── sections ───────────────────────────────────────────────────────

/**
 * `เนื้อใน` (also the typo `เนิ้อใน`, seen in a real quotation), or `ปก` that starts a
 * word. Not รองปก / รวมปก / หน้าปก (glued to Thai text) and not ปกติ.
 */
const MARKER = /เนื้อใน|เนิ้อใน|(?<![\u0E00-\u0E7F])ปก(?!ติ)/g;
/** ปกอ่อน / ปกแข็ง head a cover line ("ปกแข็ง พิมพ์ 4 สี"); inside a line they are a binding type. */
const COVER_TYPE = /^(?:อ่อน|แข็ง)/;
const LINE_LEAD = /^[\s\-•*]*$/;
/** In a calendar, ภู่ / ไส้ start a part that stays in the notes only; ป้าย ends it. */
const MARKER_CALENDAR = new RegExp(`${MARKER.source}|ภู่|ไส้|ป้าย`, 'g');

type Section = 'general' | 'cover' | 'inner';
/** 'sub' = the ภู่ / ไส้ part of a calendar: read into no field. */
type Where = Section | 'sub';

// ─── paper ──────────────────────────────────────────────────────────

const PAPER_WORD = /^(?:อาร์ต|อาร์ท|art(?![a-z])|ปอนด์|การ์ด|ถนอมสายตา|น้ำตาล|คาร์บอน|กล่องแป้ง|ปรู๊ฟ|ปรุ๊ฟ)/i;
/** Where a paper name ends: the next attribute, or a page / sheet count ("24 หน้า", "100 แผ่น"). */
const PAPER_STOP = /พิมพ์|ปริ้น|เคลือบ|ขนาด|จำนวน|เข้าเล่ม|ไดคัท|\d+\s*(?:หน้า|แผ่น)/;
const WEIGHT = /\d{2,3}\s*(?:แกรม|กรัม|gsm|g)(?![a-z])/i;
/** "… หรือ 260 แกรม", "…/260g": an alternative weight is copied along, never dropped. */
const WEIGHT_MORE = /^\s*(?:หรือ|\/|,)\s*\d{2,3}\s*(?:แกรม|กรัม|gsm|g)(?![a-z])/i;

/**
 * The paper named at the start of `body`, as written; null when it is not a paper.
 * `named` = the body must start with a known paper word (no weight alone is enough).
 */
function paperFrom(body: string, named: boolean): string | null {
  let b = body;
  const stop = b.search(PAPER_STOP);
  if (stop >= 0) b = b.slice(0, stop);
  const w = WEIGHT.exec(b);
  if (w) {
    let end = w.index + w[0].length;
    for (let more = WEIGHT_MORE.exec(b.slice(end)); more; more = WEIGHT_MORE.exec(b.slice(end))) end += more[0].length;
    b = b.slice(0, end);
  }
  b = b.replace(/\s+/g, ' ').replace(/^[\s:：\-–]+/, '').trim();
  if (b === '' || Array.from(b).length > PAPER_MAX) return null;
  if (PAPER_WORD.test(b)) return b;
  return w && !named ? b : null;
}

// ─── colour ─────────────────────────────────────────────────────────

/**
 * "4 สี" (not the 4 of A4 / เอ 4, not 4/1, 4+1, 1-2, not สี่, not "N สีเดียว"),
 * "สีเดียว" (not สีเดียวกัน / สีเดียวกับ), "ขาวดำ".
 */
const COLOUR = /(?<![\dA-Za-z.\/+\-–])(?<!เอ\s{0,2})([1-4])\s*สี(?!่|เดียว)|สีเดียว(?!กัน|กับ)|ขาว\s*-?\s*ดำ/g;
const PRINT_VERB = /พิมพ์|ปริ้น|print|สกรีน/gi;
const WHOLE_BOOK = /^\s*ทั้งเล่ม/;

const COLOUR_WORD = '(?:น้ำเงิน|น้ำตาล|ดำ|แดง|เขียว|ฟ้า|ชมพู|เหลือง|ส้ม|ม่วง|ทอง|เงิน)';
const COLOUR_RUN = `${COLOUR_WORD}(?:[\\s,/]+${COLOUR_WORD})*`;
const NOTE_DASH = new RegExp(`^\\s*[-–]\\s*(${COLOUR_RUN})`);
const NOTE_PAREN = new RegExp(`^\\s*\\(\\s*(${COLOUR_RUN})\\s*\\)`);
const NOTE_SPACE = new RegExp(`^\\s+(${COLOUR_RUN})`);
const NOTE_LATER = new RegExp(`สี\\s*(${COLOUR_WORD})`, 'g');

/**
 * Is this "N สี" an ink count? Yes when a print verb comes before it (and no
 * `กระดาษ` in between — that would be the paper's colours), or when it follows a
 * ปก / เนื้อใน marker directly. "ปั๊มฟอยล์ 2 สี", "กระดาษคาร์บอน 3 สี" are not.
 */
function isInkCount(before: string, afterMarker: boolean): boolean {
  const paper = before.lastIndexOf('กระดาษ');
  let verb = -1;
  for (const m of before.matchAll(PRINT_VERB)) verb = m.index;
  return verb >= 0 ? verb > paper : afterMarker && paper < 0;
}

/** The colour name(s) written right after an ink count; '' when there is none to trust. */
function colourNote(rest: string): string {
  const whole = (m: RegExpExecArray): string => (isThai(rest[m[0].length]) ? '' : m[1].replace(/\s+/g, ' ').trim());
  const dash = NOTE_DASH.exec(rest);
  if (dash) return whole(dash);
  if (/^\s*\(/.test(rest)) {
    // A parenthesis right after the count is either colour names only, or not a note.
    const paren = NOTE_PAREN.exec(rest);
    return paren ? paren[1].replace(/\s+/g, ' ').trim() : '';
  }
  const space = NOTE_SPACE.exec(rest);
  if (space) return whole(space);
  for (const later of rest.matchAll(NOTE_LATER)) {
    // "สีทอง" as a word of its own — not หูเชือกสีดำ, ฟอยล์สีทอง, and not a paper's colour.
    if (isThai(rest[later.index - 1]) || isThai(rest[later.index + later[0].length])) continue;
    if (rest.slice(0, later.index).includes('กระดาษ')) return '';
    return later[1];
  }
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
    // Glued to a word (ถุงกระดาษ…, พิมพ์บนกระดาษ…) it must name a known paper.
    const p = paperFrom(text.slice(i + 6), i > 0 && isThai(text[i - 1]));
    if (p) into.paper.add(p);
  }
  if (afterMarker) {
    const p = paperFrom(text.trimStart(), true);
    if (p) into.paper.add(p);
  }
  for (const m of text.matchAll(COLOUR)) {
    if (!isInkCount(text.slice(0, m.index), afterMarker)) continue;
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

// ─── size ───────────────────────────────────────────────────────────

/**
 * A3–A6 (not A3+), เอ 3–เอ 6 (a word of its own, or right after ขนาด / ครึ่ง),
 * and N x N [x N] with an optional unit. A number after "/" is part of a fraction;
 * `"` is inches only when no letter follows it.
 */
const SIZE_TOKEN =
  /(?<![A-Za-z0-9])A([3-6])(?![0-9A-Za-z+])|(?:(?<=ขนาด|ครึ่ง)|(?<![\u0E00-\u0E7F]))เอ\s?([3-6])(?!\d)|(?<![\d.\/])(\d+(?:\.\d+)?)\s*[x×*]\s*(?:สูง\s*)?(\d+(?:\.\d+)?)(?:\s*[x×*]\s*(\d+(?:\.\d+)?))?\s*(ซม\.?|นิ้ว|มม\.?|"(?![\u0E00-\u0E7FA-Za-z])|(?:cm|mm|inch(?:es)?)(?![a-z])\.?)?/gi;
const SIZE_ANCHOR = /ขนาด[^\d\n]{0,15}$/;
/** "ครึ่ง A4" = A5 (exact for A sizes). */
const SIZE_HALF = /ครึ่ง\s*$/;
/** Halved, unfolded or a fraction of a size: not read. */
const SIZE_QUALIFIER = /(?:ครึ่ง(?:หน้า|แผ่น|ของ)?|กาง(?:ออก)?|\d\s*\/\s*\d)\s*$/;
const SIZE_QUALIFIER_AFTER = /^\s*ครึ่ง/;

function sizeUnitOf(raw: string | undefined): string {
  const u = (raw ?? '').toLowerCase();
  if (u.startsWith('ซม') || u.startsWith('cm')) return 'ซม.';
  if (u.startsWith('นิ้ว') || u.startsWith('inch') || u === '"') return 'นิ้ว';
  if (u.startsWith('มม') || u.startsWith('mm')) return 'มม.';
  return '';
}

function readSize(lines: string[], fields: SpecFields): void {
  const tokens: Array<{ key: string; value: string; unit: string; dim: boolean; line: number; anchored: boolean; qualified: boolean }> = [];
  lines.forEach((line, n) => {
    for (const m of line.matchAll(SIZE_TOKEN)) {
      const prefix = line.slice(0, m.index);
      const a = m[1] ?? m[2];
      const half = !!a && SIZE_HALF.test(prefix);
      const value = a ? `A${half ? Number(a) + 1 : a}` : [m[3], m[4], m[5]].filter(Boolean).join('x');
      const unit = a ? '' : sizeUnitOf(m[6]);
      tokens.push({
        key: `${value}|${unit}`,
        value,
        unit,
        dim: !a,
        line: n,
        anchored: SIZE_ANCHOR.test(prefix),
        qualified: (!half && SIZE_QUALIFIER.test(prefix)) || SIZE_QUALIFIER_AFTER.test(line.slice(m.index + m[0].length)),
      });
    }
  });
  if (tokens.length === 0) return;
  // The size after "ขนาด" is the product's size when it is the first size written,
  // alone on its line, and no other "ขนาด …" disagrees. Otherwise every size counts.
  const first = tokens[0];
  const leads =
    first.anchored &&
    tokens.filter((t) => t.line === first.line).length === 1 &&
    new Set(tokens.filter((t) => t.anchored).map((t) => t.key)).size === 1;
  const pool = leads ? [first] : tokens;
  if (pool.some((t) => t.qualified)) return;
  if (new Set(pool.map((t) => t.key)).size !== 1) return;
  if (!first.dim) {
    fields.size = first.value;
  } else if (first.unit !== '') {
    fields.size = first.value;
    fields.sizeUnit = first.unit;
  }
}

// ─── checkboxes ─────────────────────────────────────────────────────

/** A negation or a condition earlier on the line: whatever follows is not a spec. */
const NOT_A_SPEC = /ไม่|หาก|ถ้า|ยกเว้น/;
const COAT = /เคลือบ/g;
const LAM = '(?:ลามิเนต|pvc|opp)?';
const COAT_EITHER = new RegExp(`^\\s*${LAM}\\s*(?:เงา|ด้าน)\\s*[/,]\\s*(?:เงา|ด้าน)`, 'i');
const COAT_SPOT = /^\s*(?:spot\s*uv|สปอต\s*ยูวี|(?:uv|ยูวี)\s*เฉพาะ(?:จุด|ที่))/i;
const COAT_UV = /^\s*(?:uv|ยูวี)/i;
/** เคลือบด้าน — not "ด้านหน้า / ด้านเดียว / ด้านนอก …", where ด้าน means a side. */
const COAT_MATTE = new RegExp(`^\\s*${LAM}\\s*ด้าน(?!เดียว|หน้า|หลัง|นอก|ใน|ละ)`, 'i');
const COAT_GLOSS = new RegExp(`^\\s*${LAM}\\s*เงา`, 'i');

/**
 * Does a line state `word` as a spec? Not on a line that offers a choice ("หรือ"),
 * not after a negation / condition, and — when `after` is given — only after it.
 */
function states(lines: string[], word: RegExp, after?: RegExp, notAfter?: RegExp): boolean {
  for (const line of lines) {
    if (line.includes('หรือ')) continue;
    for (const m of line.matchAll(word)) {
      const before = line.slice(0, m.index);
      if (NOT_A_SPEC.test(before)) continue;
      if (after && !after.test(before)) continue;
      if (notAfter && notAfter.test(before)) continue;
      return true;
    }
  }
  return false;
}

function readFlags(lines: string[], fields: SpecFields): void {
  let gloss = false;
  let matte = false;
  for (const line of lines) {
    if (line.includes('หรือ')) continue;
    for (const m of line.matchAll(COAT)) {
      if (NOT_A_SPEC.test(line.slice(0, m.index))) continue;
      const tail = line.slice(m.index + m[0].length);
      if (COAT_EITHER.test(tail)) continue;
      if (COAT_SPOT.test(tail)) fields.coatSpotUV = true;
      else if (COAT_UV.test(tail)) fields.coatUV = true;
      else if (COAT_MATTE.test(tail)) matte = true;
      else if (COAT_GLOSS.test(tail)) gloss = true;
    }
  }
  // Both named = a list of options, not a spec.
  if (gloss !== matte) {
    if (gloss) fields.coatGloss = true;
    else fields.coatMatte = true;
  }
  if (states(lines, /spot\s*uv|สปอต\s*ยูวี/gi)) fields.coatSpotUV = true;
  if (states(lines, /ไสกาว/g)) fields.glue = true;
  if (states(lines, /มุงหลังคา(?![\u0E00-\u0E7F])/g)) fields.saddle = true;
  if (states(lines, /กระดูกงู|เข้าห่วง|ห่วงลวด/g)) fields.spine = true;
  if (states(lines, /ปรุ(?![\u0E00-\u0E7F])/g)) fields.perf = true;
  // "พิมพ์ … ดิจิตอล" — not a title (Digital Marketing), not a digital proof.
  if (states(lines, /ดิจิตอล|ดิจิทัล|digital/gi, /พิมพ์|ปริ้น|print/i, /ปรู๊ฟ|ปรุ๊ฟ|proof/i)) fields.digital = true;
}

// ─── summary ────────────────────────────────────────────────────────

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

// ─── read ───────────────────────────────────────────────────────────

/** The one value of a set, or '' when it is empty or holds more than one. */
function only(values: Set<string>): string {
  return values.size === 1 ? [...values][0] : '';
}

function read(description: string): SpecFromText {
  let text = description;
  if (text.length > MAX_INPUT) {
    // Too long: read only the whole lines before the limit (a cut line could lose half a value).
    const cut = text.lastIndexOf('\n', MAX_INPUT);
    if (cut <= 0) return EMPTY_SPEC;
    text = text.slice(0, cut);
  }
  text = text.replace(/[\t\u00a0\u200b]/g, ' ');
  const lines = text.split(/\r\n|\r|\n/);

  const buckets: Record<Section, Bucket> = { general: bucket(), cover: bucket(), inner: bucket() };
  const whole = new Set<string>();
  const marker = text.includes('ปฏิทิน') ? MARKER_CALENDAR : MARKER;
  /** The lines without the ภู่ / ไส้ part — what size and the checkboxes are read from. */
  const main: string[] = [];
  /** What an unmarked line belongs to. A cover is its own line only; it never carries on. */
  let carry: Exclude<Where, 'cover'> = 'general';
  let sectioned = false;
  for (const line of lines) {
    let section: Where = carry;
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
      if (m[0] === 'ปก') {
        if (COVER_TYPE.test(line.slice(m.index + 2)) && !LINE_LEAD.test(line.slice(0, m.index))) continue;
        next = 'cover';
      } else if (m[0] === 'เนื้อใน' || m[0] === 'เนิ้อใน') next = 'inner';
      else if (m[0] !== 'ป้าย') next = 'sub';
      else if (section === 'sub') next = 'general';
      else continue; // ป้าย outside a ภู่ / ไส้ part is ordinary text
      take(m.index);
      section = next;
      if (next !== 'cover') carry = next;
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
  // With sections, paper / colour written outside them is not used.
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

  readFlags(main, fields);
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
