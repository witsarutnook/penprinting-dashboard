import { sql } from '@/lib/postgres';
import { displayDate, dmyToISOInput } from '@/lib/jobs';
import { parseDateDMY } from '@/lib/analytics';

/**
 * L14 (AUDIT-BACKLOG 2026-10-21) — one-shot, READ-ONLY census of the shapes
 * our date cells really have in prod. The date columns are TEXT and the
 * Sheet-era import left mixed shapes behind ('"2026-05-07T17:00:00.000Z"'
 * quoted, 'Tue Apr 21 2026 00:00:00 GMT+0700 (…)', '21/4/2026 10:00', and
 * 'YYYY-MM-DD' for everything v2 writes). Nobody had counted them, so the L13
 * decision (route parseDateDMY / dmyToISOInput through the displayDate seam?)
 * was being made on guesses. This is the data layer for
 * /api/admin/date-shape-census (GET = dry-run only; there is no apply mode).
 *
 * Two sources per column: the TEXT column itself AND the `raw` JSONB key —
 * the app renders from `raw` (lib/api-postgres.ts `SELECT raw FROM …`), so the
 * raw numbers are the ones that matter; the column is reported alongside with a
 * mismatch count so the two can be trusted to agree (writers keep both).
 *
 * Retire the route + this file after the census is recorded (PATTERNS §2.5).
 */

/** The two canonical shapes. JS copies for the classifier, Postgres ARE copies
 *  bound as query parameters (never interpolated). */
export const CANONICAL_ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CANONICAL_DMY_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
const PG_ISO = '^\\d{4}-\\d{2}-\\d{2}$';
const PG_DMY = '^\\d{1,2}/\\d{1,2}/\\d{4}$';

export interface DateShapeColumn {
  table: 'orders' | 'jobs' | 'shipped';
  column: string;
  /** Key inside the `raw` JSONB blob the app renders from. */
  rawKey: string;
  /** Extra row filter mirroring how the app reads the table. */
  where?: string;
}

/** The cells the customer/staff surfaces render dates from. jobs.date_in is
 *  included beside the four named in L14 because job-form prefills it through
 *  dmyToISOInput too (L13 scope). Tombstoned jobs are skipped like the app. */
export const DATE_SHAPE_COLUMNS: readonly DateShapeColumn[] = [
  { table: 'orders', column: 'date_in', rawKey: 'dateIn' },
  { table: 'orders', column: 'date_due', rawKey: 'dateDue' },
  { table: 'jobs', column: 'date', rawKey: 'date', where: 'phase2_deleted_at IS NULL' },
  { table: 'jobs', column: 'date_in', rawKey: 'dateIn', where: 'phase2_deleted_at IS NULL' },
  { table: 'shipped', column: 'shipped_date', rawKey: 'shippedDate' },
];

export type DateShapeClass =
  | 'isoDate'        // YYYY-MM-DD (canonical, what v2 writes)
  | 'dmy'            // D/M/YYYY (canonical, user-entered Sheet era)
  | 'empty'          // NULL / '' / whitespace
  | 'quotedIso'      // '"2026-05-07T17:00:00.000Z"' — objectToRow double-stringify (fixed 2026-05-08)
  | 'quotedOther'    // any other quote-wrapped cell, incl. quotes-only '""'
  | 'isoZoned'       // 2026-05-07T17:00:00.000Z / +07:00 — Sheets Date serialisation
  | 'isoOffsetless'  // 2026-05-07 23:30 / 2026-05-07T23:30:00 — no zone
  | 'isoWithSuffix'  // 2026-05-07 (แก้ไข) — deferred Minor
  | 'dateToString'   // Tue Apr 21 2026 00:00:00 GMT+0700 (…) — sheetToArray String(Date)
  | 'dmyWithComma'   // 21/04/2026, 10:00 — deferred Minor
  | 'dmyWithSuffix'  // 21/4/2026 10:00
  | 'other';

const ISO_TS_BODY = /^\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?/;
const ISO_ZONED_RE = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
const ISO_OFFSETLESS_RE = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const ISO_WITH_SUFFIX_RE = /^\d{4}-\d{2}-\d{2}\s+\S/;
const DATE_TOSTRING_RE = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{2} \d{4} \d{2}:\d{2}:\d{2} GMT/;
const DMY_WITH_COMMA_RE = /^\d{1,2}\/\d{1,2}\/\d{4},/;
const DMY_WITH_SUFFIX_RE = /^\d{1,2}\/\d{1,2}\/\d{4}\s+\S/;

