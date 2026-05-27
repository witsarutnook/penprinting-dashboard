import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { toISODate, validateJobInput, type JobPayload } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { updateJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Update an existing job — admin only on dashboard v2.
 *
 * Request body: { id, name, date, dateIn?, dept, staff, orderId?, status?, cowork? }
 * Writes directly to Postgres; /board reads from Postgres so the card moves
 * columns instantly when dept/staff change.
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

  return updateJob(id, payload, session.role, session.user);
}

async function updateJob(id: number, payload: JobPayload, role: string, user: string): Promise<NextResponse> {
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
    return NextResponse.json(
      { error: 'งานนี้ไม่อยู่ในระบบแล้ว — refresh หน้าแล้วลองใหม่' },
      { status: 409 },
    );
  }

  // Bust /board + /orders caches so the next render sees the new row.
  await appendAuditToPostgres({
    action: 'updateJob',
    role,
    user,
    targetId: id,
    data: {
      name: payload.name,
      dept: payload.dept,
      staff: payload.staff,
    },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
