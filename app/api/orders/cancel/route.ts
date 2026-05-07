import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/**
 * Soft-cancel an order — admin only. Replacement for the previous hard-
 * delete UX (user feedback 2026-05-07: "เอาเป็นแค่ ยกเลิกพอ"). The
 * order row stays in the orders sheet with status='cancelled' so the
 * audit trail + customer history are preserved; the orders list shows
 * it under the red ยกเลิก badge.
 *
 * Cascade: any active job(s) referencing this order get cancelled with
 * reason "ใบสั่งงาน #<id> ถูกยกเลิก". Same cascade pattern as the old
 * delete route — kept verbatim so we don't leave orphan Kanban cards
 * pointing at a now-cancelled order.
 *
 * Body: { id }
 * Returns: { ok, cancelledJobs: [jobIds] } on success
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const existing = snap.orders.find((o) => Number(o.id) === id);
  if (!existing) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }
  const currentStatus = String(existing.status || '').toLowerCase();
  if (currentStatus === 'cancelled') {
    return NextResponse.json({ error: `ใบสั่งงาน #${id} ถูกยกเลิกอยู่แล้ว` }, { status: 400 });
  }

  // Step 1: cascade-cancel attached jobs IN PARALLEL.
  // Apps Script handles each cancelJob as an independent Sheet write
  // protected by its own LockService, so firing them concurrently is
  // safe — collapses N sequential round-trips (each ~600ms) into the
  // time of the slowest one. Big win for orders with multiple cowork-
  // attached jobs.
  const attachedJobs = snap.jobs
    .filter((j) => Number(j.orderId) === id)
    .map((j) => ({
      id: Number(j.id),
      dept: String(j.dept || ''),
      staff: String(j.staff || ''),
      name: String(j.name || ''),
    }));

  const cancelOutcomes = await Promise.allSettled(
    attachedJobs.map((j) =>
      post<{ ok?: boolean; error?: string }>('cancelJob', {
        data: {
          id: j.id,
          name: j.name,
          dept: j.dept,
          staff: j.staff,
          orderId: id,
          reason: `ใบสั่งงาน #${id} ถูกยกเลิก (cascade)`,
          cancelledBy: `${session.role}:${session.user}`,
          cancelledAt: new Date().toISOString(),
        },
      }),
    ),
  );

  const cancelledIds: number[] = [];
  const cancelFailed: Array<{ id: number; error: string }> = [];
  cancelOutcomes.forEach((outcome, idx) => {
    const j = attachedJobs[idx];
    if (outcome.status === 'rejected') {
      const reason = outcome.reason;
      const msg = reason instanceof AppsScriptError ? reason.message
        : reason instanceof Error ? reason.message : String(reason);
      cancelFailed.push({ id: j.id, error: msg });
    } else if (outcome.value.error) {
      cancelFailed.push({ id: j.id, error: outcome.value.error });
    } else {
      cancelledIds.push(j.id);
    }
  });

  // Bail if any cascade failed — leaving an order at cancelled while jobs
  // still reference it active would split the Kanban from the orders list.
  if (cancelFailed.length > 0) {
    return NextResponse.json(
      {
        error: `ยกเลิก Job ที่ผูกอยู่ไม่สำเร็จ ${cancelFailed.length} งาน — ` +
          `ไม่ได้ยกเลิกใบสั่ง #${id} เพื่อกันข้อมูลไม่สอดคล้อง. ` +
          `Job ที่ค้าง: ${cancelFailed.map((f) => f.id).join(', ')}`,
        cancelFailed,
        cancelledIds,
      },
      { status: 502 },
    );
  }

  // Step 2: flip the order's status to cancelled (preserve every other field).
  const orderPayload = {
    id,
    name: String(existing.name || ''),
    customer: String(existing.customer || ''),
    dateIn: String(existing.dateIn || ''),
    dateDue: String(existing.dateDue || ''),
    price: existing.price ?? '',
    assignDept: String(existing.assignDept || ''),
    assignStaff: String(existing.assignStaff || ''),
    orderer: String(existing.orderer || ''),
    status: 'cancelled',
    details: existing.details ?? {},
    rawData: existing.rawData ?? {},
  };
  try {
    const r = await post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
    if (r.error) {
      return NextResponse.json({
        error: r.error,
        warning: cancelledIds.length > 0
          ? `ยกเลิก Job ${cancelledIds.length} งานสำเร็จแล้วแต่ปรับสถานะใบสั่งไม่สำเร็จ — โปรดเปลี่ยน status ของ #${id} เป็น "cancelled" ด้วยมือใน Sheet`
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
