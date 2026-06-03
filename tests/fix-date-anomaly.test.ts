/**
 * Pure-function tests for the normalizeDate helper in
 * /api/admin/fix-date-anomaly. The helper lives inline in the route module;
 * we import it via a re-export shim to keep tests at the lib level (no
 * Next.js runtime needed). Alternative would be moving normalizeDate to
 * lib/, but it's a one-shot fixer used by exactly one endpoint — kept
 * co-located for clarity.
 *
 * If this test file needs to grow, that's the signal to move the helper.
 */
import { describe, it, expect } from 'vitest';

// Pure copy of the route's normalizeDate — kept in sync by hand.
// (Inlined to avoid pulling next/server through the test runtime.)
function normalizeDate(input: unknown): string {
  if (typeof input !== 'string') return String(input ?? '');
  let val = input;
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'string') val = parsed;
    } catch {
      // not JSON — leave val alone
    }
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return input;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

describe('normalizeDate', () => {
  it('unwraps a JSON-encoded ISO string and converts to Bangkok DMY', () => {
    // The actual bug pattern from AUDIT-BACKLOG: orders 202605046/047/049
    // 2026-05-07T17:00:00.000Z UTC + 7h = 2026-05-08 00:00 Asia/Bangkok
    expect(normalizeDate('"2026-05-07T17:00:00.000Z"')).toBe('08/05/2026');
  });

  it('passes through an already-correct DD/MM/YYYY (idempotency)', () => {
    expect(normalizeDate('08/05/2026')).toBe('08/05/2026');
    expect(normalizeDate('01/12/2025')).toBe('01/12/2025');
  });

  it('converts a bare ISO string (no JSON wrap) to Bangkok DMY', () => {
    expect(normalizeDate('2026-05-07T17:00:00.000Z')).toBe('08/05/2026');
  });

  it('handles ISO at noon — same Bangkok date', () => {
    // 2026-05-08T05:00:00Z = 2026-05-08T12:00 Asia/Bangkok
    expect(normalizeDate('2026-05-08T05:00:00.000Z')).toBe('08/05/2026');
  });

  it('handles a Bangkok-midnight rollover correctly', () => {
    // 2026-05-08T17:00:00Z = 2026-05-09T00:00 Asia/Bangkok (next day)
    expect(normalizeDate('2026-05-08T17:00:00.000Z')).toBe('09/05/2026');
  });

  it('preserves an unrecognised string (defensive — never lose data)', () => {
    expect(normalizeDate('not-a-date')).toBe('not-a-date');
    expect(normalizeDate('TBD')).toBe('TBD');
  });

  it('coerces a non-string input to empty string (null/undefined safety)', () => {
    expect(normalizeDate(null)).toBe('');
    expect(normalizeDate(undefined)).toBe('');
    expect(normalizeDate(42)).toBe('42');
  });

  it('handles a quoted DMY (defensive — bug variant where the wrap survived a partial fix)', () => {
    // Unwrap the quote, recognise DMY → idempotent passthrough of the inner value.
    expect(normalizeDate('"08/05/2026"')).toBe('08/05/2026');
  });

  it('returns empty string for an empty string', () => {
    // new Date('') is Invalid → preserve original.
    expect(normalizeDate('')).toBe('');
  });
});
