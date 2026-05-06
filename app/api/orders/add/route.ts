import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate, bangkokTodayISO } from '@/lib/jobs';
import { validatePhotobook, type PhotobookItem } from '@/lib/photobook';

/**
 * Create a new order — admin + sales.
 *
 * Phase 3.5.5b additions:
 *   - Photobook mode (`orderType: 'photobook'`) — validates `photobookItems`
 *     and stores them under `details.photobook` matching WP shape.
 *   - Duplicate detection — if a non-cancelled order with the same
 *     case-insensitive (name, customer) combo exists, return 409 with
 *     `duplicates[]`. Caller can resubmit with `force: true` to override.
 *
 * Server flow:
 *   1. Validate header + dept/staff combo + photobook items if photobook.
 *   2. (Unless force) Fetch loadAllFresh, scan orders for duplicate combo.
 *   3. Allocate orderId + jobId, generate PIN.
 *   4. addOrder → addJob (with partial-success surfacing).
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
    notes?: string;
    orderType?: 'normal' | 'photobook';
    photobookItems?: PhotobookItem[];
    force?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const orderType = body.orderType === 'photobook' ? 'photobook' : 'normal';
  const isPB = orderType === 'photobook';

  // ── Header validation ────────────────────────────────────
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

  // Duplicate detection — case-insensitive (name, customer) combo on
  // non-cancelled orders. Mirrors WP findDuplicateOrders (line 1849).
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
  const details: Record<string, unknown> = { pin };
  if (body.notes) details.notes = body.notes;
  if (isPB) details.photobook = photobookItems;

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
    details,
    rawData: { ...body, orderType, pin },
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
          ok: true,
          orderId,
          jobId: null,
          pin,
          partial: true,
          warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${jobResp.error}.`,
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
        warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${msg}.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, orderId, jobId, pin, orderType });
}
