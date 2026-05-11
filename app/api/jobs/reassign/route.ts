import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { RESTRICTED_TARGETS } from '@/lib/forward';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { updateJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Reassign a job to a different staff WITHIN THE SAME DEPT — all roles.
 *
 * v2 equivalent of WP `_performJobMove` (drag-drop within dept). On v2 we
 * couldn't reuse `/api/jobs/update` because that route is admin-only;
 * this dedicated endpoint enforces "staff field only, dept unchanged" so
 * we can keep general edit locked while letting staff/sales reassign work.
 *
 * Strategy: client passes the source snapshot (already on screen), server
 * skips `loadAllFresh()`. Apps Script `updateJob` is open to all roles —
 * same as WP — so this just proxies through after validating the
 * same-dept constraint. Net round-trips: 1 instead of 2.
 *
 * Trust model: client-supplied dept feeds the dept-membership check. If
 * the client lies about dept, the worst case is moving a job to an
 * unintended same-dept staff; the session role + RESTRICTED_TARGETS gate
 * remain server-authoritative. updateJob preserves whatever's already in
 * the row except the fields we send, so cowork stays intact even if the
 * client omits it.
 *
 * Request body: { id, targetStaff, srcJob: { name, dept, staff, date,
 *                  dateIn, status, orderId, cowork? } }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: {
    id?: number | string;
    targetStaff?: string;
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

  const dept = String(src.dept) as Dept;
  if (targetStaff === src.staff) {
    return NextResponse.json({ error: 'ผู้รับงานเดิมแล้ว — ไม่ต้องย้าย' }, { status: 400 });
  }
  const validInDept = STAFF[dept]?.some((s) => s.id === targetStaff);
  if (!validInDept) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${targetStaff}" ไม่อยู่ในแผนก "${dept}"` },
      { status: 400 },
    );
  }
  if (!isAdmin && RESTRICTED_TARGETS.has(targetStaff)) {
    return NextResponse.json({ error: `ปลายทาง "${targetStaff}" สำหรับ admin เท่านั้น` }, { status: 403 });
  }

  // Build the full updateJob payload — preserve EVERYTHING except staff.
  // Cowork passes through unchanged so collaborators stay attached.
  const payload: Record<string, unknown> = {
    id: oldId,
    name: String(src.name || ''),
    date: toISODate(String(src.date || '')),
    dateIn: toISODate(String(src.dateIn || '')),
    dept, // unchanged
    staff: targetStaff,
    status: String(src.status || 'pending'),
    orderId: src.orderId ? Number(src.orderId) : '',
  };
  if (src.cowork !== undefined) payload.cowork = src.cowork;

  // Phase 2 reuse — reassignStaff sends action='updateJob' to Apps Script
  // (constrained to same-dept staff change), so the WRITE_UPDATE_JOB_TO_POSTGRES
  // flag governs this path too. No separate env var needed.
  if (phase2WriteEnabled('updateJob')) {
    return phase2Reassign(oldId, payload, session.role, session.user);
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

async function phase2Reassign(
  id: number,
  payload: Record<string, unknown>,
  role: string,
  user: string,
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
    // Row not in Postgres yet — fall through to legacy Apps Script so
    // the reassignment still lands on Sheet.
    try {
      const result = await post<{ ok?: boolean; error?: string }>('updateJob', { data: payload });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, fallback: 'apps-script' });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
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
    },
  });

  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/board');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
