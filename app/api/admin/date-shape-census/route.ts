import { NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { loadDateShapeCensus } from '@/lib/date-shape-census';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * One-shot, READ-ONLY census of the date-cell shapes in prod (AUDIT-BACKLOG
 * L14, 2026-10-21) — admin only. Decides L13 (route parseDateDMY /
 * dmyToISOInput through the displayDate seam?) and the deferred date Minors
 * with real numbers instead of guesses. Data layer: lib/date-shape-census.ts.
 *
 * ── Usage ──
 *   GET /api/admin/date-shape-census   → the census (dry-run is the ONLY mode)
 *
 * Per pinned column (orders.date_in / orders.date_due / jobs.date /
 * jobs.date_in / shipped.shipped_date): total rows, canonical counts
 * (YYYY-MM-DD, D/M/YYYY), the non-canonical rows bucketed by shape class with
 * ≤5 samples each — for BOTH the TEXT column and the `raw` JSONB key the app
 * renders from (plus the mismatch count between the two) — and, on the raw
 * key, the drift between what the user sees (displayDate) and what the
 * compute path (parseDateDMY) / edit-form prefill (dmyToISOInput) read,
 * measured on this host's TZ (Vercel = UTC).
 *
 * No apply mode, no writes, no request parameters. Retire after the census
 * is recorded in AUDIT-BACKLOG (PATTERNS §2.5).
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }

  const census = await loadDateShapeCensus();
  return NextResponse.json({ mode: 'dryRun', ...census });
}
