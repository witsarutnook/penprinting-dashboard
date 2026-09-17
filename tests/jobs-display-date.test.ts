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
