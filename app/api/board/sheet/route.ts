import { NextResponse } from 'next/server';
import { loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Bench-only endpoint — returns the raw `jobs[]` payload from a fresh
 * Apps Script `loadAll` (audit=0). Used by /admin/bench-audit's Phase 1.5
 * loadAll-shaped bench so we measure what /board page actually does on a
 * cold ISR rotation: roundtrip + JSON parse + return.
 *
 * Calls `loadAllFresh` (revalidate: 0) so the bench measures real Apps
 * Script latency, not the warm 60s cache that the real /board page uses.
 * Postgres equivalent (`/api/board/postgres`) also bypasses cache for fair
 * comparison.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const t0 = performance.now();
  try {
    const data = await loadAllFresh();
    const ms = Math.round(performance.now() - t0);
    return NextResponse.json({
      jobs: data.jobs,
      count: data.jobs.length,
      sourceMs: ms,
    });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
