import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate, validateJobInput, type JobPayload } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';

export const maxDuration = 30;

/**
 * Update an existing job — admin only on dashboard v2 (per user preference 2026-05-06).
 * Staff/sales can still reassign via WP drag-drop; here in v2 the modal route is locked.
 *
 * Request body: { id, name, date, dateIn?, dept, staff, orderId?, status?, cowork? }
 * → Apps Script payload = full JOBS_HEADERS row (id required, status defaults preserved)
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

  try {
    const result = await post<{ ok?: boolean; error?: string }>('updateJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
