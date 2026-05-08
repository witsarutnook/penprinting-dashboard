import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';

/**
 * Promote a draft order into the active queue — admin + sales.
 *
 * A draft is an order with `status: 'draft'` and no Job row yet
 * (saveDraft skipped addJob). Promote validates the order has the full set
 * of required fields, allocates a Job id, calls Apps Script `addJob`, then
 * `updateOrder` to flip status: 'draft' → 'sent'.
 *
 * Request body: { id }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
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

  // Parallelize the snapshot read with the speculative job-id allocation —
  // we need the snapshot anyway to validate, and getNextId is a lock-safe
  // monotonic counter so allocating early just burns one id slot if the
  // promote is rejected (acceptable trade for ~1s perceived latency).
  let snap: Awaited<ReturnType<typeof loadAllFresh>>;
  let speculativeJobId: number | null = null;
  let speculativeJobIdErr: string | null = null;
  try {
    const [snapResult, idResult] = await Promise.all([
      loadAllFresh(),
      post<{ nextId?: number; error?: string }>('getNextId', {}).catch(
        (err): { nextId?: number; error?: string } => ({
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ]);
    snap = snapResult;
    if (idResult.error || !idResult.nextId) {
      speculativeJobIdErr = idResult.error || 'no id returned';
    } else {
      speculativeJobId = Number(idResult.nextId);
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const order = snap.orders.find((o) => Number(o.id) === id);
  if (!order) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }
  const status = String(order.status || '').toLowerCase();
  if (status !== 'draft') {
    return NextResponse.json({ error: `ใบสั่ง #${id} ไม่ใช่แบบร่าง (status=${status})` }, { status: 400 });
  }

  // Validate full required set — same gate as POST /api/orders/add (non-draft path)
  const missing: string[] = [];
  const customer = String(order.customer || '').trim();
  const dateDue = toISODate(order.dateDue);
  const dateIn = toISODate(order.dateIn);
  const orderer = String(order.orderer || '').trim();
  const assignDept = String(order.assignDept || '').trim() as Dept | '';
  const assignStaff = String(order.assignStaff || '').trim();
  if (!customer || customer === '-') missing.push('ชื่อลูกค้า');
  if (!dateDue) missing.push('กำหนดส่ง');
  if (!orderer) missing.push('ผู้สั่งงาน');
  if (!assignDept || !assignStaff) {
    missing.push('ผู้รับงาน (กราฟิก/พิมพ์)');
  } else {
    const valid = STAFF[assignDept as Dept]?.some((s) => s.id === assignStaff);
    if (!valid) missing.push('ผู้รับงาน (ค่าไม่ถูกต้อง)');
  }
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `แบบร่างยังไม่ครบ — ขาด: ${missing.join(', ')}. โปรดแก้ไขใบสั่งก่อน` },
      { status: 400 },
    );
  }

  // Idempotency check (auditor C5): if a job already references this order
  // (e.g. addJob succeeded but updateOrder failed on a previous attempt),
  // reuse its id and SKIP the addJob step. Without this, retrying the
  // promote-draft button would create duplicate jobs.
  const existingJob = snap.jobs.find((j) => Number(j.orderId) === id);
  let jobId: number;
  if (existingJob) {
    jobId = Number(existingJob.id);
  } else {
    // ── Fast path: atomic Apps Script `promoteDraft` (v5.10.4+) ──
    // Single round-trip: allocate jobId + append job + flip order status,
    // all in one LockService scope. No orphan window where addJob succeeds
    // but updateOrder fails. Falls back to legacy 2-call flow below if
    // the action isn't deployed yet.
    try {
      const r = await post<{ ok?: boolean; jobId?: number; orderId?: number; error?: string }>(
        'promoteDraft',
        {
          data: {
            id,
            job: {
              name: order.name,
              date: dateDue,
              dateIn: dateIn || dateDue,
              staff: assignStaff,
              dept: assignDept,
              status: 'pending',
            },
          },
        },
      );
      if (r.ok && r.jobId) {
        return NextResponse.json({ ok: true, jobId: r.jobId, orderId: id });
      }
      // Auditor H2 (2026-05-08): if the atomic action returned ok=true
      // without a jobId, treat that as a server-side regression instead
      // of falling through. Falling through would burn the speculative
      // jobId AGAIN via legacy `addJob` and create a second job for the
      // same order. Apps Script v5.10.4+ always returns jobId on success;
      // a missing jobId means a future Apps Script change skipped the
      // field. Surface the bug rather than silently double-writing.
      if (r.ok && !r.jobId) {
        return NextResponse.json(
          { error: 'promoteDraft return success แต่ไม่มี jobId — Apps Script regression, อย่าใช้งานต่อจนกว่าจะแก้' },
          { status: 502 },
        );
      }
      if (r.error && !/Unknown action/i.test(r.error)) {
        return NextResponse.json({ error: r.error }, { status: 400 });
      }
      // Else fall through to legacy 2-call flow.
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      if (!/Unknown action/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      // Fall through to legacy flow.
    }

    // Legacy multi-call flow — addJob then updateOrder.
    if (speculativeJobIdErr || speculativeJobId == null) {
      return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${speculativeJobIdErr || 'unknown'}` }, { status: 502 });
    }
    jobId = speculativeJobId;

    const jobPayload = {
      id: jobId,
      name: order.name,
      date: dateDue,
      dateIn: dateIn || dateDue,
      staff: assignStaff,
      dept: assignDept,
      status: 'pending',
      orderId: id,
    };
    try {
      const r = await post<{ ok?: boolean; error?: string }>('addJob', { data: jobPayload });
      if (r.error) return NextResponse.json({ error: `addJob failed — ${r.error}` }, { status: 502 });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `addJob failed — ${msg}` }, { status: 502 });
    }
  }

  // Flip order status: draft → sent. Preserve the existing details/rawData snapshot.
  const orderPayload = {
    id,
    name: order.name,
    customer,
    dateIn,
    dateDue,
    price: order.price ?? '',
    assignDept,
    assignStaff,
    orderer,
    status: 'sent',
    details: order.details || {},
    rawData: order.rawData || {},
  };
  try {
    const r = await post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
    if (r.error) {
      return NextResponse.json(
        {
          ok: true, jobId, orderId: id, partial: true,
          warning: `Job #${jobId} สร้างแล้วแต่ปรับสถานะใบสั่งไม่สำเร็จ — ${r.error}`,
        },
        { status: 200 },
      );
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: true, jobId, orderId: id, partial: true,
        warning: `Job #${jobId} สร้างแล้วแต่ปรับสถานะใบสั่งไม่สำเร็จ — ${msg}`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, jobId, orderId: id });
}
