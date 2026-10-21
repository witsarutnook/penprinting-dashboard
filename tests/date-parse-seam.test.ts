// tests/date-parse-seam.test.ts
// L13 (2026-10-21): one parse seam for every reader of a stored date cell.
//
// The L14 prod census (AUDIT-BACKLOG) found 455 Sheet-era cells stored as
// JS Date.toString() ('Mon May 18 2026 00:00:00 GMT+0700 (Indochina Time)')
// — orders.date_in ×179, orders.date_due ×179, shipped.shipped_date ×97 —
// where the user-visible day (displayDate → 18/5/2026) and the compute path
// (parseDateDMY → new Date(s) → host-local → 17/5/2026 on Vercel UTC)
// disagreed. daysLeft/urgency, analytics month buckets and list year/month
// filters all read parseDateDMY, so a cell on the 1st of a month fell into
// the previous month on the server.
//
// parseDateParts (lib/jobs.ts) is now the only place a cell is read:
// displayDate renders it, parseDateDMY builds a host-local MIDNIGHT Date of
// that calendar day (what every consumer compares by y/m/d or day-diffs),
// dmyToISOInput formats it for <input type="date">. Every case below runs
// under TZ=UTC (Vercel) and TZ=Asia/Bangkok (browser / this Mac).
import { describe, it, expect, afterEach } from 'vitest';
import { parseDateParts, displayDate, dmyToISOInput } from '@/lib/jobs';
import { parseDateDMY } from '@/lib/analytics';
import { deriveTrackStatus } from '@/lib/track-status';

const TZS = ['UTC', 'Asia/Bangkok'] as const;
const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const ymd = (d: Date | null) =>
  d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null;
const hms = (d: Date) => `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}`;

const DATE_TOSTRING = 'Mon May 18 2026 00:00:00 GMT+0700 (Indochina Time)';

describe('parseDateParts — the single seam', () => {
  it.each(TZS)('[%s] reads every stored shape to the same calendar day as displayDate', (tz) => {
    process.env.TZ = tz;
    expect(parseDateParts('2026-05-18')).toEqual({ y: 2026, m: 5, d: 18 });
    expect(parseDateParts('18/5/2026')).toEqual({ y: 2026, m: 5, d: 18 });
    expect(parseDateParts('18/05/2026')).toEqual({ y: 2026, m: 5, d: 18 });
    expect(parseDateParts(DATE_TOSTRING)).toEqual({ y: 2026, m: 5, d: 18 });
    expect(parseDateParts('2026-05-07T17:00:00.000Z')).toEqual({ y: 2026, m: 5, d: 8 });
    expect(parseDateParts('"2026-05-07T17:00:00.000Z"')).toEqual({ y: 2026, m: 5, d: 8 });
    expect(parseDateParts('2026-05-08T00:00:00+07:00')).toEqual({ y: 2026, m: 5, d: 8 });
    expect(parseDateParts('2026-05-07 23:30')).toEqual({ y: 2026, m: 5, d: 7 });
    expect(parseDateParts('2026-05-07T23:30:00.123')).toEqual({ y: 2026, m: 5, d: 7 });
    expect(parseDateParts('21/4/2026 10:00')).toEqual({ y: 2026, m: 4, d: 21 });
  });
  it('tolerates the comma Sheets puts after D/M/YYYY (parseDateDMY always did; displayDate used to pass it through raw)', () => {
    expect(parseDateParts('21/04/2026, 10:00')).toEqual({ y: 2026, m: 4, d: 21 });
    expect(displayDate('21/04/2026, 10:00')).toBe('21/4/2026');
  });
  it('null for empty, quotes-only and unparseable cells', () => {
    expect(parseDateParts('')).toBeNull();
    expect(parseDateParts('   ')).toBeNull();
    expect(parseDateParts(null)).toBeNull();
    expect(parseDateParts(undefined)).toBeNull();
    expect(parseDateParts('""')).toBeNull();
    expect(parseDateParts('" "')).toBeNull();
    expect(parseDateParts('ไม่ระบุ')).toBeNull();
    expect(parseDateParts('N/A')).toBeNull();
  });
  it.each(TZS)('[%s] "2026-05-07 (แก้ไข)" (deferred Minor) parses through the Date fallback — V8 skips a trailing "(…)" like "(Indochina Time)"', (tz) => {
    process.env.TZ = tz;
    expect(parseDateParts('2026-05-07 (แก้ไข)')).toEqual({ y: 2026, m: 5, d: 7 });
    expect(displayDate('2026-05-07 (แก้ไข)')).toBe('7/5/2026');
  });
});

