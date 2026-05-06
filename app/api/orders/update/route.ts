import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';
import { validatePhotobook, type PhotobookItem } from '@/lib/photobook';
import type { Order, Job } from '@/lib/types';

/**
 * Update an existing order — admin + sales (matches WP `PERM.canCreate`).
 *
 * Mirrors WP `submitOrder` edit branch (production-monitoring.js:1769):
 *   1. Validate header + photobook items if photobook.
 *   2. Fetch loadAllFresh, find existing order. PIN is preserved.
 *   3. updateOrder.
 *   4. CASCADE: if name or dateDue changed → updateJob for matching
 *      `jobs` rows (orderId + name match) so the workflow stays linked.
 *      shipped/cancelled rows aren't touched server-side here (their
 *      display in v2 reads via orderId join, so name drift is cosmetic).
 *
 * Request body: { id, name, customer, dateIn?, dateDue, price?, orderer,
 *                 assignDept, assignStaff, notes?, orderType?,
 *                 photobookItems? }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: {
    id?: number | string;
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
  };
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
  const name = (body.name || '').trim();
  const customer = (body.customer || '').trim();
  const dateDue = toISODate(body.dateDue);
  const dateIn = toISODate(body.dateIn);
  const orderer = (body.orderer || '').trim();
  const assignDept = String(body.assignDept || '');
  const assignStaff = String(body.assignStaff || '');
  const errors: string[] = [];
  if (!name) errors.push('กรุณาระบุชื่องาน');
  if (!customer) errors.push('กรุณาระบุชื่อลูกค้า');
  if (!dateDue) errors.push('กรุณาระบุกำหนดส่ง');
  if (!orderer) errors.push('กรุณาระบุผู้สั่งงาน');
  if (!assignDept || !assignStaff) errors.push('กรุณาเลือกแผนก/ผู้รับงาน');
  if (errors.length) return NextResponse.json({ error: errors.join(' • ') }, { status: 400 });

  const validStaff = STAFF[assignDept as Dept]?.some((s) => s.id === assignStaff);
  if (!validStaff) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${assignStaff}" ไม่ตรงกับแผนก "${assignDept}"` },
      { status: 400 },
    );
  }

  let photobookItems: PhotobookItem[] = [];
  if (isPB) {
    const v = validatePhotobook(body.photobookItems);
    if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });
    photobookItems = v.cleaned;
  }

  // Fetch existing snapshot — needed for PIN, status preservation, cascade rename.
  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  const existing: Order | undefined = snap.orders.find((o) => Number(o.id) === id);
  if (!existing) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }

  // Preserve PIN from rawData or top-level (WP shape varies by era).
  const existingRaw = (existing.rawData && typeof existing.rawData === 'object' ? existing.rawData : {}) as Record<string, unknown>;
  const existingDetails = (existing.details && typeof existing.details === 'object' ? existing.details : {}) as Record<string, unknown>;
  const pin = String(existingRaw.pin || existingDetails.pin || '');

  const newDetails: Record<string, unknown> = { ...existingDetails, pin };
  if (body.notes !== undefined) newDetails.notes = body.notes;
  if (isPB) newDetails.photobook = photobookItems;
  else delete newDetails.photobook;

  const newRaw = { ...existingRaw, ...body, orderType, pin };

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
    details: newDetails,
    rawData: newRaw,
  };

  // ── Update order ─────────────────────────────────────────
  try {
    const r = await post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `updateOrder failed — ${msg}` }, { status: 502 });
  }

  // ── CASCADE: rename matching jobs (name change OR dateDue change) ─
  const oldName = String(existing.name || '');
  const nameChanged = oldName !== name;
  const dueChanged = String(existing.dateDue || '') !== dateDue;
  let cascaded = 0;
  const cascadeFailed: number[] = [];
  if (nameChanged || dueChanged) {
    const matchingJobs = snap.jobs.filter(
      (j: Job) => Number(j.orderId) === id && String(j.name || '') === oldName,
    );
    for (const j of matchingJobs) {
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
    ok: true,
    orderId: id,
    cascaded,
    cascadeFailed,
    nameChanged,
    dueChanged,
  });
}
