import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate, validateJobInput, type JobPayload } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { updateJobInPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Update an existing job — admin only on dashboard v2 (per user preference 2026-05-06).
 * Staff/sales can still reassign via WP drag-drop; here in v2 the modal route is locked.
 *
 * Request body: { id, name, date, dateIn?, dept, staff, orderId?, status?, cowork? }
 * → Apps Script payload = full JOBS_HEADERS row (id required, status defaults preserved)
 *
 * Phase 2 — when WRITE_UPDATE_JOB_TO_POSTGRES=1, Postgres is authoritative.
 * UPDATE goes to Postgres + marks phase2_dirty_at; the heal cron pushes to
 * Sheet via setJobRow within 5 min. Mirrors the setCowork Phase 2 pattern:
 * /board reads from Postgres so the card moves columns instantly when
 * dept/staff change without waiting for Apps Script. Falls through to
 * legacy when the row isn't in Postgres yet (Phase 1.7 stragglers).
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: {
    id?: number | string;
    name?: string;
    date?: string;
    dateIn?: string;
    dept?: string;
    staff?: string;
    orderId?: string | number;
    status?: string;
    cowork?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });

  const v = validateJobInput(body);
  if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });

  const dept = body.dept as Dept;
  const staffId = String(body.staff);
  const validStaff = STAFF[dept]?.some((s) => s.id === staffId);
  if (!validStaff) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${staffId}" ไม่ตรงกับแผนก "${dept}"` },
      { status: 400 },
    );
  }

  const payload: JobPayload = {
    id,
    name: String(body.name).trim(),
    date: toISODate(body.date),
    dateIn: toISODate(body.dateIn),
    dept,
    staff: staffId,
    status: String(body.status || 'pending'),
    orderId: body.orderId ? Number(body.orderId) : '',
  };

  // Pass through cowork unchanged — the form doesn't edit it (Phase 3.5.7),
  // but we don't want updateJob to wipe an existing assignment.
  if (body.cowork !== undefined) payload.cowork = body.cowork;

  if (phase2WriteEnabled('updateJob')) {
    return phase2UpdateJob(id, payload);
  }

  try {
    const result = await post<{ ok?: boolean; error?: string }>('updateJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2UpdateJob(id: number, payload: JobPayload): Promise<NextResponse> {
  let found = false;
  try {
    const r = await updateJobInPostgres({
      id,
      name: payload.name,
      date: payload.date ?? null,
      dateIn: payload.dateIn ?? null,
      dept: payload.dept,
      staff: payload.staff,
      status: payload.status,
      orderId: payload.orderId,
      cowork: payload.cowork,
    });
    found = r.found;
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Row not in Postgres yet — fall through to legacy Apps Script so the
    // user's edit lands on Sheet. The next from-Sheet cron will pick it up
    // into Postgres so the next edit lands in the Phase 2 path.
    try {
      const result = await post<{ ok?: boolean; error?: string }>('updateJob', { data: payload });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, fallback: 'apps-script' });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // Postgres write succeeded — heal cron pushes to Sheet within 5 min.
  // Bust /board + /orders caches so the next render sees the new row.
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
