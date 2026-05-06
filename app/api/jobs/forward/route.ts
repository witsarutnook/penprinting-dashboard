import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { validateForwardTarget } from '@/lib/forward';

/**
 * Forward (ส่งต่องาน) — all roles can forward (matches WP `canWorkflow` = true).
 * RESTRICTED_TARGETS (outsource, diecut_out) are admin only — gated by
 * `validateForwardTarget`.
 *
 * Strategy: call Apps Script `bulkForward` with items=[{oldId, newJob}] so the
 * delete+add happens in one LockService call (atomic). This avoids the WP-era
 * orphan-job class of bugs from sequential `deleteJob` + `addJob` (see
 * monitoring.md §8 "Forward duplicate cards" v5.6.2).
 *
 * Request body: { id, targetDept, targetStaff }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: { id?: number | string; targetDept?: string; targetStaff?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const oldId = Number(body.id);
  if (!oldId || !Number.isFinite(oldId)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }
  const targetDept = String(body.targetDept || '');
  const targetStaff = String(body.targetStaff || '');
  if (!targetDept || !targetStaff) {
    return NextResponse.json({ error: 'Missing target dept/staff' }, { status: 400 });
  }

  // Fetch fresh snapshot — need source job + nextId allocation.
  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const src = snap.jobs.find((j) => Number(j.id) === oldId);
  if (!src) {
    return NextResponse.json({ error: `ไม่พบงาน id=${oldId} (อาจถูกลบ/ส่งต่อโดยคนอื่นแล้ว)` }, { status: 404 });
  }

  const validationErr = validateForwardTarget(
    String(src.dept),
    String(src.staff),
    targetDept,
    targetStaff,
    isAdmin,
  );
  if (validationErr) return NextResponse.json({ error: validationErr }, { status: 400 });

  // Atomically allocate the next job id from Apps Script (LockService inside
  // getNextId) — never trust the cached snap.nextId because two concurrent
  // forwards would collide on the same id. Reported by auditor C1 (2026-05-06).
  let nextId: number;
  try {
    const r = await post<{ nextId?: number; error?: string }>('getNextId', {});
    if (r.error || !r.nextId) {
      return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${r.error || 'unknown'}` }, { status: 502 });
    }
    nextId = Number(r.nextId);
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${msg}` }, { status: 502 });
  }

  const newJob = {
    id: nextId,
    name: src.name,
    date: toISODate(src.date),
    dateIn: toISODate(src.dateIn),
    staff: targetStaff,
    dept: targetDept,
    status: 'pending',
    orderId: src.orderId ? Number(src.orderId) : '',
    // Cowork is intentionally cleared on forward — matches WP behavior
    // (submitForward at production-monitoring.js:1267 omits cowork).
  };

  try {
    const result = await post<{
      ok?: boolean;
      processed?: number;
      failed?: Array<{ oldId?: number; name?: string; error?: string }>;
      error?: string;
    }>('bulkForward', { data: { items: [{ oldId, newJob }] } });

    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    if (result.failed && result.failed.length > 0) {
      const f = result.failed[0];
      return NextResponse.json(
        { error: f.error || `ส่งต่อไม่สำเร็จ (id=${f.oldId})` },
        { status: 502 },
      );
    }
    if (!result.processed) {
      return NextResponse.json({ error: 'ส่งต่อไม่สำเร็จ — Apps Script ตอบ processed=0' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, newId: nextId });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
