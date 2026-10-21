// tests/date-shape-census.test.ts
// L14 (2026-10-21): one-shot, read-only prod census of the date cells the app
// renders. Pins for lib/date-shape-census.ts:
//
//  1. classifyDateShape buckets every legacy Sheet-era shape we know of (quoted
//     ISO, ISO with zone, offset-less ISO, Date.toString, D/M/YYYY + comma or
//     suffix, ISO + suffix, quotes-only) and keeps the two canonical shapes apart.
//  2. summariseShapes counts per class and keeps at most 5 samples per class.
//  3. The drift report compares what the user SEES (displayDate) with what the
//     compute path (parseDateDMY → daysLeft/urgency/analytics) and the edit-form
//     prefill (dmyToISOInput) read from the same cell — on the host TZ the
//     census runs under (Vercel = UTC). It found 455 drifting prod cells and
//     decided L13; since L13 all three share parseDateParts, so it reads zero.
//  4. loadDateShapeCensus is READ-ONLY (SELECT only, no apply mode), covers the
//     pinned column list, reads both the TEXT column and the `raw` JSONB key the
//     app actually renders from, and skips tombstoned jobs like the app does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { queueResult, resetMockPostgres, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  DATE_SHAPE_COLUMNS,
  classifyDateShape,
  summariseShapes,
  summariseDrift,
  loadDateShapeCensus,
} from '@/lib/date-shape-census';

describe('classifyDateShape', () => {
  it('keeps the two canonical shapes apart from everything else', () => {
    expect(classifyDateShape('2026-05-07')).toBe('isoDate');
    expect(classifyDateShape('21/4/2026')).toBe('dmy');
    expect(classifyDateShape('21/04/2026')).toBe('dmy');
  });
  it('empty / null / whitespace → empty', () => {
    expect(classifyDateShape('')).toBe('empty');
    expect(classifyDateShape('   ')).toBe('empty');
    expect(classifyDateShape(null)).toBe('empty');
    expect(classifyDateShape(undefined)).toBe('empty');
  });
  it('quote-wrapped ISO (objectToRow double-stringify) → quotedIso; other quoted → quotedOther', () => {
    expect(classifyDateShape('"2026-05-07T17:00:00.000Z"')).toBe('quotedIso');
    expect(classifyDateShape('"2026-05-07"')).toBe('quotedIso');
    expect(classifyDateShape('""')).toBe('quotedOther');
    expect(classifyDateShape('" "')).toBe('quotedOther');
    expect(classifyDateShape('"21/4/2026"')).toBe('quotedOther');
  });
  it('ISO timestamp with an explicit zone → isoZoned', () => {
    expect(classifyDateShape('2026-05-07T17:00:00.000Z')).toBe('isoZoned');
    expect(classifyDateShape('2026-05-08T00:00:00+07:00')).toBe('isoZoned');
    expect(classifyDateShape('2026-05-07T23:30:00-05:00')).toBe('isoZoned');
  });
  it('ISO timestamp without a zone → isoOffsetless', () => {
    expect(classifyDateShape('2026-05-07 23:30')).toBe('isoOffsetless');
    expect(classifyDateShape('2026-05-07T23:30:00')).toBe('isoOffsetless');
    expect(classifyDateShape('2026-05-07T23:30:00.123')).toBe('isoOffsetless');
  });
  it('ISO date followed by free text → isoWithSuffix (the deferred Minor "2026-05-07 (แก้ไข)")', () => {
    expect(classifyDateShape('2026-05-07 (แก้ไข)')).toBe('isoWithSuffix');
  });
  it('JS Date.toString() output → dateToString', () => {
    expect(classifyDateShape('Tue Apr 21 2026 00:00:00 GMT+0700 (Indochina Time)')).toBe('dateToString');
    expect(classifyDateShape('Sat Sep 05 2026 00:00:00 GMT+0700')).toBe('dateToString');
  });
  it('D/M/YYYY + comma → dmyWithComma; D/M/YYYY + whitespace suffix → dmyWithSuffix', () => {
    expect(classifyDateShape('21/04/2026, 10:00')).toBe('dmyWithComma');
    expect(classifyDateShape('21/4/2026 10:00')).toBe('dmyWithSuffix');
    expect(classifyDateShape('21/4/2026 (แก้ไข)')).toBe('dmyWithSuffix');
  });
  it('anything else → other', () => {
    expect(classifyDateShape('ไม่ระบุ')).toBe('other');
    expect(classifyDateShape('2026/05/07')).toBe('other');
    expect(classifyDateShape('07-05-2026')).toBe('other');
  });
});

