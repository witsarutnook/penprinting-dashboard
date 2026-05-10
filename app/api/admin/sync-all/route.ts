import { NextResponse } from 'next/server';
import { syncAllFromSheet } from '@/lib/sync-from-sheet';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 60;

/**
 * Manual full re-sync — admin only.
 * Same logic as the cron entry (`/api/cron/sync-from-sheet`) but gated by
 * session cookie so an admin can trigger a fresh sync on demand (e.g.
 * after a Sheet edit they want reflected immediately, or for first-time
 * seed of a fresh Postgres DB).
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const result = await syncAllFromSheet();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
