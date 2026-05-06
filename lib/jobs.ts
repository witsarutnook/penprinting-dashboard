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

/** DD/MM/YYYY → YYYY-MM-DD for prefilling <input type="date"> in edit mode. */
export function dmyToISOInput(input: string | null | undefined): string {
  return toISODate(input);
}

/** Display-format date as D/M/YYYY (no leading zeros) — matches WP screenshot.
 *  Accepts:
 *    - YYYY-MM-DD (Apps Script string storage)
 *    - DD/MM/YYYY (legacy display)
 *    - JS Date.toString() output ("Tue Apr 21 2026 00:00:00 GMT+0700 ...")
 *      — happens when Sheets auto-converts string cells to Date objects;
 *        sheetToArray then calls String(value) which yields this format.
 *    - Date with HH:MM time → adds time after if was originally there
 *  Returns "—" for empty/invalid. */
export function displayDate(input: string | null | undefined): string {
  if (!input) return '—';
  const s = String(input).trim();
  if (!s) return '—';
  let d: number, m: number, y: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (dmy) {
    d = +dmy[1]; m = +dmy[2]; y = +dmy[3];
  } else {
    // Fallback: try Date parser. Use Asia/Bangkok TZ for extraction so
    // "Tue Apr 21 2026 00:00:00 GMT+0700" → 21/4/2026 (not 20/4 in UTC).
    const dt = new Date(s);
    if (isNaN(dt.getTime())) return s;
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    return fmt.format(dt);
  }
  if (!d || !m || !y) return s;
  return `${d}/${m}/${y}`;
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
