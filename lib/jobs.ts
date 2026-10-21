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

/** Convert any of our stored date shapes → YYYY-MM-DD for prefilling
 *  `<input type="date">` in edit mode. Handles:
 *    - "" / null               → ""
 *    - "YYYY-MM-DD"            → as-is
 *    - "DD/MM/YYYY"            → ISO
 *    - "Tue Apr 21 2026 ..."   → ISO via Bangkok-TZ Date parse (Sheets
 *      auto-converts string cells to Date objects, sheetToArray then
 *      stringifies them in this shape — without the parser fallback the
 *      edit form's date inputs render blank).
 */
export function dmyToISOInput(input: string | null | undefined): string {
  if (!input) return '';
  const s = String(input).trim();
  if (!s) return '';
  const iso = toISODate(s);
  // toISODate returns input unchanged when it can't parse — detect that
  // and try the Date parser before giving up. The HTML date input only
  // accepts strict ISO so we have to format with leading zeros.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return '';
  // Use en-CA which formats as YYYY-MM-DD natively, in Bangkok TZ so the
  // calendar day matches what Sheets shows the user.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(dt);
}

/** Display-format date as D/M/YYYY (no leading zeros) — matches WP screenshot.
 *  The single date parser for every surface: staff screens, web `/track`, and
 *  the LINE `/track` Flex card (its `cleanDate_` delegates to displayDatePadded).
 *  Accepts:
 *    - YYYY-MM-DD, or an ISO timestamp with NO zone ("2026-05-07 23:30",
 *      "2026-05-07T23:30:00") — the date portion as written, NO timezone shift
 *      (an offset-less timestamp is Bangkok wall-clock, and must not depend on
 *      the host TZ). Date-only is what the dashboard writes today
 *      (getBangkokToday() / the date input).
 *    - DD/MM/YYYY, optionally followed by whitespace + anything ("21/4/2026
 *      10:00") — the date portion is used, the suffix is dropped (use
 *      displayDateTime when the time matters).
 *    - Anything else `new Date()` can parse, converted to the Asia/Bangkok
 *      calendar day: ISO with an explicit zone ("2026-05-07T17:00:00.000Z" →
 *      8/5/2026, how Google Sheets serialised a Bangkok-midnight Date; or a
 *      "+07:00"-style offset) and JS Date.toString() output ("Tue Apr 21 2026
 *      00:00:00 GMT+0700 ...", what sheetToArray's String(value) yields when
 *      Sheets auto-converted a string cell to a Date).
 *    - Any of the above wrapped in literal double quotes (legacy objectToRow
 *      double-stringify) — unwrapped first.
 *  Returns "—" for empty; unparseable input comes back unchanged. */
export function displayDate(input: string | null | undefined): string {
  if (!input) return '—';
  let s = String(input).trim();
  if (!s) return '—';
  // Strip JSON-stringify quote artifacts. Apps Script `objectToRow` had a
  // bug that double-stringified Date objects into '"2026-05-07T17:00:00.000Z"'
  // when re-writing rows in promoteDraft / cancelOrder paths (fixed
  // 2026-05-08). Older orders already touched by those flows have date
  // cells that begin and end with literal double quotes; unwrap them so
  // the regex below matches normally and the user sees a clean date.
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim();
  }
  let d: number, m: number, y: number;
  // ISO date, optionally with a time but NO zone: "2026-05-07", "2026-05-07 23:30",
  // "2026-05-07T23:30:00.123". An offset-less timestamp is Bangkok wall-clock, so
  // the date portion as written is the answer — handing it to new Date() would
  // read it as HOST-local time (8/5 on Vercel UTC, 7/5 in a Bangkok browser =
  // hydration mismatch). The $ anchor is what keeps a trailing "Z" / "±HH:MM"
  // from matching: those strings fall through to the Bangkok-TZ Date fallback,
  // otherwise a 17:00Z Sheet timestamp would show the previous (UTC) day.
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/);
  // D/M/YYYY may be followed by whitespace + a time/anything ("21/4/2026 10:00").
  // new Date() reads D/M/Y as M/D/Y (invalid for day > 12), so take the parts here.
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (dmy) {
    d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
  } else {
    // Fallback: try Date parser. Use Asia/Bangkok TZ for extraction so
    // "Tue Apr 21 2026 00:00:00 GMT+0700" → 21/4/2026 (not 20/4 in UTC) and
    // "2026-05-07T17:00:00.000Z" → 8/5/2026.
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return s;
    // Read the parts and rebuild D/M/YYYY below instead of using fmt.format():
    // en-GB zero-pads even with day:'numeric' ("08/05/2026"), which would break
    // this function's no-leading-zeros contract (displayDatePadded pads itself).
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(dt);
    const part = (t: string) => +(parts.find((p) => p.type === t)?.value ?? 0);
    d = part('day'); m = part('month'); y = part('year');
  }
  if (!d || !m || !y) return s;
  return `${d}/${m}/${y}`;
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
