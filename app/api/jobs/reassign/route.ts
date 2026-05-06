import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { RESTRICTED_TARGETS } from '@/lib/forward';

/**
 * Reassign a job to a different staff WITHIN THE SAME DEPT — all roles.
 *
 * This is the v2 equivalent of WP `_performJobMove` (drag-drop within dept).
 * On v2 we couldn't reuse `/api/jobs/update` because that route is admin-only;
 * this dedicated endpoint enforces "staff field only, dept unchanged" so we
 * can keep general edit locked while letting staff/sales reassign work.
 *
 * Apps Script `updateJob` is open to all roles — same as WP — so this just
 * proxies through after validating the same-dept constraint.
 *
 * Request body: { id, targetStaff }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: { id?: number | string; targetStaff?: string };
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

  // Need fresh source — staff might have changed in another tab.
  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  const src = snap.jobs.find((j) => Number(j.id) === oldId);
  if (!src) {
    return NextResponse.json({ error: `ไม่พบงาน id=${oldId}` }, { status: 404 });
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
    name: src.name,
    date: toISODate(src.date),
    dateIn: toISODate(src.dateIn),
    dept, // unchanged
    staff: targetStaff,
    status: src.status || 'pending',
    orderId: src.orderId ? Number(src.orderId) : '',
  };
  if (src.cowork !== undefined) payload.cowork = src.cowork;

  try {
    const result = await post<{ ok?: boolean; error?: string }>('updateJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