export function classifyDateShape(value: string | null | undefined): DateShapeClass {
  if (value == null) return 'empty';
  const s = String(value).trim();
  if (!s) return 'empty';
  if (CANONICAL_ISO_RE.test(s)) return 'isoDate';
  if (CANONICAL_DMY_RE.test(s)) return 'dmy';
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1).trim();
    return ISO_TS_BODY.test(inner) ? 'quotedIso' : 'quotedOther';
  }
  if (ISO_ZONED_RE.test(s)) return 'isoZoned';
  if (ISO_OFFSETLESS_RE.test(s)) return 'isoOffsetless';
  if (ISO_WITH_SUFFIX_RE.test(s)) return 'isoWithSuffix';
  if (DATE_TOSTRING_RE.test(s)) return 'dateToString';
  if (DMY_WITH_COMMA_RE.test(s)) return 'dmyWithComma';
  if (DMY_WITH_SUFFIX_RE.test(s)) return 'dmyWithSuffix';
  return 'other';
}

export interface CensusRow {
  id: string;
  value: string | null;
}

export interface ShapeSample {
  id: string;
  value: string;
}

export interface ShapeSummary {
  nonCanonical: number;
  classes: Partial<Record<DateShapeClass, { count: number; samples: ShapeSample[] }>>;
}

const MAX_SAMPLES = 5;

/** Count the non-canonical rows per shape class, keeping ≤5 samples per class
 *  in input order. Classes with no rows are omitted. */
export function summariseShapes(rows: readonly CensusRow[]): ShapeSummary {
  const classes: ShapeSummary['classes'] = {};
  for (const row of rows) {
    const cls = classifyDateShape(row.value);
    const bucket = (classes[cls] ??= { count: 0, samples: [] });
    bucket.count += 1;
    if (bucket.samples.length < MAX_SAMPLES) {
      bucket.samples.push({ id: row.id, value: row.value ?? '' });
    }
  }
  return { nonCanonical: rows.length, classes };
}

export interface ComputeDriftSample {
  id: string;
  value: string;
  display: string;
  /** Host-local calendar day parseDateDMY lands on, D/M/YYYY; null = unparseable. */
  compute: string | null;
}

export interface PrefillDriftSample {
  id: string;
  value: string;
  display: string;
  /** dmyToISOInput output as the edit form would see it ('' = blank input). */
  prefill: string;
}

export interface DriftSummary {
  /** Where the drift was measured: parseDateDMY builds host-local Dates, so a
   *  '…Z' cell lands on a different calendar day on Vercel (UTC) than in a
   *  Bangkok browser. The census runs server-side = the /track + LINE condition. */
  hostTimeZone: string;
  /** Non-empty cells displayDate cannot turn into a date at all — the user
   *  sees the raw cell (e.g. '21/04/2026, 10:00' with the comma). These are a
   *  display bug, not parser drift, so they are listed apart. */
  displayUnparsed: { count: number; samples: ShapeSample[] };
  computeDrift: { count: number; samples: ComputeDriftSample[] };
  prefillDrift: { count: number; samples: PrefillDriftSample[] };
}

