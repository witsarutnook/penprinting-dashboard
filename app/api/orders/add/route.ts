import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate, bangkokTodayISO } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';

/**
 * Create a new order — admin + sales. Accepts the full WP-shape OrderFormData
 * (mirrors gatherFormData() at production-monitoring.js:1595).
 *
 * Server flow:
 *   1. Validate required header fields + assignStaff XOR forwardPrint.
 *   2. Validate photobook items if orderType=photobook.
 *   3. (Unless force) duplicate detection by (name, customer) lowercase.
 *   4. Allocate orderId + jobId, generate PIN.
 *   5. Build order payload — `details` + `rawData` both contain the full
 *      form snapshot (matches WP buildDetails behavior).
 *   6. addOrder → addJob; surface partial-success.
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: Partial<OrderFormData> & { force?: boolean; price?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // ── Header validation ────────────────────────────────────
  const name = String(body.name || '').trim();
  const customer = String(body.customer || '').trim();
  const dateDue = toISODate(body.dateDue);
  const dateIn = toISODate(body.dateIn) || bangkokTodayISO();
  const orderer = String(body.orderer || '').trim();
  const assignStaffInput = String(body.assignStaff || '');
  const forwardPrintInput = String(body.forwardPrint || '');
  const orderType = body.orderType === 'photobook' ? 'photobook' : 'normal';
  const isPB = orderType === 'photobook';

  const errors: string[] = [];
  if (!name) errors.push('กรุณาระบุชื่องาน');
  if (!customer) errors.push('กรุณาระบุชื่อลูกค้า');
  if (!dateDue) errors.push('กรุณาระบุกำหนดส่ง');
  if (!orderer) errors.push('กรุณาระบุผู้สั่งงาน');
  if (!assignStaffInput && !forwardPrintInput) {
    errors.push('กรุณาเลือก มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์ อย่างน้อย 1 อย่าง');
  }
  if (errors.length) return NextResponse.json({ error: errors.join(' • ') }, { status: 400 });

  // Determine actual assignment: graphic if assignStaff set, else print
  let assignDept: Dept;
  let assignStaff: string;
  if (assignStaffInput) {
    assignDept = 'graphic';
    assignStaff = assignStaffInput;
    const valid = STAFF.graphic.some((s) => s.id === assignStaff);
    if (!valid) {
      return NextResponse.json({ error: `กราฟฟิก "${assignStaff}" ไม่ถูกต้อง` }, { status: 400 });
    }
  } else {
    assignDept = 'print';
    assignStaff = forwardPrintInput;
    const valid = STAFF.print.some((s) => s.id === assignStaff);
    if (!valid) {
      return NextResponse.json({ error: `ส่งต่อพิมพ์ "${assignStaff}" ไม่ถูกต้อง` }, { status: 400 });
    }
  }

  // ── Photobook validation ────────────────────────────────
  let photobookItems: PhotobookItem[] = [];
  if (isPB) {
    const v = validatePhotobook(body.photobookItems);
    if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });
    photobookItems = v.cleaned;
  }

  // ── Snapshot for duplicate check + ID allocation ────────
  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  if (!body.force) {
    const nLower = name.toLowerCase();
    const cLower = customer.toLowerCase();
    const dups = snap.orders
      .filter((o) => {
        if (String(o.status || '').toLowerCase() === 'cancelled') return false;
        const oName = String(o.name || '').trim().toLowerCase();
        const oCust = String(o.customer || '').trim().toLowerCase();
        return oName === nLower && oCust === cLower;
      })
      .slice(0, 5)
      .map((o) => ({
        id: Number(o.id),
        name: String(o.name || ''),
        customer: String(o.customer || ''),
        dateIn: String(o.dateIn || ''),
      }));
    if (dups.length > 0) {
      return NextResponse.json(
        {
          error: 'duplicate',
          duplicates: dups,
          message: `พบใบสั่งงานคล้ายกัน ${dups.length} รายการ — ส่ง force=true เพื่อสร้างต่อ`,
        },
        { status: 409 },
      );
    }
  }

  // ── Allocate IDs ─────────────────────────────────────────
  let orderId: number;
  let jobId: number;
  try {
    const orderRes = await post<{ id?: number; error?: string }>('getNextOrderId', {});
    if (orderRes.error || !orderRes.id) {
      return NextResponse.json({ error: `ขอเลขใบสั่งไม่สำเร็จ — ${orderRes.error || 'unknown'}` }, { status: 502 });
    }
    orderId = Number(orderRes.id);

    const jobRes = await post<{ nextId?: number; error?: string }>('getNextId', {});
    if (jobRes.error || !jobRes.nextId) {
      return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${jobRes.error || 'unknown'}` }, { status: 502 });
    }
    jobId = Number(jobRes.nextId);
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  // ── Build payloads ───────────────────────────────────────
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  // Full form snapshot stored under both `details` and `rawData` (matches WP).
  const formSnapshot: Record<string, unknown> = { ...body, pin, orderType };
  if (isPB) formSnapshot.photobook = photobookItems;
  // Drop non-storage fields
  delete formSnapshot.force;

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
    details: formSnapshot,
    rawData: formSnapshot,
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

  // ── Sequenced writes ─────────────────────────────────────
  try {
    const orderResp = await post<{ ok?: boolean; id?: number; error?: string }>('addOrder', { data: orderPayload });
    if (orderResp.error) return NextResponse.json({ error: orderResp.error }, { status: 400 });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `addOrder failed — ${msg}` }, { status: 502 });
  }

  try {
    const jobResp = await post<{ ok?: boolean; id?: number; error?: string }>('addJob', { data: jobPayload });
    if (jobResp.error) {
      return NextResponse.json(
        {
          ok: true, orderId, jobId: null, pin, partial: true,
          warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${jobResp.error}.`,
        },
        { status: 200 },
      );
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: true, orderId, jobId: null, pin, partial: true,
        warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${msg}.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, orderId, jobId, pin, orderType });
}
