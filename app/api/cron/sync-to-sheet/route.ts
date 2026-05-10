import { NextResponse } from 'next/server';
import { healAllDirtyRows } from '@/lib/sync-to-sheet';

export const maxDuration = 60;

/**
 * Vercel Cron — push Phase 2 dirty rows from Postgres → Sheet.
 *
 * Schedule: every 5 minutes (`*\/5 * * * *`). Phase 2 routes try inline
 * sync first; this cron catches drift from inline failures.
 *
 * Most runs see 0 dirty rows (idle dashboard) and finish in <1s. Worst-
 * case: 50 rows × ~600ms Apps Script setRow = 30s, well under maxDuration=60.
 *
 * Auth: Vercel auto-injects `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await healAllDirtyRows();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
