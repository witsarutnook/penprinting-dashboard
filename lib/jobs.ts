import type { Dept } from './board';

/**
 * Normalize a date string for Apps Script storage.
 * Accepts:
 *   - YYYY-MM-DD (HTML date input native format) → return as-is
 *   - DD/MM/YYYY (legacy display format)         → convert to ISO
 *   - empty/null                                 → empty string
 *
 * Mirrors WP `toISO()` (production-monitoring.js:2003).
 */
export function toISODate(input: string | null | undefined): string {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

/** Convert any stored date shape → YYYY-MM-DD for prefilling
 *  `<input type="date">` in edit mode. Reads the cell through `parseDateParts`
 *  (the same seam `displayDate` renders from), so the form prefills exactly the
 *  day the user sees on the row — including the Sheet-era shapes that used to
 *  prefill BLANK ('"…Z"' quoted → new Date() NaN; '21/4/2026 10:00' → strict
 *  toISODate miss + new Date() reading D/M as M/D). '' for empty / unparseable
 *  (L13, 2026-10-21). */
export function dmyToISOInput(input: string | null | undefined): string {
  const p = parseDateParts(input);
  if (!p) return '';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export interface DateParts {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

/** Trim + strip the literal double quotes of the legacy objectToRow
 *  double-stringify bug ('"2026-05-07T17:00:00.000Z"', fixed 2026-05-08) and
 *  trim again, so a quotes-only cell ('""', '" "') comes back as ''. */
function unwrapDateCell(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// ISO date, optionally with a time but NO zone: "2026-05-07", "2026-05-07 23:30",
// "2026-05-07T23:30:00.123". An offset-less timestamp is Bangkok wall-clock, so
// the date portion as written is the answer — handing it to new Date() would
// read it as HOST-local time (8/5 on Vercel UTC, 7/5 in a Bangkok browser =
// hydration mismatch). The $ anchor is what keeps a trailing "Z" / "±HH:MM"
// from matching: those strings fall through to the Bangkok-TZ Date fallback,
// otherwise a 17:00Z Sheet timestamp would show the previous (UTC) day.
const ISO_NO_ZONE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;
// D/M/YYYY may be followed by whitespace or a comma + a time/anything
// ("21/4/2026 10:00", "21/04/2026, 10:00" as Sheets/Intl write it). new Date()
// reads D/M/Y as M/D/Y (invalid for day > 12), so take the parts here.
const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,].*)?$/;

/** THE parse seam for a stored date cell (L13, 2026-10-21). Every reader goes
 *  through here — `displayDate`/`displayDatePadded` (staff screens, web /track,
 *  LINE /track card), `parseDateDMY` in lib/analytics (daysLeft/urgency,
 *  analytics month buckets, list year/month filters, calendar) and
 *  `dmyToISOInput` (edit-form prefill) — so the day a customer sees, the day
 *  the urgency maths uses and the day the edit form prefills can never
 *  disagree again. The L14 prod census found 455 Sheet-era
 *  'Mon May 18 2026 00:00:00 GMT+0700 (…)' cells where parseDateDMY's old
 *  `new Date(s)` fallback landed one day early on Vercel (UTC).
 *
 *  Returns the calendar day (Asia/Bangkok semantics) or null:
 *    - YYYY-MM-DD, or an ISO timestamp with NO zone → the date as written
 *      (no TZ shift; deterministic across server UTC / browser Bangkok).
 *    - D/M/YYYY, optionally followed by whitespace/comma + anything → the
 *      date portion.
 *    - Anything else `new Date()` can parse — ISO with an explicit zone
 *      ("2026-05-07T17:00:00.000Z", how Sheets serialised a Bangkok-midnight
 *      Date; "+07:00" offsets) and JS Date.toString() output ("Tue Apr 21 2026
 *      00:00:00 GMT+0700 (…)", sheetToArray's String(Date)) → converted to the
 *      Asia/Bangkok calendar day.
 *    - Any of the above wrapped in literal double quotes → unwrapped first.
 *    - Empty / quotes-only / unparseable → null. */
export function parseDateParts(input: string | null | undefined): DateParts | null {
  const s = unwrapDateCell(input);
  if (!s) return null;
  let d: number, m: number, y: number;
  const iso = s.match(ISO_NO_ZONE_RE);
  const dmy = s.match(DMY_RE);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (dmy) {
    d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
  } else {
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return null;
    // Read the parts in Asia/Bangkok so "Tue Apr 21 2026 00:00:00 GMT+0700" →
    // 21/4 (not 20/4 in UTC) and "2026-05-07T17:00:00.000Z" → 8/5. formatToParts,
    // not format(): en-GB zero-pads even with day:'numeric'.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(dt);
    const part = (t: string) => +(parts.find((p) => p.type === t)?.value ?? 0);
    d = part('day'); m = part('month'); y = part('year');
  }
  if (!d || !m || !y) return null;
  return { y, m, d };
}

/** Display-format date as D/M/YYYY (no leading zeros) — matches WP screenshot.
 *  Renders `parseDateParts` (see there for the accepted shapes): the single
 *  *display* parser for every surface — staff screens, web `/track`, and the
 *  LINE `/track` Flex card (its `cleanDate_` delegates to displayDatePadded).
 *  Since L13 the compute path (`parseDateDMY`) and the edit-form prefill
 *  (`dmyToISOInput`) read the very same seam.
 *  Returns "—" for empty (including a quotes-only cell — never '' here: the
 *  LINE Flex card would get a text node with empty `text`, which LINE rejects,
 *  failing the whole /track reply); other unparseable input comes back
 *  unchanged (quotes stripped). */
export function displayDate(input: string | null | undefined): string {
  const s = unwrapDateCell(input);
  if (!s) return '—';
  const p = parseDateParts(s);
  if (!p) return s;
  return `${p.d}/${p.m}/${p.y}`;
}

/** Customer-facing date display — same parsing as `displayDate`, but zero
 *  padded to DD/MM/YYYY. The LINE Flex cards have always padded, so an unpadded
 *  web `/track` showed the same order as "5/9/2026" on the web and "05/09/2026"
 *  in LINE. Customer surfaces (/track, /track/c/[token], both Flex cards — the
 *  card's `cleanDate_` in lib/ai-quote/track-flex.ts is a thin delegate to this)
 *  use this, so the same order can no longer show different days per channel;
 *  internal staff screens (board, orders, archive, shipped) keep the compact
 *  `displayDate`.
 *  Non-date input falls through unchanged, exactly like `displayDate`. */
export function displayDatePadded(input: string | null | undefined): string {
  const out = displayDate(input);
  const m = out.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return out;
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
}

/** Display date+time as D/M/YYYY HH:MM (Bangkok TZ). Used by cancelled list
 *  and audit timestamps where the original cell had time-of-day. */
export function displayDateTime(input: string | null | undefined): string {
  if (!input) return '—';
  const s = String(input).trim();
  if (!s) return '—';
  // If string already in DD/MM/YYYY HH:MM format, return as-is.
  if (/^\d{1,2}\/\d{1,2}\/\d{4}(\s+\d{1,2}:\d{2})?$/.test(s)) return s;
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return s;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // en-GB → "21/4/2026, 08:15"; strip the comma to match WP "21/4/2026 08:15".
  return fmt.format(dt).replace(',', '');
}

/** Today as YYYY-MM-DD in Asia/Bangkok TZ — default for dateIn on new jobs. */
export function bangkokTodayISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

/** Shape of the Apps Script `addJob`/`updateJob` payload (mirrors JOBS_HEADERS). */
export interface JobPayload {
  id: number;
  name: string;
  date: string;        // YYYY-MM-DD due
  dateIn: string;      // YYYY-MM-DD start (today if blank)
  dept: Dept | string;
  staff: string;
  status: string;      // 'pending' for new
  orderId: number | '';
  cowork?: unknown;    // pass-through on edit; omit on add
}

export interface JobFormInput {
  name?: string;
  date?: string;       // YYYY-MM-DD from <input type="date">
  dateIn?: string;     // YYYY-MM-DD
  dept?: string;
  staff?: string;
  orderId?: string | number;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const VALID_DEPTS = ['graphic', 'print', 'post'];

export function validateJobInput(input: JobFormInput): ValidationResult {
  const errors: string[] = [];
  const name = (input.name || '').trim();
  if (!name) errors.push('กรุณาระบุชื่องาน');
  const date = toISODate(input.date);
  if (!date) errors.push('กรุณาระบุกำหนดส่ง');
  if (!input.dept || !VALID_DEPTS.includes(input.dept)) errors.push('กรุณาเลือกแผนก');
  if (!input.staff || !String(input.staff).trim()) errors.push('กรุณาเลือกผู้รับงาน');
  if (input.orderId !== undefined && input.orderId !== '' && input.orderId !== null) {
    const n = Number(input.orderId);
    if (!Number.isFinite(n) || n <= 0) errors.push('เลขใบสั่งงานไม่ถูกต้อง');
  }
  return { ok: errors.length === 0, errors };
}
