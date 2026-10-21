// tests/jobs-display-date.test.ts
import { describe, it, expect } from 'vitest';
import { displayDate, displayDatePadded } from '@/lib/jobs';

describe('displayDatePadded', () => {
  it('zero-pads day and month so customer surfaces match the LINE Flex cards', () => {
    expect(displayDatePadded('5/9/2026')).toBe('05/09/2026');
    expect(displayDatePadded('2026-09-05')).toBe('05/09/2026');
    expect(displayDatePadded('05/09/2026')).toBe('05/09/2026');
    expect(displayDatePadded('12/09/2026')).toBe('12/09/2026');
  });
  it('pads dates that came through the Date-parser fallback', () => {
    expect(displayDatePadded('Sat Sep 05 2026 00:00:00 GMT+0700')).toBe('05/09/2026');
  });
  it('passes empty and unparseable input through unchanged', () => {
    expect(displayDatePadded('')).toBe('—');
    expect(displayDatePadded(null)).toBe('—');
    expect(displayDatePadded('ไม่ระบุ')).toBe('ไม่ระบุ');
  });
  it('leaves the compact displayDate (staff screens) alone', () => {
    expect(displayDate('05/09/2026')).toBe('5/9/2026');
  });
});

// L4 (2026-10-21): the LINE /track card and the web /track used to parse legacy
// Sheet-era date cells with two different parsers and could show different days
// for the same order. displayDate is now the single parser for both. Fixtures
// carry an explicit Z / +07:00 offset so the tests never depend on the machine TZ.
describe('displayDate — legacy Sheet-era shapes (single parser for LINE card + web)', () => {
  it('converts ISO timestamps to the Asia/Bangkok calendar date', () => {
    // Google Sheets serialised a Bangkok-midnight Date as 17:00Z the day before.
    expect(displayDate('2026-05-07T17:00:00.000Z')).toBe('8/5/2026');
    // Quote wrapper from the old objectToRow double-stringify bug is unwrapped first.
    expect(displayDatePadded('"2026-05-07T17:00:00.000Z"')).toBe('08/05/2026');
    // Already carries the Bangkok offset — same calendar day, no shift.
    expect(displayDate('2026-05-08T00:00:00+07:00')).toBe('8/5/2026');
  });
  it('leaves date-only ISO untouched (no timezone shift)', () => {
    expect(displayDate('2026-09-05')).toBe('5/9/2026');
    expect(displayDate('2026-01-01')).toBe('1/1/2026');
  });
  it('takes the date portion of DD/MM/YYYY followed by a time', () => {
    expect(displayDate('21/4/2026 10:00')).toBe('21/4/2026');
    expect(displayDatePadded('21/4/2026 10:00')).toBe('21/04/2026');
  });
  it('treats offset-less ISO timestamps as Bangkok wall-clock (date portion, no host-TZ dependence)', () => {
    // No Z / +HH:MM: new Date() would read these as HOST-local time, so the same
    // cell rendered 8/5 on Vercel (UTC) and 7/5 in a Bangkok browser (hydration
    // mismatch). They are Bangkok wall-clock, so the date portion is the answer.
    expect(displayDate('2026-05-07 23:30')).toBe('7/5/2026');
    expect(displayDate('2026-05-07T23:30')).toBe('7/5/2026');
    expect(displayDate('2026-05-07T23:30:00')).toBe('7/5/2026');
    expect(displayDate('2026-05-07T23:30:00.123')).toBe('7/5/2026');
    expect(displayDatePadded('"2026-05-07T23:30:00"')).toBe('07/05/2026');
    // Zoned timestamps must still convert to the Bangkok day.
    expect(displayDate('2026-05-07T17:00:00.000Z')).toBe('8/5/2026');
    expect(displayDate('2026-05-07T23:30:00Z')).toBe('8/5/2026');
    expect(displayDate('2026-05-07T23:30:00-05:00')).toBe('8/5/2026');
    expect(displayDate('2026-05-08T00:00:00+07:00')).toBe('8/5/2026');
  });
  it('a cell that is only quotes renders as — instead of an empty string', () => {
    // An empty string would reach the LINE Flex card as a text node with empty
    // `text`, which LINE rejects -> the whole /track reply fails silently.
    expect(displayDate('""')).toBe('—');
    expect(displayDate('" "')).toBe('—');
    expect(displayDatePadded('""')).toBe('—');
  });
  it('keeps the compact (unpadded) contract on the Date-parser fallback too', () => {
    // en-GB zero-pads even with day:'numeric'; displayDate must still return D/M/YYYY.
    expect(displayDate('Sat Sep 05 2026 00:00:00 GMT+0700')).toBe('5/9/2026');
    expect(displayDate('2026-01-31T18:30:00Z')).toBe('1/2/2026');
  });
});
