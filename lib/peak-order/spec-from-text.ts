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

/** What one pass over the text gives: the spec, and the lines that are nothing but that spec. */
interface Reading extends SpecFromText {
  /** 0-based numbers of the lines whose whole content went into `fields` (spec §13). */
  lines: number[];
}
const NOTHING_READ: Reading = { fields: EMPTY_SPEC.fields, summary: '', lines: [] };

const MAX_INPUT = 4000;
const PAPER_MAX = 60;

const THAI = /[\u0E00-\u0E7F]/;
const isThai = (ch: string | undefined): boolean => ch !== undefined && THAI.test(ch);

/** A place on a line. */
interface Mark {
  line: number;
  start: number;
  end: number;
}

type Kind = 'size' | 'paper' | 'colour' | 'note' | 'coat' | 'bind' | 'flag';

/**
 * The place a value that reached a field is written (spec §13).
 * `asWritten` = the text there says no more than the field holds; when it says more
 * ("ขาวดำ", "10 x สูง 15", "เคลือบ PVC ด้าน") its line always stays in the notes.
 */
interface Found extends Mark {
  kind: Kind;
  asWritten: boolean;
}

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
function paperFrom(body: string, named: boolean): { value: string; length: number } | null {
  let b = body;
  const stop = b.search(PAPER_STOP);
  if (stop >= 0) b = b.slice(0, stop);
  const w = WEIGHT.exec(b);
  if (w) {
    let end = w.index + w[0].length;
    for (let more = WEIGHT_MORE.exec(b.slice(end)); more; more = WEIGHT_MORE.exec(b.slice(end))) end += more[0].length;
    b = b.slice(0, end);
  }
  const length = b.length;
  b = b.replace(/\s+/g, ' ').replace(/^[\s:：\-–]+/, '').trim();
  if (b === '' || Array.from(b).length > PAPER_MAX) return null;
  if (PAPER_WORD.test(b)) return { value: b, length };
  return w && !named ? { value: b, length } : null;
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
/** Between an ink count and a colour name written later only a page / side count may stand ("1 สี 1 หน้า สีทอง"). */
const NOTE_GAP = /^(?:[\s\d,.()\-–]|หน้า|ด้าน|หลัง|เดียว)*$/;

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

interface Note {
  text: string;
  /** Where the name is, counted from the start of `rest`. */
  start: number;
  end: number;
}

/** The colour name(s) written right after an ink count; null when there is none to trust. */
function colourNote(rest: string): Note | null {
  const whole = (m: RegExpExecArray): Note | null =>
    isThai(rest[m[0].length]) ? null : { text: m[1].replace(/\s+/g, ' ').trim(), start: 0, end: m[0].length };
  const dash = NOTE_DASH.exec(rest);
  if (dash) return whole(dash);
  if (/^\s*\(/.test(rest)) {
    // A parenthesis right after the count is either colour names only, or not a note.
    const paren = NOTE_PAREN.exec(rest);
    return paren ? { text: paren[1].replace(/\s+/g, ' ').trim(), start: 0, end: paren[0].length } : null;
  }
  const space = NOTE_SPACE.exec(rest);
  if (space) return whole(space);
  for (const later of rest.matchAll(NOTE_LATER)) {
    // "สีทอง" as a word of its own — not หูเชือกสีดำ, ฟอยล์สีทอง; and nothing but a page count before it —
    // not a paper's colour, not the wire's ("เข้าเล่มห่วงลวด สีดำ"), not a foil's.
    if (isThai(rest[later.index - 1]) || isThai(rest[later.index + later[0].length])) continue;
    if (!NOTE_GAP.test(rest.slice(0, later.index))) return null;
    return { text: later[1], start: later.index, end: later.index + later[0].length };
  }
  return null;
}

interface Bucket {
  paper: Set<string>;
  colour: Set<string>;
  note: Set<string>;
  found: Found[];
}
const bucket = (): Bucket => ({ paper: new Set(), colour: new Set(), note: new Set(), found: [] });

/** Colours written as "N สี ทั้งเล่ม" outside any section: the cover's and the inner's. */
interface Whole {
  values: Set<string>;
  found: Found[];
}

/** `line` / `offset` = the line number and where `text` starts on it. */
function readSegment(
  text: string,
  afterMarker: boolean,
  into: Bucket,
  whole: Whole | null,
  line: number,
  offset: number,
): void {
  for (let i = text.indexOf('กระดาษ'); i >= 0; i = text.indexOf('กระดาษ', i + 6)) {
    // Glued to a word (ถุงกระดาษ…, พิมพ์บนกระดาษ…) it must name a known paper.
    const p = paperFrom(text.slice(i + 6), i > 0 && isThai(text[i - 1]));
    if (p) {
      into.paper.add(p.value);
      into.found.push({ kind: 'paper', asWritten: true, line, start: offset + i, end: offset + i + 6 + p.length });
    }
  }
  if (afterMarker) {
    const lead = text.length - text.trimStart().length;
    const p = paperFrom(text.trimStart(), true);
    if (p) {
      into.paper.add(p.value);
      into.found.push({ kind: 'paper', asWritten: true, line, start: offset + lead, end: offset + lead + p.length });
    }
  }
  for (const m of text.matchAll(COLOUR)) {
    if (!isInkCount(text.slice(0, m.index), afterMarker)) continue;
    const value = m[1] ? `${m[1]}สี` : '1สี';
    const end = m.index + m[0].length;
    const rest = text.slice(end);
    into.colour.add(value);
    // "ขาวดำ" also names the ink, which the field does not hold.
    const asWritten = m[1] !== undefined || m[0].startsWith('สีเดียว');
    into.found.push({ kind: 'colour', asWritten, line, start: offset + m.index, end: offset + end });
    const book = whole ? WHOLE_BOOK.exec(rest) : null;
    if (whole && book) {
      whole.values.add(value);
      whole.found.push({ kind: 'colour', asWritten, line, start: offset + m.index, end: offset + end + book[0].length });
    }
    if (!m[1] || m[1] === '1' || m[1] === '2') {
      const note = colourNote(rest);
      if (note) {
        into.note.add(note.text);
        into.found.push({ kind: 'note', asWritten: true, line, start: offset + end + note.start, end: offset + end + note.end });
      }
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

/** Returns every place the size that went into the field is written. */
function readSize(lines: string[], fields: SpecFields): Found[] {
  const tokens: Array<
    Mark & { key: string; value: string; unit: string; dim: boolean; anchored: boolean; qualified: boolean; asWritten: boolean }
  > = [];
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
        start: m.index,
        end: m.index + m[0].length,
        anchored: SIZE_ANCHOR.test(prefix),
        qualified: (!half && SIZE_QUALIFIER.test(prefix)) || SIZE_QUALIFIER_AFTER.test(line.slice(m.index + m[0].length)),
        // "10 x สูง 15" says more than the field holds. (ครึ่ง / กางออก stay behind as words of their own.)
        asWritten: !m[0].includes('สูง'),
      });
    }
  });
  if (tokens.length === 0) return [];
  // The size after "ขนาด" is the product's size when it is the first size written,
  // alone on its line, and no other "ขนาด …" disagrees. Otherwise every size counts.
  const first = tokens[0];
  const leads =
    first.anchored &&
    tokens.filter((t) => t.line === first.line).length === 1 &&
    new Set(tokens.filter((t) => t.anchored).map((t) => t.key)).size === 1;
  const pool = leads ? [first] : tokens;
  if (pool.some((t) => t.qualified)) return [];
  if (new Set(pool.map((t) => t.key)).size !== 1) return [];
  if (!first.dim) {
    fields.size = first.value;
  } else if (first.unit !== '') {
    fields.size = first.value;
    fields.sizeUnit = first.unit;
  } else {
    return [];
  }
  return tokens
    .filter((t) => t.key === first.key)
    .map((t) => ({ kind: 'size', asWritten: t.asWritten, line: t.line, start: t.start, end: t.end }));
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
 * Where the lines state `word` as a spec. Not on a line that offers a choice ("หรือ"),
 * not after a negation / condition, and — when `after` is given — only after it.
 */
function states(lines: string[], word: RegExp, after?: RegExp, notAfter?: RegExp): Mark[] {
  const marks: Mark[] = [];
  lines.forEach((line, n) => {
    if (line.includes('หรือ')) return;
    for (const m of line.matchAll(word)) {
      const before = line.slice(0, m.index);
      if (NOT_A_SPEC.test(before)) continue;
      if (after && !after.test(before)) continue;
      if (notAfter && notAfter.test(before)) continue;
      marks.push({ line: n, start: m.index, end: m.index + m[0].length });
    }
  });
  return marks;
}

/** A film named with the coating ("เคลือบ PVC ด้าน") is more than the checkbox holds. */
const COAT_FILM = /pvc|opp/i;

/** Ticks the boxes; returns where they are written. */
function readFlags(lines: string[], fields: SpecFields): Found[] {
  const found: Found[] = [];
  const glossAt: Found[] = [];
  const matteAt: Found[] = [];
  let gloss = false;
  let matte = false;
  lines.forEach((line, n) => {
    if (line.includes('หรือ')) return;
    for (const m of line.matchAll(COAT)) {
      if (NOT_A_SPEC.test(line.slice(0, m.index))) continue;
      const tail = line.slice(m.index + m[0].length);
      if (COAT_EITHER.test(tail)) continue;
      let kind: RegExp;
      if (COAT_SPOT.test(tail)) {
        fields.coatSpotUV = true;
        kind = COAT_SPOT;
      } else if (COAT_UV.test(tail)) {
        fields.coatUV = true;
        kind = COAT_UV;
      } else if (COAT_MATTE.test(tail)) {
        matte = true;
        kind = COAT_MATTE;
      } else if (COAT_GLOSS.test(tail)) {
        gloss = true;
        kind = COAT_GLOSS;
      } else continue;
      const words = kind.exec(tail)?.[0] ?? '';
      const mark: Found = {
        kind: 'coat',
        asWritten: !COAT_FILM.test(words),
        line: n,
        start: m.index,
        end: m.index + m[0].length + words.length,
      };
      (kind === COAT_MATTE ? matteAt : kind === COAT_GLOSS ? glossAt : found).push(mark);
    }
  });
  // Both named = a list of options, not a spec.
  if (gloss !== matte) {
    if (gloss) fields.coatGloss = true;
    else fields.coatMatte = true;
    found.push(...glossAt, ...matteAt);
  }
  const tick = (
    key: 'coatSpotUV' | 'glue' | 'saddle' | 'spine' | 'perf' | 'digital',
    kind: Kind,
    marks: Mark[],
  ): void => {
    if (marks.length === 0) return;
    fields[key] = true;
    for (const m of marks) found.push({ ...m, kind, asWritten: true });
  };
  tick('coatSpotUV', 'coat', states(lines, /spot\s*uv|สปอต\s*ยูวี/gi));
  tick('glue', 'bind', states(lines, /ไสกาว/g));
  tick('saddle', 'bind', states(lines, /มุงหลังคา(?![\u0E00-\u0E7F])/g));
  tick('spine', 'bind', states(lines, /กระดูกงู|เข้าห่วง|ห่วงลวด/g));
  tick('perf', 'flag', states(lines, /ปรุ(?![\u0E00-\u0E7F])/g));
  // "พิมพ์ … ดิจิตอล" — not a title (Digital Marketing), not a digital proof.
  tick('digital', 'flag', states(lines, /ดิจิตอล|ดิจิทัล|digital/gi, /พิมพ์|ปริ้น|print/i, /ปรู๊ฟ|ปรุ๊ฟ|proof/i));
  return found;
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

// ─── lines that are nothing but the spec (spec §13) ─────────────────

/** A letter or a digit. */
const WORD = /[\p{L}\p{N}]/u;
/** What may be left of a line once its values are out: spaces, plain punctuation, a stray tone mark. */
const NOTHING = /^[\s\-,.()\p{M}]*$/u;

/**
 * The word that introduces a value says nothing once the value is in a field — but only
 * right before that value ("พิมพ์ 4 สี", "ขนาด A4", "เข้าเล่มแบบไสกาว"). Anywhere else it
 * stays ("ขนาดพิมพ์ 10x10", "พิมพ์ 1 สี เข้าเล่ม"). "ปริ้น" is never one: it may be the only
 * word that says the job is a digital print.
 */
type Intro = Partial<Record<Kind, RegExp>>;
const INTRO: Intro = {
  colour: /พิมพ์\s*$/,
  size: /ขนาด\s*[:：]?\s*$/,
  bind: /(?:เข้าเล่ม(?:แบบ)?\s*)?(?:เย็บ\s*)?$/,
  flag: /พิมพ์\s*$/,
};
/**
 * In a calendar the fields describe the ป้าย: "ขนาดป้าย 15x21", "ป้ายพิมพ์ 4 สี".
 * "ปฏิทิน" before it goes too when the order's name (the first line) already says ปฏิทิน.
 */
const introCalendar = (named: boolean): Intro => ({
  ...INTRO,
  colour: /(?:ป้าย\s*)?พิมพ์\s*$/,
  size: new RegExp(`${named ? '(?:ปฏิทิน\\s*)?' : ''}(?:ป้าย\\s*)?ขนาด\\s*(?:ป้าย\\s*)?[:：]?\\s*$`),
});

/** Is the line nothing but its bullet and what stands at `marks`? */
function nothingElse(line: string, marks: Mark[]): boolean {
  const chars = line.split('');
  chars.fill(' ', 0, /^[\s\-•*]*/.exec(line)?.[0].length ?? 0);
  for (const m of marks) chars.fill(' ', m.start, m.end);
  return NOTHING.test(chars.join(''));
}

// ─── read ───────────────────────────────────────────────────────────

function read(description: string): Reading {
  let text = description;
  let cut = false;
  if (text.length > MAX_INPUT) {
    // Too long: read only the whole lines before the limit (a cut line could lose half a value).
    const at = text.lastIndexOf('\n', MAX_INPUT);
    if (at <= 0) return NOTHING_READ;
    text = text.slice(0, at);
    cut = true;
  }
  text = text.replace(/[\t\u00a0\u200b]/g, ' ');
  const lines = text.split(/\r\n|\r|\n/);

  const buckets: Record<Section, Bucket> = { general: bucket(), cover: bucket(), inner: bucket() };
  const whole: Whole = { values: new Set(), found: [] };
  const calendar = text.includes('ปฏิทิน');
  const marker = calendar ? MARKER_CALENDAR : MARKER;
  /**
   * The lines with the ภู่ / ไส้ part blanked out — what size and the checkboxes are read from.
   * Same length as the lines, so a place on one is the same place on the other.
   */
  const main: string[] = [];
  /** Every ปก / เนื้อใน word that opened a part. */
  const openers: Mark[] = [];
  /** The ปก / เนื้อใน a line begins with: it names where the values go, nothing more. (Any other one on the line stays.) */
  const leading: Mark[] = [];
  /** Lines that begin with ปก / เนื้อใน: they head a part. */
  const heads = new Set<number>();
  /** Lines with a ภู่ / ไส้ part. */
  const subs = new Set<number>();
  /** Lines under a heading that names two parts ("ปก/เนื้อใน"): their values are in one part's fields only. */
  const shared = new Set<number>();
  /** Every stretch of text that belongs to เนื้อใน, marked on its line or carried from above. */
  const innerParts: Mark[] = [];
  /** What an unmarked line belongs to. A cover is its own line: the line after it belongs to no part. */
  let carry: Exclude<Where, 'cover'> = 'general';
  let joint = false;
  let sectioned = false;
  lines.forEach((line, n) => {
    const hits: Array<{ start: number; end: number; next: Where }> = [];
    let state: Where = carry;
    for (const m of line.matchAll(marker)) {
      let next: Where;
      if (m[0] === 'ปก') {
        if (COVER_TYPE.test(line.slice(m.index + 2)) && !LINE_LEAD.test(line.slice(0, m.index))) continue;
        next = 'cover';
      } else if (m[0] === 'เนื้อใน' || m[0] === 'เนิ้อใน') next = 'inner';
      else if (m[0] !== 'ป้าย') next = 'sub';
      // ป้าย ends a ภู่ / ไส้ part only at the start of a line ("เพิ่มป้ายโฆษณา" inside it does not).
      else if (state === 'sub' && LINE_LEAD.test(line.slice(0, m.index))) next = 'general';
      else continue; // any other ป้าย is ordinary text
      hits.push({ start: m.index, end: m.index + m[0].length, next });
      state = next;
    }
    const parts = hits.filter((h) => h.next === 'cover' || h.next === 'inner');
    if (parts.length > 0) {
      sectioned = true;
      for (const p of parts) openers.push({ line: n, start: p.start, end: p.end });
      // "… (ปก)", "… + ปก": a part named after the values. Which of them it covers is a guess,
      // so none is read into paper / colour, and the part above carries on untouched.
      if (WORD.test(line.slice(0, parts[0].start)) && !WORD.test(line.slice(parts[parts.length - 1].end))) {
        main.push(line);
        return;
      }
      if (LINE_LEAD.test(line.slice(0, parts[0].start))) {
        heads.add(n);
        leading.push({ line: n, start: parts[0].start, end: parts[0].end });
      }
      joint = parts.length > 1;
    } else if (joint) shared.add(n);

    let section: Where = carry;
    let from = 0;
    let afterMarker = false;
    let masked = '';
    const take = (end: number): void => {
      const seg = line.slice(from, end);
      if (section === 'sub') {
        masked += ' '.repeat(seg.length);
        if (seg.trim() !== '') subs.add(n);
        return;
      }
      masked += seg;
      if (section === 'inner') innerParts.push({ line: n, start: from, end });
      readSegment(seg, afterMarker, buckets[section], section === 'general' ? whole : null, n, from);
    };
    for (const h of hits) {
      take(h.start);
      section = h.next;
      carry = h.next === 'cover' ? 'general' : h.next;
      if (h.next === 'sub') subs.add(n);
      masked += h.next === 'sub' ? ' '.repeat(h.end - h.start) : line.slice(h.start, h.end);
      from = h.end;
      afterMarker = h.next === 'cover' || h.next === 'inner';
    }
    take(line.length);
    main.push(masked);
  });

  const fields: SpecFields = {};
  /** Every place a value that went into `fields` is written. */
  const found: Found[] = readSize(main, fields);
  /** A field took the one value of its kind: every place that kind is written there is in the field. */
  const inField = (from: Found[], kind: Kind): void => {
    for (const f of from) if (f.kind === kind) found.push(f);
  };

  // No ปก / เนื้อใน anywhere = a single-sheet job: the team fills the inner fields.
  // With sections, paper / colour written outside them is not used.
  const cover = buckets.cover;
  const inner = sectioned ? buckets.inner : buckets.general;
  const paperCover = only(cover.paper);
  const paperInner = only(inner.paper);
  const coverColor = only(new Set([...cover.colour, ...whole.values]));
  const innerColor = only(new Set([...inner.colour, ...whole.values]));
  if (paperCover) {
    fields.paperCover = paperCover;
    inField(cover.found, 'paper');
  }
  if (paperInner) {
    fields.paperInner = paperInner;
    inField(inner.found, 'paper');
  }
  if (coverColor) {
    fields.coverColor = coverColor;
    inField(cover.found, 'colour');
    const note = only(cover.note);
    if (note) {
      fields.coverColorNote = note;
      inField(cover.found, 'note');
    }
  }
  if (innerColor) {
    fields.innerColor = innerColor;
    inField(inner.found, 'colour');
    const note = only(inner.note);
    if (note) {
      fields.innerColorNote = note;
      inField(inner.found, 'note');
    }
  }
  // "N สี ทั้งเล่ม" is in the fields only when both colours took it.
  if (coverColor && coverColor === innerColor) inField(whole.found, 'colour');
  found.push(...readFlags(main, fields));

  const summary = summarise(fields, sectioned);
  // Part of the text was not read: it may say otherwise, so no line leaves the notes.
  if (cut) return { fields, summary, lines: [] };

  // ── Which lines hold nothing but those values (spec §13) ──
  const first = lines.findIndex((l) => l.trim() !== '');
  const intro = calendar ? introCalendar(first >= 0 && lines[first].includes('ปฏิทิน')) : INTRO;
  /**
   * May the text of this value leave the notes? Only when the field says all of it, the part included:
   * the coating boxes cannot say "inner pages"; size, binding and the other boxes cannot say "of the
   * cover" / "of the inner pages"; under "ปก/เนื้อใน" paper and colour sit in one part's fields only.
   */
  const usable = (f: Found): boolean => {
    if (!f.asWritten) return false;
    if (f.kind === 'coat') return !innerParts.some((p) => p.line === f.line && p.start <= f.start && f.start < p.end);
    if (f.kind === 'paper' || f.kind === 'colour' || f.kind === 'note') return !shared.has(f.line);
    return !openers.some((o) => o.line === f.line);
  };
  const valued = new Set(found.map((f) => f.line));
  const could = new Set<number>();
  lines.forEach((line, n) => {
    if (!valued.has(n)) return;
    const mine = found.filter((f) => f.line === n && usable(f));
    // The same colour or coating twice on a line is two sides ("4 สี / 4 สี"); the field holds one.
    for (const kind of ['colour', 'coat'] as const) {
      let end = -1;
      let times = 0;
      for (const f of mine.filter((x) => x.kind === kind).sort((x, y) => x.start - y.start)) {
        if (f.start >= end) times++;
        end = Math.max(end, f.end);
      }
      if (times > 1) return;
    }
    const marks: Mark[] = mine.map((f) => {
      const lead = intro[f.kind]?.exec(line.slice(0, f.start));
      return { line: n, start: f.start - (lead ? lead[0].length : 0), end: f.end };
    });
    if (nothingElse(line, [...marks, ...leading.filter((m) => m.line === n)])) could.add(n);
  });

  // A line with no value in any field may be the heading of the line under it, or say something
  // about the line above it ("ด้านหน้า", "ซอง", "ทั้ง 2 ด้าน", "หรือเคลือบเงา"): both neighbours stay.
  const bare = (n: number): boolean => n !== first && !valued.has(n) && !heads.has(n) && !subs.has(n);
  const near = (n: number, step: 1 | -1): number => {
    for (let i = n + step; i >= 0 && i < lines.length; i += step) if (lines[i].trim() !== '') return i;
    return -1;
  };
  const leave = new Set<number>();
  for (const n of could) {
    if (heads.has(n)) continue;
    const above = near(n, -1);
    const below = near(n, 1);
    if ((above >= 0 && bare(above)) || (below >= 0 && bare(below))) continue;
    leave.add(n);
  }
  // A ปก / เนื้อใน line heads the lines under it: it stays while one of them stays.
  for (const n of could) {
    if (!heads.has(n)) continue;
    let alone = true;
    for (let i = n + 1; alone && i < lines.length && !heads.has(i); i++) {
      if (lines[i].trim() !== '' && !leave.has(i)) alone = false;
    }
    if (alone) leave.add(n);
  }
  return { fields, summary, lines: [...leave].sort((x, y) => x - y) };
}

/** Spec fields read from one quotation line. Any input; never throws. */
export function specFromText(description: unknown): SpecFromText {
  if (typeof description !== 'string' || description === '') return EMPTY_SPEC;
  try {
    const r = read(description);
    return r === NOTHING_READ ? EMPTY_SPEC : { fields: r.fields, summary: r.summary };
  } catch {
    return EMPTY_SPEC;
  }
}

/**
 * The lines of the text (0-based, split on line breaks) on which every word is a value
 * `specFromText` put in a field, written as the field holds it, with no bare line next to it
 * (spec §13). Any input; never throws.
 *
 * NOT used when an order is created (spec §13.7, owner's decision 2026-11-19). Two independent
 * reviews each found 8 kinds of text — one step from real quotation lines — where dropping these
 * lines from the notes lost what they said. Do not wire it back into the notes on tests alone.
 */
export function linesReadFrom(description: unknown): number[] {
  if (typeof description !== 'string' || description === '') return [];
  try {
    return [...read(description).lines];
  } catch {
    return [];
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
