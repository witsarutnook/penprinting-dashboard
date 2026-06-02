import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { loadBoardDelta, BoardDeltaError } from '@/lib/board-delta';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * GET /api/board/delta?since=<iso>
 *
 * Returns board rows changed since the client's cursor.
 *
 * - No `since` param → full snapshot (client bootstrap on first load).
 * - With `since` → only rows where updated_at > since, plus tombstoned job
 *   IDs whose phase2_deleted_at > since.
 *
 * Response shape (BoardDelta):
 *   { jobs: Job[], orders: Order[], deletedJobIds: number[], serverTime: string }
 *
 * `?lists=1` additionally returns `shippedOrderIds` / `cancelledOrderIds`
 * (the /orders list view derives its status badge from them).
 *
 * `?fullLists=1` additionally returns full `shipped[]` / `cancelled[]` rows
 * plus `shippedAllIds` / `cancelledAllIds` (used by /shipped + /cancelled
 * to detect /restore hard-deletes). `fullLists` supersedes `lists`.
 *
 * The client persists `serverTime` and passes it back as `since` on the
 * next call. See lib/board-delta.ts for cursor semantics.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const wantLists = url.searchParams.get('lists') === '1';
  const wantFullLists = url.searchParams.get('fullLists') === '1';
  const sinceParam = url.searchParams.get('since');
  let since: Date | null = null;
  if (sinceParam) {
    const t = new Date(sinceParam);
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: 'invalid `since` param — must be ISO 8601' }, { status: 400 });
    }
    since = t;
  }

  try {
    const delta = await loadBoardDelta(since, { lists: wantLists, fullLists: wantFullLists });
    return NextResponse.json(delta);
  } catch (err) {
    const status = err instanceof BoardDeltaError ? 503 : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status },
    );
  }
}