describe('parseDateDMY — compute path reads the displayed day (L13)', () => {
  it.each(TZS)('[%s] Date.toString() cells (the 455 prod rows) land on the Bangkok day, not the host-local one', (tz) => {
    process.env.TZ = tz;
    const d = parseDateDMY(DATE_TOSTRING);
    expect(ymd(d)).toBe('2026-5-18');
    expect(hms(d!)).toBe('0:0:0');
  });
  it.each(TZS)('[%s] zoned / quoted / offset-less ISO agree with displayDate', (tz) => {
    process.env.TZ = tz;
    expect(ymd(parseDateDMY('2026-05-07T17:00:00.000Z'))).toBe('2026-5-8');
    expect(ymd(parseDateDMY('"2026-05-07T17:00:00.000Z"'))).toBe('2026-5-8');
    expect(ymd(parseDateDMY('2026-05-07 23:30'))).toBe('2026-5-7');
    expect(ymd(parseDateDMY('2026-05-07T23:30:00'))).toBe('2026-5-7');
  });
  it.each(TZS)('[%s] canonical shapes unchanged; D/M/YYYY + suffix/comma still parse; junk → null', (tz) => {
    process.env.TZ = tz;
    expect(ymd(parseDateDMY('2026-05-18'))).toBe('2026-5-18');
    expect(ymd(parseDateDMY('18/5/2026'))).toBe('2026-5-18');
    expect(ymd(parseDateDMY('21/4/2026 10:00'))).toBe('2026-4-21');
    expect(ymd(parseDateDMY('21/04/2026, 10:00'))).toBe('2026-4-21');
    expect(parseDateDMY('')).toBeNull();
    expect(parseDateDMY(null)).toBeNull();
    expect(parseDateDMY('""')).toBeNull();
    expect(parseDateDMY('ไม่ระบุ')).toBeNull();
  });
  it.each(TZS)('[%s] agreement property: host-local y/m/d of parseDateDMY === displayDate for every parseable shape', (tz) => {
    process.env.TZ = tz;
    const shapes = [
      '2026-05-18', '18/5/2026', '05/09/2026', DATE_TOSTRING,
      'Sat Dec 05 2026 00:00:00 GMT+0700 (Indochina Time)',
      '2026-05-07T17:00:00.000Z', '"2026-05-07T17:00:00.000Z"', '2026-01-31T18:30:00Z',
      '2026-05-08T00:00:00+07:00', '2026-05-07 23:30', '2026-05-07T23:30:00.123',
      '21/4/2026 10:00', '21/04/2026, 10:00',
    ];
    for (const s of shapes) {
      const d = parseDateDMY(s)!;
      expect(`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`, s).toBe(displayDate(s));
    }
  });
});

describe('dmyToISOInput — edit-form prefill reads the displayed day (L13)', () => {
  it.each(TZS)('[%s] every stored shape prefills the day the user sees', (tz) => {
    process.env.TZ = tz;
    expect(dmyToISOInput('2026-05-18')).toBe('2026-05-18');
    expect(dmyToISOInput('18/5/2026')).toBe('2026-05-18');
    expect(dmyToISOInput(DATE_TOSTRING)).toBe('2026-05-18');
    expect(dmyToISOInput('2026-05-07T17:00:00.000Z')).toBe('2026-05-08');
    // Used to prefill BLANK (new Date('"…"') is NaN) — the user retyped the date.
    expect(dmyToISOInput('"2026-05-07T17:00:00.000Z"')).toBe('2026-05-08');
    // Used to prefill blank too (toISODate is strict, new Date() reads D/M as M/D).
    expect(dmyToISOInput('21/4/2026 10:00')).toBe('2026-04-21');
    expect(dmyToISOInput('21/04/2026, 10:00')).toBe('2026-04-21');
    // Offset-less = Bangkok wall-clock: the written day, not host-local shifted to Bangkok.
    expect(dmyToISOInput('2026-05-07 23:30')).toBe('2026-05-07');
    expect(dmyToISOInput('2026-05-07T23:30:00')).toBe('2026-05-07');
  });
  it('blank for empty / quotes-only / unparseable', () => {
    expect(dmyToISOInput('')).toBe('');
    expect(dmyToISOInput(null)).toBe('');
    expect(dmyToISOInput('""')).toBe('');
    expect(dmyToISOInput('ไม่ระบุ')).toBe('');
  });
});

describe('deriveTrackStatus daysLeft on a Date.toString() due date (the /track + LINE compute path)', () => {
  it.each(TZS)('[%s] due tomorrow stays 1 day left — on UTC it used to floor to 0 ("กำหนดส่งวันนี้")', (tz) => {
    process.env.TZ = tz;
    const today = new Date(2026, 4, 17); // 17 May 2026, local midnight like getBangkokToday()
    const st = deriveTrackStatus({ dept: 'print', staff: 'x', date: DATE_TOSTRING }, null, null, today);
    expect(st.daysLeft).toBe(1);
    const dueToday = deriveTrackStatus(
      { dept: 'print', staff: 'x', date: DATE_TOSTRING }, null, null, new Date(2026, 4, 18),
    );
    expect(dueToday.daysLeft).toBe(0);
  });
});
