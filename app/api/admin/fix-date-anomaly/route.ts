import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import type { Order } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * One-shot fixer for the DATA-dateIn-double-encoded residue
 * (AUDIT-BACKLOG: 3 orders — 202605046 / 202605047 / 202605049).
 *
 * History: Apps Script `objectToRow()` had a missing Date guard until
 * 2026-05-08 — `promoteDraft` + `cancelOrder` read date cells as JS `Date`
 * → fell through catch-all → `JSON.stringify(date)` → quoted ISO string
 * landed in the row's `dateIn` / `dateDue`. Source was patched 2026-05-08;
 * these 3 rows are legacy residue from before that.
 *
 * Display already self-corrects via `displayDate()` (unwraps quotes), so
 * impact is near-zero — this endpoint is the cleanup the AUDIT-BACKLOG
 * note flagged as "Migration note: ตอน Phase 4.2/4.3 cutover ค่อยรัน SQL
 * UPDATE orders SET date_in='2026-05-08' ... 3 แถวทีเดียว". We're now past
 * §12 (Postgres = sole source of truth) so this is the right time.
 *
 * ── Usage ──
 *   GET  /api/admin/fix-date-anomaly                  → dry run, reports before/after
 *   GET  /api/admin/fix-date-anomaly?apply=1          → applies the UPDATE
 *
 * Idempotent: re-running after a successful apply is a no-op (the
 * normalize step recognises already-correct DD/MM/YYYY and emits the
 * same value).
 */

const TARGET_ORDER_IDS = [202605046, 202605047, 202605049] as const;
const FIELDS_TO_NORMALIZE = ['dateIn', 'dateDue'] as const;
type DateField = (typeof FIELDS_TO_NORMALIZE)[number];

/** Normalise one date cell:
 *  - `"\"2026-05-07T17:00:00.000Z\""` → unwrap JSON → ISO → Bangkok DD/MM/YYYY
 *  - `"2026-05-07T17:00:00.000Z"` (raw ISO) → Bangkok DD/MM/YYYY
 *  - `"08/05/2026"` (already correct) → returned as-is
 *  - empty / non-parsable → returned as-is so we never lose data on edge inputs
 */
function normalizeDate(input: unknown): string {
  if (typeof input !== 'string') return String(input ?? '');
  let val = input;
  // Unwrap a JSON-encoded string (the bug pattern). Keep parsing only if
  // the result is itself a string — otherwise the value was something else.
  if (val.startsWith('"') && val.endsWith('"')) {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === 'string') val = parsed;
    } catch {
      // not JSON — leave val alone
    }
  }
  // Already-correct DMY → pass through.
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(val)) return val;
  // ISO-ish? Convert to Bangkok TZ DD/MM/YYYY.
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return input;  // unrecognised — preserve original
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d);
}

interface FieldChange {
  field: DateField;
  before: unknown;
  after: string;
  changed: boolean;
}

interface OrderReport {
  id: number;
  found: boolean;
  fields: FieldChange[];
  changed: boolean;
}

export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing — connect Vercel Postgres via Storage tab + redeploy' },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const apply = url.searchParams.get('apply') === '1';

  // Single SELECT for all 3 — small, no need to parallelise.
  const r = await sql<{ id: string; raw: Order }>`
    SELECT id::text AS id, raw FROM orders
    WHERE id IN (${TARGET_ORDER_IDS[0]}, ${TARGET_ORDER_IDS[1]}, ${TARGET_ORDER_IDS[2]})
    ORDER BY id
  `;
  const byId = new Map<number, Order>();
  for (const row of r.rows) byId.set(Number(row.id), row.raw);

  const reports: OrderReport[] = [];
  for (const id of TARGET_ORDER_IDS) {
    const raw = byId.get(id);
    if (!raw) {
      reports.push({ id, found: false, fields: [], changed: false });
      continue;
    }
    const fields: FieldChange[] = FIELDS_TO_NORMALIZE.map((field) => {
      const before = (raw as unknown as Record<string, unknown>)[field];
      const after = normalizeDate(before);
      return { field, before, after, changed: String(before ?? '') !== after };
    });
    reports.push({
      id,
      found: true,
      fields,
      changed: fields.some((f) => f.changed),
    });
  }

  const changes = reports.filter((r) => r.changed);
  if (!apply) {
    return NextResponse.json({
      mode: 'dryRun',
      hint: 'Add ?apply=1 to commit the UPDATE',
      orders: reports,
      pendingChangeCount: changes.length,
    });
  }

  // Apply mode — one UPDATE per changed order. 3 statements max; not worth
  // wrapping in a transaction (a partial failure would leave 1-2 fixed and
  // the next ?apply=1 run picks the rest up — idempotent).
  const applied: { id: number; updated: { field: string; before: unknown; after: string }[] }[] = [];
  for (const report of changes) {
    const raw = byId.get(report.id)!;
    const nextRaw: Record<string, unknown> = { ...(raw as unknown as Record<string, unknown>) };
    for (const f of report.fields) {
      if (f.changed) nextRaw[f.field] = f.after;
    }
    const dateIn = String(nextRaw.dateIn ?? '');
    const dateDue = String(nextRaw.dateDue ?? '');
    await sql`
      UPDATE orders
      SET raw = ${JSON.stringify(nextRaw)}::jsonb,
          date_in = ${dateIn},
          date_due = ${dateDue}
      WHERE id = ${report.id}
    `;
    applied.push({
      id: report.id,
      updated: report.fields
        .filter((f) => f.changed)
        .map((f) => ({ field: f.field, before: f.before, after: f.after })),
    });
  }

  return NextResponse.json({
    mode: 'apply',
    appliedCount: applied.length,
    applied,
    note: 'Re-run with ?apply=1 to verify idempotency (should return appliedCount: 0).',
  });
}