describe('summariseShapes', () => {
  it('counts per class and keeps at most 5 samples per class, in input order', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: String(100 + i),
      value: `"2026-05-0${(i % 9) + 1}T17:00:00.000Z"`,
    }));
    rows.push({ id: '200', value: '' });
    rows.push({ id: '201', value: 'Tue Apr 21 2026 00:00:00 GMT+0700 (Indochina Time)' });

    const s = summariseShapes(rows);

    expect(s.nonCanonical).toBe(9);
    expect(s.classes.quotedIso?.count).toBe(7);
    expect(s.classes.quotedIso?.samples).toHaveLength(5);
    expect(s.classes.quotedIso?.samples[0]).toEqual({ id: '100', value: '"2026-05-01T17:00:00.000Z"' });
    expect(s.classes.empty).toEqual({ count: 1, samples: [{ id: '200', value: '' }] });
    expect(s.classes.dateToString?.count).toBe(1);
    // Classes with no rows are omitted so the JSON stays readable.
    expect(s.classes.dmyWithComma).toBeUndefined();
    expect(s.classes.isoDate).toBeUndefined();
  });
  it('empty input → zero, no classes', () => {
    expect(summariseShapes([])).toEqual({ nonCanonical: 0, classes: {} });
  });
});

describe('summariseDrift — display vs compute (parseDateDMY) vs prefill (dmyToISOInput)', () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  // Before L13 these shapes drifted: quoted ISO → compute null + prefill blank;
  // '…Z' and Date.toString() → compute one day early on a UTC host; D/M/YYYY +
  // suffix → prefill blank. All three readers now share parseDateParts, so the
  // census must report zero drift for them on BOTH host TZs.
  it.each(['UTC', 'Asia/Bangkok'])('[%s] legacy shapes: display, compute and prefill agree (L13 closed the drift)', (tz) => {
    process.env.TZ = tz;
    const d = summariseDrift([
      { id: '1', value: '"2026-05-07T17:00:00.000Z"' },
      { id: '2', value: '2026-05-07T17:00:00.000Z' },
      { id: '3', value: 'Tue Apr 21 2026 00:00:00 GMT+0700 (Indochina Time)' },
      { id: '4', value: '21/4/2026 10:00' },
      { id: '5', value: '21/04/2026, 10:00' },
      { id: '6', value: '2026-05-07 23:30' },
    ]);
    expect(d.displayUnparsed.count).toBe(0);
    expect(d.computeDrift).toEqual({ count: 0, samples: [] });
    expect(d.prefillDrift).toEqual({ count: 0, samples: [] });
  });

  it('cells displayDate cannot parse at all are listed as displayUnparsed, not drift', () => {
    const d = summariseDrift([
      { id: '3', value: 'ไม่ระบุ' },
      { id: '4', value: 'N/A' },
    ]);
    expect(d.displayUnparsed).toEqual({
      count: 2,
      samples: [
        { id: '3', value: 'ไม่ระบุ' },
        { id: '4', value: 'N/A' },
      ],
    });
    expect(d.computeDrift.count).toBe(0);
    expect(d.prefillDrift.count).toBe(0);
  });

  it('empty and quotes-only cells never count as drift (display is — and nothing parses)', () => {
    const d = summariseDrift([
      { id: '1', value: '' },
      { id: '2', value: '""' },
      { id: '3', value: null },
    ]);
    expect(d.displayUnparsed.count).toBe(0);
    expect(d.computeDrift.count).toBe(0);
    expect(d.prefillDrift.count).toBe(0);
  });

  it('reports the host time zone the drift was measured under', () => {
    process.env.TZ = 'UTC';
    expect(summariseDrift([]).hostTimeZone).toBe('UTC');
  });
});

describe('DATE_SHAPE_COLUMNS', () => {
  it('pins the cells the customer/staff surfaces render from', () => {
    expect(DATE_SHAPE_COLUMNS.map((c) => `${c.table}.${c.column}`)).toEqual([
      'orders.date_in',
      'orders.date_due',
      'jobs.date',
      'jobs.date_in',
      'shipped.shipped_date',
    ]);
    expect(DATE_SHAPE_COLUMNS.map((c) => c.rawKey)).toEqual([
      'dateIn', 'dateDue', 'date', 'dateIn', 'shippedDate',
    ]);
  });
});

