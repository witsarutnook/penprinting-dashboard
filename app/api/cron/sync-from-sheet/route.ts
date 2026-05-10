import { NextResponse } from 'next/server';
import { syncAllFromSheet } from '@/lib/sync-from-sheet';

export const maxDuration = 60;

/**
 * Vercel Cron — full re-sync Sheet → Postgres.
 *
 * Schedule: every 10 minutes (`*\/10 * * * *`). At ~6s per run, this is
 * 1% of compute time and well under any quota. Postgres staleness is
 * therefore ≤10 min — acceptable for the dashboard's read use cases
 * (Kanban + analytics aren't real-time-critical; LINE webhook bypasses
 * Postgres anyway).
 *
 * Uses TRUNCATE + bulk INSERT so partial-run state is always clean (a
 * crash mid-sync leaves the previous successful sync's data intact for
 * the prior tables that already finished, and the failed table's
 * `sync_meta.ok = false` so reads can detect staleness).
 *
 * Auth: Vercel auto-injects `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await syncAllFromSheet();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
