import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { createPeakClient } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { bangkokTodayISO } from '@/lib/jobs';
import { addDaysISO } from '@/lib/peak-order/mapper';
import { sql } from '@/lib/postgres';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const NEWEST = 75;
const CONCURRENCY = 3;
const PEAK_BUDGET_MS = 40_000;
const FORM_ROWS = 500;
const TOP = 40;

const TEXT_KEYS = [
  'paperCover', 'paperInner', 'coverColor', 'innerColor', 'coverColorNote', 'innerColorNote', 'qtyUnit',
] as const;
const FLAG_KEYS = [
  'plateOld', 'plateNew', 'copyprint', 'inkjet', 'digital',
  'glue', 'saddle', 'sew', 'spine', 'glueHead', 'glueSide',
  'sewHead', 'sewSide', 'sewCorner', 'sewThread', 'sewSideTape',
  'coatGloss', 'coatMatte', 'coatUV', 'coatSpotUV',
  'stampColor', 'emboss', 'diecut', 'diecutSelf', 'perf', 'runNo',
] as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Contact details have no business in a census of print specs. */
function redact(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/\d{10,}/g, '[number]')
    .replace(/(?:\+66|0)\d(?:[\s-]?\d){7,8}/g, '[phone]');
}

function top(counts: Map<string, number>): Array<[string, number]> {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP);
}
function bump(m: Map<string, number>, k: string): void {
  if (k !== '') m.set(k, (m.get(k) ?? 0) + 1);
}

async function peakSide() {
  const reader = createPeakReader(createPeakClient());
  const dateStart = addDaysISO(bangkokTodayISO(), -30);
  const rows = await reader.newestQuotations({ dateStart }, NEWEST);

  const t0 = Date.now();
  const slots: Array<{ code: string; status: string; lines: Array<{ q: number | null; d: string }> } | null> =
    rows.map(() => null);
  let next = 0;
  let failed = 0;
  let skipped = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      if (Date.now() - t0 > PEAK_BUDGET_MS) {
        skipped++;
        continue;
      }
      try {
        const q = await reader.getQuotation(rows[i].code);
        if (!q) {
          failed++;
          continue;
        }
        slots[i] = {
          code: q.code,
          status: q.status,
          lines: q.lines.map((l) => ({ q: l.quantity, d: redact(l.description) })),
        };
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const quotations = slots.filter((s) => s !== null);
  return {
    ok: true as const,
    dateStart,
    asked: rows.length,
    failed,
    skipped,
    lineCount: quotations.reduce((n, q) => n + q.lines.length, 0),
    quotations,
  };
}

async function formSide() {
  const { rows } = await sql<{ r: unknown }>`
    SELECT raw_data AS r
    FROM orders
    WHERE raw_data IS NOT NULL
      AND status IS DISTINCT FROM 'draft'
      AND raw_data->'peak' IS NULL
      AND COALESCE(raw_data->>'orderType', 'normal') <> 'photobook'
    ORDER BY id DESC
    LIMIT ${FORM_ROWS}
  `;

  const counts: Record<string, Map<string, number>> = { size: new Map(), plateSize: new Map() };
  for (const k of TEXT_KEYS) counts[k] = new Map();
  const flags: Record<string, number> = {};
  for (const k of FLAG_KEYS) flags[k] = 0;
  const paperFields = { coverOnly: 0, innerOnly: 0, both: 0, none: 0 };
  let n = 0;

  for (const row of rows) {
    let r: unknown = row.r;
    if (typeof r === 'string') {
      try {
        r = JSON.parse(r);
      } catch {
        r = null;
      }
    }
    if (!isObj(r)) continue;
    n++;
    const size = text(r.size);
    if (size !== '') bump(counts.size, `${size} [${text(r.sizeUnit)}]`);
    for (const k of TEXT_KEYS) bump(counts[k], text(r[k]));
    if (Array.isArray(r.plateSize)) for (const s of r.plateSize) bump(counts.plateSize, text(s));
    for (const k of FLAG_KEYS) if (r[k] === true) flags[k]++;
    const cover = text(r.paperCover) !== '';
    const inner = text(r.paperInner) !== '';
    if (cover && inner) paperFields.both++;
    else if (cover) paperFields.coverOnly++;
    else if (inner) paperFields.innerOnly++;
    else paperFields.none++;
  }

  const topOut: Record<string, Array<[string, number]>> = {};
  for (const [k, m] of Object.entries(counts)) topOut[k] = top(m);
  return { ok: true as const, rows: n, paperFields, flags, top: topOut };
}

/**
 * TEMPORARY read-only census (PATTERNS §2.5, census variant) — delete this route and
 * tests/peak-line-text-census.test.ts once the rule set for "/order fills the spec
 * fields from the quotation line text" is designed and its coverage is measured.
 *
 * It answers two questions before any rule is written (2026-11-18):
 *  1. peak — how do people actually word a quotation line (size / paper / colours /
 *     coating / binding)? Line text + quantity of the newest quotations.
 *  2. form — which words does the team put in the spec fields of an order today?
 *     Counts and most common values only, over the newest non-draft, non-photobook
 *     orders that did not come from /order.
 *
 * GET only, admin only, no params; reads Peak and the orders table, writes nothing.
 * Never returned: customer names, contact codes, amounts, prices, order notes.
 * Phone numbers, e-mail addresses and long digit runs inside line text are masked.
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const t0 = Date.now();
  const [form, peak] = await Promise.all([
    formSide().catch(() => ({ ok: false as const })),
    peakSide().catch((err: unknown) => ({ ok: false as const, error: peakErrorLabel(err) })),
  ]);
  return NextResponse.json({ form, peak, ms: Date.now() - t0 });
}