describe('loadDateShapeCensus', () => {
  const savedTz = process.env.TZ;
  beforeEach(() => resetMockPostgres());
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  function queueColumn(totals: Record<string, string>, colRows: unknown[], rawRows: unknown[]) {
    queueResult({ rows: [totals], rowCount: 1 });
    queueResult({ rows: colRows, rowCount: colRows.length });
    queueResult({ rows: rawRows, rowCount: rawRows.length });
  }

  it('is read-only: every statement is a SELECT, 3 per pinned column', async () => {
    for (let i = 0; i < DATE_SHAPE_COLUMNS.length; i++) {
      queueColumn(
        { total: '10', col_iso: '8', col_dmy: '1', raw_iso: '8', raw_dmy: '1', mismatch: '0' },
        [{ id: '1', value: '"2026-05-07T17:00:00.000Z"' }],
        [{ id: '1', value: '"2026-05-07T17:00:00.000Z"' }],
      );
    }

    const census = await loadDateShapeCensus();

    expect(sqlCalls).toHaveLength(DATE_SHAPE_COLUMNS.length * 3);
    for (const call of sqlCalls) {
      expect(call.text).toMatch(/^SELECT/i);
      expect(call.text).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE)\b/i);
    }
    expect(census.readOnly).toBe(true);
    expect(census.columns).toHaveLength(DATE_SHAPE_COLUMNS.length);
  });

  it('reads the TEXT column and the raw JSONB key separately and reports the mismatch count', async () => {
    for (let i = 0; i < DATE_SHAPE_COLUMNS.length; i++) {
      queueColumn(
        { total: '120', col_iso: '100', col_dmy: '10', raw_iso: '99', raw_dmy: '10', mismatch: '1' },
        [{ id: '7', value: 'Tue Apr 21 2026 00:00:00 GMT+0700 (Indochina Time)' }],
        [
          { id: '9', value: '21/4/2026 10:00' },
          { id: '8', value: '21/04/2026, 10:00' },
          { id: '7', value: 'Tue Apr 21 2026 00:00:00 GMT+0700 (Indochina Time)' },
        ],
      );
    }

    process.env.TZ = 'Asia/Bangkok';
    const census = await loadDateShapeCensus();
    const ordersIn = census.columns[0];

    expect(ordersIn).toMatchObject({
      table: 'orders',
      column: 'date_in',
      rawKey: 'dateIn',
      total: 120,
      columnRawMismatch: 1,
    });
    expect(ordersIn.columnShapes).toMatchObject({ canonicalIso: 100, canonicalDmy: 10, nonCanonical: 1 });
    expect(ordersIn.columnShapes.classes.dateToString?.count).toBe(1);
    expect(ordersIn.rawShapes).toMatchObject({ canonicalIso: 99, canonicalDmy: 10, nonCanonical: 3 });
    expect(ordersIn.rawShapes.classes.dmyWithComma?.samples).toEqual([{ id: '8', value: '21/04/2026, 10:00' }]);
    // Drift is measured on the raw key — that is what the app renders from.
    // (Zero here since L13: all three readers share parseDateParts.)
    expect(ordersIn.rawDrift.displayUnparsed.count).toBe(0);
    expect(ordersIn.rawDrift.computeDrift.count).toBe(0);
    expect(ordersIn.rawDrift.prefillDrift.count).toBe(0);

    // The column queries bind the canonical regexes instead of interpolating them,
    // and the raw query targets the JSONB key.
    const [totals, colQ, rawQ] = sqlCalls;
    expect(totals.text).toContain('FROM orders');
    expect(totals.values).toEqual(['^\\d{4}-\\d{2}-\\d{2}$', '^\\d{1,2}/\\d{1,2}/\\d{4}$']);
    expect(colQ.text).toContain('date_in');
    expect(rawQ.text).toContain("raw->>'dateIn'");
  });

  it('skips tombstoned jobs exactly like the app reads (phase2_deleted_at IS NULL)', async () => {
    for (let i = 0; i < DATE_SHAPE_COLUMNS.length; i++) {
      queueColumn({ total: '0', col_iso: '0', col_dmy: '0', raw_iso: '0', raw_dmy: '0', mismatch: '0' }, [], []);
    }
    await loadDateShapeCensus();
    const jobsCalls = sqlCalls.filter((c) => c.text.includes('FROM jobs'));
    expect(jobsCalls).toHaveLength(6);
    for (const c of jobsCalls) expect(c.text).toContain('phase2_deleted_at IS NULL');
    const otherCalls = sqlCalls.filter((c) => !c.text.includes('FROM jobs'));
    for (const c of otherCalls) expect(c.text).not.toContain('phase2_deleted_at');
  });
});
