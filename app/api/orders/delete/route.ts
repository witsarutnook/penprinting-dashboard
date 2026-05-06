import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/** Permanently delete an order — admin only.
 *  Cascade: any active job(s) referencing this order are auto-cancelled
 *  with reason "ใบสั่งงานถูกลบ" so the Kanban doesn't end up with orphan
 *  cards (monitoring.md §8 recurring failure mode).
 *
 *  Behaviour:
 *  - body.cascade=false → behave as before (just delete the order row).
 *  - default (cascade=true) → cancel attached jobs first, then delete.
 *
 *  Mirrors WP `apiPost('deleteOrder', { id })` + adds the cascade step. */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string; cascade?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }
  const cascade = body.cascade !== false; // default true

  // Find attached jobs (if cascading)
  let attachedJobs: Array<{ id: number; dept: string; staff: string; name: string }> = [];
  if (cascade) {
    let snap;
    try {
      snap = await loadAllFresh();
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
    attachedJobs = snap.jobs
      .filter((j) => Number(j.orderId) === id)
      .map((j) => ({
        id: Number(j.id),
        dept: String(j.dept || ''),
        staff: String(j.staff || ''),
        name: String(j.name || ''),
      }));
  }

  // Step 1: cascade-cancel each attached job
  const cancelledIds: number[] = [];
  const cancelFailed: Array<{ id: number; error: string }> = [];
  for (const j of attachedJobs) {
    try {
      const r = await post<{ ok?: boolean; error?: string }>('cancelJob', {
        data: {
          id: j.id,
          name: j.name,
          dept: j.dept,
          staff: j.staff,
          orderId: id,
          reason: `ใบสั่งงาน #${id} ถูกลบ (cascade)`,
          cancelledBy: `${session.role}:${session.user}`,
          cancelledAt: new Date().toISOString(),
        },
      });
      if (r.error) cancelFailed.push({ id: j.id, error: r.error });
      else cancelledIds.push(j.id);
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      cancelFailed.push({ id: j.id, error: msg });
    }
  }

  // If any cascade-cancel failed, abort the order delete to avoid an
  // inconsistent state (jobs left referencing a missing order).
  if (cancelFailed.length > 0) {
    return NextResponse.json(
      {
        error: `ยกเลิก Job ที่ผูกอยู่ไม่สำเร็จ ${cancelFailed.length} งาน — ` +
          `ไม่ได้ลบใบสั่ง #${id} เพื่อกันข้อมูลไม่สอดคล้อง. ` +
          `Job ที่ค้าง: ${cancelFailed.map((f) => f.id).join(', ')}`,
        cancelFailed,
        cancelledIds,
      },
      { status: 502 },
    );
  }

  // Step 2: delete the order row
  try {
    const r = await post<{ ok?: boolean; error?: string }>('deleteOrder', { id });
    if (r.error) {
      return NextResponse.json({
        error: r.error,
        warning: cancelledIds.length > 0
          ? `ยกเลิก Job ${cancelledIds.length} งานสำเร็จแล้วแต่ลบใบสั่งไม่สำเร็จ — โปรดลบ #${id} ด้วยมือใน Sheet`
          : undefined,
        cancelledIds,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, cancelledJobs: cancelledIds });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, cancelledIds }, { status: 502 });
  }
}
