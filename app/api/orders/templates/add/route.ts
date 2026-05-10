import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { addTemplateToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/** Save a new order-form template (preset) — admin + sales.
 *
 *  Phase 2 — when WRITE_TEMPLATES_TO_POSTGRES=1, Postgres is authoritative.
 *  Path: INSERT Postgres (gets the id) → best-effort Apps Script
 *  setTemplateRow to mirror the row into Sheet for admin Sheet UI.
 *  Apps Script failure here is non-fatal — Sheet drifts until cron repairs
 *  (or until next setTemplateRow call retries) — but the Postgres write
 *  has already succeeded so the user sees the template land in /orders/new.
 *
 *  When the flag is off, the legacy Apps Script-first path runs unchanged
 *  (Apps Script mints id + writes Sheet, mirror copies to Postgres). */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: { name?: string; rawData?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'กรุณาระบุชื่อ template' }, { status: 400 });
  if (name.length > 80) {
    return NextResponse.json({ error: 'ชื่อ template ยาวเกินไป (≤80 ตัว)' }, { status: 400 });
  }

  if (phase2WriteEnabled('addTemplate')) {
    return phase2AddTemplate({ name, rawData: body.rawData || {}, createdBy: session.user });
  }

  // Legacy: Apps Script first, mirror copies to Postgres after.
  try {
    const r = await post<{ ok?: boolean; id?: number; error?: string }>('addTemplate', {
      data: { name, rawData: body.rawData || {}, createdBy: session.user },
    });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: r.id });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

interface Phase2Input {
  name: string;
  rawData: Record<string, unknown>;
  createdBy: string;
}

async function phase2AddTemplate(input: Phase2Input): Promise<NextResponse> {
  let id: number;
  try {
    const r = await addTemplateToPostgres(input);
    id = r.id;
  } catch (err) {
    const msg =
      err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Best-effort Sheet sync — Apps Script setTemplateRow upserts by id so
  // a retry on next call self-heals. Errors here are non-fatal: the
  // template is already saved in Postgres (the source of truth) so the
  // user gets a successful response. Drift is logged to Sentry for ops
  // visibility but not surfaced to the user.
  try {
    await post('setTemplateRow', {
      data: {
        id,
        name: input.name,
        rawData: input.rawData,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, {
        tags: { layer: 'phase2-sheet-sync', action: 'setTemplateRow' },
        extra: { templateId: id, name: input.name },
      });
    } catch {
      /* ignore Sentry import failure */
    }
  }

  // Cache bust /orders/new (where the template list shows up). post()
  // would normally do this via PATHS_BY_ACTION, but we bypassed it for
  // the primary write — do it explicitly here.
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/orders/new');
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true, id });
}
