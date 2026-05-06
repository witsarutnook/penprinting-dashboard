import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate, bangkokTodayISO } from '@/lib/jobs';

/**
 * Create a new order — admin + sales (matches WP `PERM.canCreate`).
 *
 * MVP scope (Phase 3.5.5 iteration 1): standard orders only — no Photobook
 * tab + repeater (deferred), no template loading (deferred), no
 * duplicate-order detection (deferred — admin can spot duplicates in WP if
 * needed).
 *
 * Server flow (mirrors WP submitOrder, production-monitoring.js:1740):
 *   1. Validate header fields + assignDept/assignStaff combo.
 *   2. Allocate orderId via Apps Script `getNextOrderId` (atomic per-month counter).
 *   3. Allocate jobId via `getNextId` (sequential job counter).
 *   4. Generate 4-digit PIN for the public tracking page.
 *   5. POST `addOrder` with the full ORDERS_HEADERS payload.
 *   6. POST `addJob` to create the initial workflow card.
 *   7. Return both IDs + the PIN so the UI can show a success toast.
 *
 * If addOrder fails → caller sees an error and nothing is written.
 * If addJob fails after addOrder succeeded → return a partial-success
 * response so the UI can guide the admin to the orphan-recovery flow.
 *
 * Request body: { name, customer, dateIn?, dateDue, price?, orderer,
 *                 assignDept, assignStaff, details? }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: {
    name?: string;
    customer?: string;
    dateIn?: string;
    dateDue?: string;
    price?: string | number;
    orderer?: string;
    assignDept?: string;
    assignStaff?: string;
    details?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Validation ────────────────────────────────────────────
  const name = (body.name || '').trim();
  const customer = (body.customer || '').trim();
  const dateDue = toISODate(body.dateDue);
  const dateIn = toISODate(body.dateIn) || bangkokTodayISO();
  const orderer = (body.orderer || '').trim();
  const assignDept = String(body.assignDept || '');
  const assignStaff = String(body.assignStaff || '');
  const errors: string[] = [];
  if (!name) errors.push('กรุณาระบุชื่องาน');
  if (!customer) errors.push('กรุณาระบุชื่อลูกค้า');
  if (!dateDue) errors.push('กรุณาระบุกำหนดส่ง');
  if (!orderer) errors.push('กรุณาระบุผู้สั่งงาน');
  if (!assignDept) errors.push('กรุณาเลือกแผนก');
  if (!assignStaff) errors.push('กรุณาเลือกผู้รับงาน');
  if (errors.length) return NextResponse.json({ error: errors.join(' • ') }, { status: 400 });

  const validStaff = STAFF[assignDept as Dept]?.some((s) => s.id === assignStaff);
  if (!validStaff) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${assignStaff}" ไม่ตรงกับแผนก "${assignDept}"` },
      { status: 400 },
    );
  }

  // ── Allocate IDs ─────────────────────────────────────────
  let orderId: number;
  let jobId: number;
  try {
    const orderRes = await post<{ id?: number; error?: string }>('getNextOrderId', {});
    if (orderRes.error || !orderRes.id) {
      return NextResponse.json(
        { error: `ขอเลขใบสั่งไม่สำเร็จ — ${orderRes.error || 'unknown'}` },
        { status: 502 },
      );
    }
    orderId = Number(orderRes.id);

    const jobRes = await post<{ nextId?: number; error?: string }>('getNextId', {});
    if (jobRes.error || !jobRes.nextId) {
      return NextResponse.json(
        { error: `ขอ job id ไม่สำเร็จ — ${jobRes.error || 'unknown'}` },
        { status: 502 },
      );
    }
    jobId = Number(jobRes.nextId);
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── Build payloads ───────────────────────────────────────
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  const details = (body.details && typeof body.details === 'object') ? body.details : {};
  const fullDetails = { ...details, pin };

  const orderPayload = {
    id: orderId,
    name,
    customer,
    dateIn,
    dateDue,
    price: body.price ?? '',
    assignDept,
    assignStaff,
    orderer,
    status: 'sent',
    details: fullDetails,
    rawData: { ...body, pin },
  };

  const jobPayload = {
    id: jobId,
    name,
    date: dateDue,
    dateIn,
    staff: assignStaff,
    dept: assignDept,
    status: 'pending',
    orderId,
  };

  // ── Sequenced writes — mirror WP rollback semantics ──────
  try {
    const orderResp = await post<{ ok?: boolean; id?: number; error?: string }>('addOrder', { data: orderPayload });
    if (orderResp.error) return NextResponse.json({ error: orderResp.error }, { status: 400 });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `addOrder failed — ${msg}` }, { status: 502 });
  }

  // Order saved. Job creation is best-effort — surface partial failure.
  try {
    const jobResp = await post<{ ok?: boolean; id?: number; error?: string }>('addJob', { data: jobPayload });
    if (jobResp.error) {
      return NextResponse.json(
        {
          ok: true,
          orderId,
          jobId: null,
          pin,
          partial: true,
          warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${jobResp.error}. ใช้ปุ่ม "สร้างงานใหม่" ในระบบ WP เพื่อ recover.`,
        },
        { status: 200 },
      );
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: true,
        orderId,
        jobId: null,
        pin,
        partial: true,
        warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${msg}. ใช้ปุ่ม "สร้างงานใหม่" ในระบบ WP เพื่อ recover.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, orderId, jobId, pin });
}
