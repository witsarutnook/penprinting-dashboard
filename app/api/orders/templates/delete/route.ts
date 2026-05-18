import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { deleteTemplateFromPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/** Delete an order-form template by id — admin + sales.
 *
 *  Phase 2 — when WRITE_TEMPLATES_TO_POSTGRES=1, Postgres is authoritative.
 *  Path: DELETE Postgres → best-effort Apps Script deleteTemplate to drop
 *  the row from Sheet. Apps Script failure is non-fatal — Sheet drifts
 *  until cron sync gates on Postgres ownership and stops re-adding the
 *  row (see lib/sync-from-sheet.ts). */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 });

  if (phase2WriteEnabled('deleteTemplate')) {
    return phase2DeleteTemplate(id);
  }

  // Legacy: Apps Script first, mirror copies the delete to Postgres.
  try {
    const r = await post<{ ok?: boolean; error?: string }>('deleteTemplate', { id });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2DeleteTemplate(id: string): Promise<NextResponse> {
  try {
    await deleteTemplateFromPostgres(id);
  } catch (err) {
    const msg =
      err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Best-effort Sheet sync — Apps Script deleteTemplate removes the row
  // from Sheet. Errors are non-fatal: cron sync skips templates while
  // Postgres owns the table, so a stuck Sheet row doesn't re-resurrect
  // in Postgres.
  try {
    await post('deleteTemplate', { id });
  } catch (err) {
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, {
        tags: { layer: 'phase2-sheet-sync', action: 'deleteTemplate' },
        extra: { templateId: id },
      });
    } catch {
      /* ignore */
    }
  }

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/orders/new');
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true });
}
