import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { validateReassign } from '@/lib/forward';
import { loadJobDeptStaffFromPostgres } from '@/lib/api-postgres';
import { updateJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Reassign a job to a different staff — same-dept for all roles, cross-dept
 * for admin only.
 *
 * v2 equivalent of WP `_performJobMove` (drag-drop within dept). On v2 we
 * couldn't reuse `/api/jobs/update` because that route is admin-only;
 * this dedicated endpoint enforces "staff field only" for non-admin so
 * we can keep general edit locked while letting staff/sales reassign work.
 *
 * Cross-dept extension (2026-05-14): admin can pass `targetDept` to move a
 * job across depts (e.g. fix a wrong forward by moving post:bind back to
 * print:sm74). Wrong-direction moves are intentionally allowed because the
 * primary use case is correcting mistakes. `dateIn` is preserved (not
 * bumped) — admin reassign keeps the original received date.
 *
 * Trust model (M-reassign-client-dept-trust, audit 2026-07-21): the job's
 * current dept/staff are read from Postgres and feed every guard — a lying
 * client can no longer make a cross-dept move look same-dept, and the audit
 * trail records the real prevDept/prevStaff. The update sends ONLY
 * dept/staff; `updateJobInPostgres` merges over the stored raw snapshot so
 * name/dates/status/orderId/cowork are preserved server-side (this also
 * closes the older hole where reassign's payload let non-admin rewrite
 * fields that /api/jobs/update locks behind admin). Cost: 1 extra read
 * (~15ms) — the price of not trusting the client.
 *
 * Request body: { id, targetStaff, targetDept? } — legacy clients still
 * send `srcJob`; it is accepted and ignored.
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: {
    id?: number | string;
    targetStaff?: string;
    targetDept?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const oldId = Number(body.id);
  if (!oldId || !Number.isFinite(oldId)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }
  const targetStaff = String(body.targetStaff || '');
  if (!targetStaff) return NextResponse.json({ error: 'Missing targetStaff' }, { status: 400 });

  // Server-authoritative source position — live rows only (tombstoned =
  // already forwarded/shipped/cancelled → same 409 as the update path).
  let real: { dept: string; staff: string; name: string } | null;
  try {
    real = await loadJobDeptStaffFromPostgres(oldId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!real) {
    return NextResponse.json(
      { error: 'งานนี้ไม่อยู่ในระบบแล้ว — refresh หน้าแล้วลองใหม่' },
      { status: 409 },
    );
  }

  // targetDept defaults to the real dept (same-dept reassign — original behavior).
  const targetDept = String(body.targetDept || real.dept);

  const invalid = validateReassign({
    realDept: real.dept,
    realStaff: real.staff,
    targetDept,
    targetStaff,
    isAdmin,
  });
  if (invalid) {
    return NextResponse.json({ error: invalid.error }, { status: invalid.status });
  }

  let found = false;
  try {
    // Only dept/staff change — updateJobInPostgres merges over the stored
    // raw snapshot, so every other field is preserved server-side.
    const r = await updateJobInPostgres({ id: oldId, dept: targetDept, staff: targetStaff });
    found = r.found;
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Phase 4.2 close-out — no Apps Script fallback (Sheet-only write would
    // never reach Postgres = silent data loss). 409 → client refreshes.
    return NextResponse.json(
      { error: 'งานนี้ไม่อยู่ในระบบแล้ว — refresh หน้าแล้วลองใหม่' },
      { status: 409 },
    );
  }

  // prevDept/prevStaff from the server read — cross-dept moves visible in audit.
  await appendAuditToPostgres({
    action: 'updateJob',
    role: session.role,
    user: session.user,
    targetId: oldId,
    data: {
      name: real.name,
      dept: targetDept,
      staff: targetStaff,
      prevDept: real.dept,
      prevStaff: real.staff,
    },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
