import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { deleteJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Delete a job — admin only on dashboard v2 (per user preference 2026-05-06).
 * Apps Script `deleteJob` is open to all roles (WP relies on it for drag-drop
 * forward = deleteJob+addJob), but the v2 modal button is locked to admin.
 * Reachable via the /orders data-audit modal.
 *
 * Request body: { id }
 *
 * Phase 2 — when WRITE_DELETE_JOB_TO_POSTGRES=1, Postgres is authoritative.
 * deleteJobInPostgres tombstones the row (phase2_deleted_at); the heal cron's
 * healJobsTombstone pushes deleteJobByIdRow to Sheet, then hard-deletes the
 * Postgres row. Falls through to legacy Apps Script when the row isn't in
 * the Postgres mirror yet (Phase 1.7 straggler).
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  const id = Number(body.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  if (phase2WriteEnabled('deleteJob')) {
    return phase2DeleteJob(id, session.role, session.user);
  }

  try {
    const result = await post<{ ok?: boolean; error?: string }>('deleteJob', { id });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2DeleteJob(id: number, role: string, user: string): Promise<NextResponse> {
  let found = false;
  try {
    const r = await deleteJobInPostgres(id);
    found = r.found;
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Row not in Postgres yet — fall through to legacy Apps Script so the
    // deletion lands on Sheet. The next from-Sheet cron mirrors the change.
    try {
      const result = await post<{ ok?: boolean; error?: string }>('deleteJob', { id });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, fallback: 'apps-script' });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  await appendAuditToPostgres({ action: 'deleteJob', role, user, targetId: id });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
