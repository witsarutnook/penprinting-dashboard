import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';
import type { Job } from '@/lib/types';

/** Update an existing order — admin + sales. Mirrors the add route's full
 *  WP-shape OrderFormData input. Preserves PIN, cascades name/dateDue
 *  changes to matching jobs. */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: Partial<OrderFormData> & { id?: number | string; price?: string | number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  const orderType = body.orderType === 'photobook' ? 'photobook' : 'normal';
  const isPB = orderType === 'photobook';
  const name = String(body.name || '').trim();
  const customer = String(body.customer || '').trim();
  const dateDue = toISODate(body.dateDue);
  const dateIn = toISODate(body.dateIn);
  const orderer = String(body.orderer || '').trim();
  const assignStaffInput = String(body.assignStaff || '');
  const forwardPrintInput = String(body.forwardPrint || '');

  const errors: string[] = [];
  if (!name) errors.push('กรุณาระบุชื่องาน');
  if (!customer) errors.push('กรุณาระบุชื่อลูกค้า');
  if (!dateDue) errors.push('กรุณาระบุกำหนดส่ง');
  if (!orderer) errors.push('กรุณาระบุผู้สั่งงาน');
  if (!assignStaffInput && !forwardPrintInput) {
    errors.push('กรุณาเลือก มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์ อย่างน้อย 1 อย่าง');
  }
  if (errors.length) return NextResponse.json({ error: errors.join(' • ') }, { status: 400 });

  let assignDept: Dept;
  let assignStaff: string;
  if (assignStaffInput) {
    assignDept = 'graphic';
    assignStaff = assignStaffInput;
  } else {
    assignDept = 'print';
    assignStaff = forwardPrintInput;
  }

  let photobookItems: PhotobookItem[] = [];
  if (isPB) {
    const v = validatePhotobook(body.photobookItems);
    if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });
    photobookItems = v.cleaned;
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

  const existingRaw = (existing.rawData && typeof existing.rawData === 'object'
    ? existing.rawData
    : {}) as Record<string, unknown>;
  const existingDetails = (existing.details && typeof existing.details === 'object'
    ? existing.details
    : {}) as Record<string, unknown>;
  const pin = String(existingRaw.pin || existingDetails.pin || '');

  const formSnapshot: Record<string, unknown> = { ...body, pin, orderType };
  // Same dedupe as add — keep only `photobook` field (auditor M14)
  if (isPB) formSnapshot.photobook = photobookItems;
  delete formSnapshot.photobookItems;
  delete formSnapshot.id;

  const orderPayload = {
    id,
    name,
    customer,
    dateIn: dateIn || String(existing.dateIn || ''),
    dateDue,
    price: body.price ?? existing.price ?? '',
    assignDept,
    assignStaff,
    orderer,
    status: existing.status || 'sent',
    details: formSnapshot,
    rawData: formSnapshot,
  };

  try {
    const r = await post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `updateOrder failed — ${msg}` }, { status: 502 });
  }

  // Cascade rename to matching jobs
  const oldName = String(existing.name || '');
  const nameChanged = oldName !== name;
  const dueChanged = String(existing.dateDue || '') !== dateDue;
  let cascaded = 0;
  const cascadeFailed: number[] = [];
  if (nameChanged || dueChanged) {
    const matching = snap.jobs.filter(
      (j: Job) => Number(j.orderId) === id && String(j.name || '') === oldName,
    );
    for (const j of matching) {
      const updated = {
        id: Number(j.id),
        name: nameChanged ? name : String(j.name),
        date: dueChanged ? dateDue : toISODate(String(j.date || '')),
        dateIn: toISODate(String(j.dateIn || '')),
        staff: String(j.staff || ''),
        dept: String(j.dept || ''),
        status: String(j.status || 'pending'),
        orderId: id,
        cowork: j.cowork ?? undefined,
      };
      try {
        const r = await post<{ ok?: boolean; error?: string }>('updateJob', { data: updated });
        if (r.error) cascadeFailed.push(Number(j.id));
        else cascaded++;
      } catch {
        cascadeFailed.push(Number(j.id));
      }
    }
  }

  return NextResponse.json({
    ok: true, orderId: id, cascaded, cascadeFailed, nameChanged, dueChanged,
  });
}
