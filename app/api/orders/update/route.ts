import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';
import type { Job } from '@/lib/types';

interface SrcOrderSnapshot {
  name?: string;
  dateDue?: string;
  dateIn?: string;
  price?: string | number;
  status?: string;
  rawData?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
}

/** Update an existing order — admin only. Sales can create new orders
 *  + promote drafts, but mutating an order's spec/dates/cascade is
 *  reserved for admin (matches user's permission requirement, 2026-05-06).
 *  Mirrors the add route's full WP-shape OrderFormData input. Preserves
 *  PIN, cascades name/dateDue changes to matching jobs.
 *
 *  Perf: when the client passes `srcOrder` (existing-order snapshot from
 *  the edit page's prefetched data), we skip `loadAllFresh()` UNLESS
 *  name/dateDue actually changed (cascade requires the jobs list). For the
 *  common spec-only edit, that drops the read round-trip entirely
 *  (~600ms saved per edit). */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: Partial<OrderFormData> & {
    id?: number | string;
    price?: string | number;
    srcOrder?: SrcOrderSnapshot;
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

  // Resolve the existing-order shape. Prefer client-supplied `srcOrder`
  // (passed by the edit page's prefetched OrderSummary) — that's a
  // free read since the page already loaded with this data. Fall back to
  // `loadAllFresh()` for callers that don't pass it (legacy / external).
  const src = body.srcOrder;
  const oldName = String(src?.name ?? '');
  const oldDateDue = toISODate(String(src?.dateDue ?? ''));
  const nameChanged = !!src && oldName !== name;
  const dueChanged = !!src && oldDateDue !== dateDue;
  // Cascade rename needs the full jobs list; skip the read if neither
  // name nor dateDue changed (the common case — spec-only edits).
  const needsCascadeRead = !src || nameChanged || dueChanged;

  let snap: Awaited<ReturnType<typeof loadAllFresh>> | null = null;
  let existing: SrcOrderSnapshot;
  if (needsCascadeRead) {
    try {
      snap = await loadAllFresh();
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
    const found = snap.orders.find((o) => Number(o.id) === id);
    if (!found) {
      return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
    }
    existing = found;
  } else {
    existing = src!;
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
  delete formSnapshot.srcOrder;

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

  // ── Parallel writes: updateOrder + cascade renames ──────
  // updateOrder writes the orders sheet; cascade updateJob calls write
  // independent rows in the jobs sheet — they don't depend on each
  // other's response, so Promise.all collapses N+1 sequential round-
  // trips into the time of the slowest one. Big win when an order has
  // multiple jobs (e.g. cowork mid-flight) AND the user changed
  // name/dateDue.
  // Only need cascade payloads when name/dateDue actually changed AND
  // we have the snapshot (read was performed).
  const matching = (nameChanged || dueChanged) && snap
    ? snap.jobs.filter((j: Job) => Number(j.orderId) === id && String(j.name || '') === oldName)
    : [];

  const cascadePayloads = matching.map((j) => ({
    id: Number(j.id),
    name: nameChanged ? name : String(j.name),
    date: dueChanged ? dateDue : toISODate(String(j.date || '')),
    dateIn: toISODate(String(j.dateIn || '')),
    staff: String(j.staff || ''),
    dept: String(j.dept || ''),
    status: String(j.status || 'pending'),
    orderId: id,
    cowork: j.cowork ?? undefined,
  }));

  const orderTask = post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
  const cascadeTasks = cascadePayloads.map((data) =>
    post<{ ok?: boolean; error?: string }>('updateJob', { data }),
  );

  const [orderOutcome, ...cascadeOutcomes] = await Promise.allSettled([orderTask, ...cascadeTasks]);

  if (orderOutcome.status === 'rejected') {
    const msg = orderOutcome.reason instanceof Error ? orderOutcome.reason.message : String(orderOutcome.reason);
    return NextResponse.json({ error: `updateOrder failed — ${msg}` }, { status: 502 });
  }
  if (orderOutcome.value.error) {
    return NextResponse.json({ error: orderOutcome.value.error }, { status: 400 });
  }

  let cascaded = 0;
  const cascadeFailed: number[] = [];
  cascadeOutcomes.forEach((outcome, idx) => {
    const jobIdN = Number(cascadePayloads[idx].id);
    if (outcome.status === 'rejected' || outcome.value.error) {
      cascadeFailed.push(jobIdN);
    } else {
      cascaded++;
    }
  });

  return NextResponse.json({
    ok: true, orderId: id, cascaded, cascadeFailed, nameChanged, dueChanged,
  });
}
