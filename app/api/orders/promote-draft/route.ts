import { NextResponse } from 'next/server';
import { loadOrderAndJobs } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';
import { mintJobId } from '@/lib/id-allocation';
import {
  promoteDraftInPostgres,
  appendAuditToPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Promote a draft order into the active queue — admin + sales.
 *
 * A draft is an order with `status='draft'` and no Job row yet.
 * Validates required fields, allocates a job id, then atomically inserts
 * the job + flips status='sent' via promoteDraftInPostgres.
 *
 * Idempotent: if a job already references this order (prior partial
 * success), reuse its id and skip insert.
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

  // Parallel: read order + speculatively mint a job id.
  let snap: Awaited<ReturnType<typeof loadOrderAndJobs>>;
  let speculativeJobId: number | null = null;
  let speculativeJobIdErr: string | null = null;
  try {
    const [snapResult, idResult] = await Promise.all([
      loadOrderAndJobs(id),
      mintJobId().then(
        (n): { id?: number; error?: string } => ({ id: n }),
        (err): { id?: number; error?: string } => ({
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ]);
    snap = snapResult;
    if (idResult.error || !idResult.id) {
      speculativeJobIdErr = idResult.error || 'no id returned';
    } else {
      speculativeJobId = Number(idResult.id);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const order = snap.order;
  if (!order) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }
  const status = String(order.status || '').toLowerCase();
  if (status !== 'draft') {
    return NextResponse.json({ error: `ใบสั่ง #${id} ไม่ใช่แบบร่าง (status=${status})` }, { status: 400 });
  }

  const missing: string[] = [];
  const customer = String(order.customer || '').trim();
  const dateDue = toISODate(String(order.dateDue || ''));
  const dateIn = toISODate(String(order.dateIn || ''));
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
      {
        error: `แบบร่างยังไม่ครบ — ขาด: ${missing.join(', ')}.` +
          ` ⚠️ หากเพิ่งแก้ไขฟอร์ม โปรดกด "บันทึก" ก่อน "ส่งเข้าระบบ"` +
          ` (การกรอกข้อมูลในฟอร์มยังไม่ได้บันทึกจนกว่าจะกดปุ่ม "บันทึก")`,
        missing,
      },
      { status: 400 },
    );
  }

  // Idempotency: if a job already references this order, reuse it.
  const existingJob = snap.jobs[0];
  if (existingJob) {
    return NextResponse.json({ ok: true, jobId: Number(existingJob.id), orderId: id });
  }

  if (speculativeJobIdErr || speculativeJobId == null) {
    return NextResponse.json(
      { error: `ขอ job id ไม่สำเร็จ — ${speculativeJobIdErr || 'unknown'}` },
      { status: 502 },
    );
  }

  try {
    const r = await promoteDraftInPostgres({
      jobId: speculativeJobId,
      orderId: id,
      job: {
        name: String(order.name || ''),
        date: dateDue,
        dateIn: dateIn || dateDue,
        staff: assignStaff,
        dept: assignDept,
      },
    });
    if (!r.found) {
      return NextResponse.json(
        { error: 'ไม่พบใบสั่งงานนี้ในระบบ — refresh หน้าแล้วลองใหม่' },
        { status: 409 },
      );
    }
    await appendAuditToPostgres({
      action: 'promoteDraft',
      role: session.role,
      user: session.user,
      targetId: id,
      summary: `ส่งใบสั่งงาน #${id} เข้าระบบ (job=${r.jobId})`,
    });
    try {
      const { revalidatePath, revalidateTag } = await import('next/cache');
      revalidateTag('load-all');
      revalidatePath('/board');
      revalidatePath('/orders');
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, jobId: r.jobId, orderId: id });
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
