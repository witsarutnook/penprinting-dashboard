import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { RESTRICTED_TARGETS } from '@/lib/forward';
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
 * Strategy: client passes the source snapshot (already on screen), server
 * skips `loadAllFresh()`. Apps Script `updateJob` is open to all roles —
 * same as WP — so this just proxies through after validating the
 * dept/staff constraint. Net round-trips: 1 instead of 2.
 *
 * Trust model: client-supplied dept feeds the dept-membership check. If
 * the client lies about dept, the worst case is moving a job to an
 * unintended staff; the session role + RESTRICTED_TARGETS gate remain
 * server-authoritative. updateJob preserves whatever's already in the row
 * except the fields we send, so cowork stays intact even if the client
 * omits it.
 *
 * Request body: { id, targetStaff, targetDept?, srcJob: { name, dept,
 *                  staff, date, dateIn, status, orderId, cowork? } }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: {
    id?: number | string;
    targetStaff?: string;
    targetDept?: string;
    srcJob?: {
      name?: string;
      dept?: string;
      staff?: string;
      date?: string;
      dateIn?: string;
      status?: string;
      orderId?: number | string | null;
      cowork?: unknown;
    };
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

  const src = body.srcJob;
  if (!src || !src.dept || !src.staff) {
    return NextResponse.json({ error: 'Missing srcJob (dept/staff required)' }, { status: 400 });
  }

  const srcDept = String(src.dept) as Dept;
  // targetDept defaults to srcDept (same-dept reassign — original behavior).
  const targetDept = (String(body.targetDept || srcDept)) as Dept;

  // No-op guard — must compare BOTH dept and staff (admin cross-dept move
  // back to the same row is still a no-op).
  if (targetDept === srcDept && targetStaff === src.staff) {
    return NextResponse.json({ error: 'ผู้รับงานเดิมแล้ว — ไม่ต้องย้าย' }, { status: 400 });
  }

  // Cross-dept = admin only.
  if (targetDept !== srcDept && !isAdmin) {
    return NextResponse.json(
      { error: 'ย้ายข้ามแผนกสำหรับ admin เท่านั้น' },
      { status: 403 },
    );
  }

  // Validate targetStaff exists in targetDept (catches typos + lying clients).
  const validInDept = STAFF[targetDept]?.some((s) => s.id === targetStaff);
  if (!validInDept) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${targetStaff}" ไม่อยู่ในแผนก "${targetDept}"` },
      { status: 400 },
    );
  }
  if (!isAdmin && RESTRICTED_TARGETS.has(targetStaff)) {
    return NextResponse.json({ error: `ปลายทาง "${targetStaff}" สำหรับ admin เท่านั้น` }, { status: 403 });
  }

  // Build the full updateJob payload — preserve EVERYTHING except dept/staff.
  // Cowork passes through unchanged so collaborators stay attached.
  // dateIn is intentionally preserved on cross-dept reassign too (per
  // 2026-05-14 decision: admin reassign should not bump received date).
  const payload: Record<string, unknown> = {
    id: oldId,
    name: String(src.name || ''),
    date: toISODate(String(src.date || '')),
    dateIn: toISODate(String(src.dateIn || '')),
    dept: targetDept,
    staff: targetStaff,
    status: String(src.status || 'pending'),
    orderId: src.orderId ? Number(src.orderId) : '',
  };
  if (src.cowork !== undefined) payload.cowork = src.cowork;

  // prevDept/prevStaff are passed for audit trail (cross-dept moves visible).
  return reassign(oldId, payload, session.role, session.user, srcDept, src.staff);
}

async function reassign(
  id: number,
  payload: Record<string, unknown>,
  role: string,
  user: string,
  prevDept: string,
  prevStaff: string,
): Promise<NextResponse> {
  let found = false;
  try {
    const r = await updateJobInPostgres({
      id,
      name: String(payload.name || ''),
      date: (payload.date as string) ?? null,
      dateIn: (payload.dateIn as string) ?? null,
      dept: String(payload.dept || ''),
      staff: String(payload.staff || ''),
      status: String(payload.status || 'pending'),
      orderId: payload.orderId as string | number | null,
      cowork: payload.cowork,
    });
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

  await appendAuditToPostgres({
    action: 'updateJob',
    role,
    user,
    targetId: id,
    data: {
      name: String(payload.name || ''),
      dept: String(payload.dept || ''),
      staff: String(payload.staff || ''),
      prevDept,
      prevStaff,
    },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
