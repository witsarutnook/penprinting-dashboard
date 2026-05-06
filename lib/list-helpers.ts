import { parseDateDMY } from './analytics';

/**
 * Shared helpers for the list pages (/orders, /shipped, /cancelled, /archive).
 * Year/Month filters, CSV builder, distinct-year extraction.
 */

export const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** Extract distinct years (descending) from a list of items by reading a date field. */
export function distinctYears<T>(items: T[], pickDate: (item: T) => string | null | undefined): number[] {
  const set = new Set<number>();
  for (const it of items) {
    const d = parseDateDMY(pickDate(it));
    if (d) set.add(d.getFullYear());
  }
  return Array.from(set).sort((a, b) => b - a);
}

/** Filter items by year (CE) and 1-based month. Pass 0 / undefined to skip a filter. */
export function filterByYearMonth<T>(
  items: T[],
  pickDate: (item: T) => string | null | undefined,
  year: number,
  month: number,
): T[] {
  if (!year && !month) return items;
  return items.filter((it) => {
    const d = parseDateDMY(pickDate(it));
    if (!d) return false;
    if (year && d.getFullYear() !== year) return false;
    if (month && d.getMonth() + 1 !== month) return false;
    return true;
  });
}

/** Year-of-date as 4-digit CE — useful for "เดือน" column display. */
export function dateMonthLabel(input: string | null | undefined): string {
  const d = parseDateDMY(input);
  if (!d) return '—';
  return `${THAI_MONTHS_FULL[d.getMonth()]} ${d.getFullYear() + 543}`;
}

/** Build a CSV string from rows of (header, value)[] — UTF-8 BOM for Excel. */
export function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines: string[] = [headers.map(escape).join(',')];
  for (const row of rows) lines.push(row.map(escape).join(','));
  return '﻿' + lines.join('\n');
}

/** Trigger a CSV download in the browser. */
export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