const DMY_OUT_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function hostLocalDMY(d: Date): string {
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function isoInputToDMY(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${+m[3]}/${+m[2]}/${+m[1]}`;
}

/** For each non-canonical cell, compare the day the user SEES (displayDate)
 *  with the day the compute path reads (parseDateDMY — daysLeft/urgency on
 *  /track + LINE, analytics month buckets, list year/month filters) and the
 *  day the edit form prefills (dmyToISOInput). A cell only counts as drift
 *  when displayDate yields a real date and the other parser yields a
 *  different one or nothing — empty / quotes-only cells render '—' and
 *  parse to nothing everywhere, which is agreement, not drift. */
export function summariseDrift(rows: readonly CensusRow[]): DriftSummary {
  const displayUnparsed: ShapeSample[] = [];
  const computeDrift: ComputeDriftSample[] = [];
  const prefillDrift: PrefillDriftSample[] = [];
  let unparsedCount = 0;
  let computeCount = 0;
  let prefillCount = 0;
  for (const row of rows) {
    const value = row.value ?? '';
    const display = displayDate(value);
    if (display === '—') continue; // empty / quotes-only: nothing to compare
    if (!DMY_OUT_RE.test(display)) {
      // displayDate hands unparseable input back unchanged — the user sees the raw cell.
      unparsedCount += 1;
      if (displayUnparsed.length < MAX_SAMPLES) displayUnparsed.push({ id: row.id, value });
      continue;
    }
    const parsed = parseDateDMY(value);
    const compute = parsed ? hostLocalDMY(parsed) : null;
    if (compute !== display) {
      computeCount += 1;
      if (computeDrift.length < MAX_SAMPLES) computeDrift.push({ id: row.id, value, display, compute });
    }
    const prefill = dmyToISOInput(value);
    if (isoInputToDMY(prefill) !== display) {
      prefillCount += 1;
      if (prefillDrift.length < MAX_SAMPLES) prefillDrift.push({ id: row.id, value, display, prefill });
    }
  }
  return {
    hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displayUnparsed: { count: unparsedCount, samples: displayUnparsed },
    computeDrift: { count: computeCount, samples: computeDrift },
    prefillDrift: { count: prefillCount, samples: prefillDrift },
  };
}

export interface SourceShapes extends ShapeSummary {
  canonicalIso: number;
  canonicalDmy: number;
}

export interface ColumnCensus {
  table: string;
  column: string;
  rawKey: string;
  total: number;
  /** Rows where the TEXT column and raw->>key disagree (after NULL→''). */
  columnRawMismatch: number;
  columnShapes: SourceShapes;
  rawShapes: SourceShapes;
  /** Drift measured on the raw key — the cell the app renders from. */
  rawDrift: DriftSummary;
}

export interface DateShapeCensus {
  readOnly: true;
  generatedAt: string;
  canonical: { iso: string; dmy: string };
  columns: ColumnCensus[];
}

interface TotalsRow {
  total: string;
  col_iso: string;
  col_dmy: string;
  raw_iso: string;
  raw_dmy: string;
  mismatch: string;
}

/** Read-only census: 3 SELECTs per pinned column (totals, non-canonical rows
 *  from the TEXT column, non-canonical rows from the raw key). Table/column
 *  names come from the pinned list above — never from the request. */
export async function loadDateShapeCensus(): Promise<DateShapeCensus> {
  const columns: ColumnCensus[] = [];
  for (const spec of DATE_SHAPE_COLUMNS) {
    const col = spec.column;
    const raw = `raw->>'${spec.rawKey}'`;
    const whereBase = spec.where ? `WHERE ${spec.where}` : '';
    const whereAnd = spec.where ? `WHERE ${spec.where} AND` : 'WHERE';

    const totalsR = await sql.query(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE ${col} ~ $1)::text AS col_iso,
              COUNT(*) FILTER (WHERE ${col} ~ $2)::text AS col_dmy,
              COUNT(*) FILTER (WHERE ${raw} ~ $1)::text AS raw_iso,
              COUNT(*) FILTER (WHERE ${raw} ~ $2)::text AS raw_dmy,
              COUNT(*) FILTER (WHERE COALESCE(${col}, '') <> COALESCE(${raw}, ''))::text AS mismatch
       FROM ${spec.table} ${whereBase}`,
      [PG_ISO, PG_DMY],
    );
    const colR = await sql.query(
      `SELECT id::text AS id, ${col} AS value
       FROM ${spec.table}
       ${whereAnd} (${col} IS NULL OR NOT (${col} ~ $1 OR ${col} ~ $2))
       ORDER BY id DESC`,
      [PG_ISO, PG_DMY],
    );
    const rawR = await sql.query(
      `SELECT id::text AS id, ${raw} AS value
       FROM ${spec.table}
       ${whereAnd} (${raw} IS NULL OR NOT (${raw} ~ $1 OR ${raw} ~ $2))
       ORDER BY id DESC`,
      [PG_ISO, PG_DMY],
    );

    const t = (totalsR.rows[0] ?? {}) as Partial<TotalsRow>;
    const colRows = (colR.rows ?? []) as CensusRow[];
    const rawRows = (rawR.rows ?? []) as CensusRow[];
    columns.push({
      table: spec.table,
      column: col,
      rawKey: spec.rawKey,
      total: Number(t.total ?? 0),
      columnRawMismatch: Number(t.mismatch ?? 0),
      columnShapes: {
        canonicalIso: Number(t.col_iso ?? 0),
        canonicalDmy: Number(t.col_dmy ?? 0),
        ...summariseShapes(colRows),
      },
      rawShapes: {
        canonicalIso: Number(t.raw_iso ?? 0),
        canonicalDmy: Number(t.raw_dmy ?? 0),
        ...summariseShapes(rawRows),
      },
      rawDrift: summariseDrift(rawRows),
    });
  }
  return {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    canonical: { iso: PG_ISO, dmy: PG_DMY },
    columns,
  };
}
