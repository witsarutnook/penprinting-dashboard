import { NextResponse } from 'next/server';
import { post, loadOrderAndJobs, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { type Dept } from '@/lib/board';
import { toISODate } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';
import type { Job } from '@/lib/types';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { allSettledLimit } from '@/lib/concurrency';
import {
  updateOrderInPostgres,
  cascadeRenameJobsInPostgres,
  appendAuditToPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

export const maxDuration = 30;

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
 *  the edit page's prefetched data), we skip the read entirely UNLESS
 *  name/dateDue actually changed (cascade requires the jobs list). For the
 *  common spec-only edit, that drops the read round-trip entirely
 *  (~600ms saved per edit).
 *
 *  Phase 2 stale-read fix (2026-05-14): the read uses `loadOrderAndJobs`
 *  (Postgres-first) instead of `loadAllFresh` (Sheet-only). Pre-fix, an
 *  order that lived in Postgres but had not yet heal-cron-synced to Sheet
 *  would 404 on edit. Same disease as the 2026-05-12 `loadOrder` refactor
 *  (`c0be3b8`) and the 2026-05-11 promote-draft fix (`1f62d3b`). */
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
  // `loadOrderAndJobs(id)` (Postgres-first) for callers that don't pass it
  // (legacy / external).
  const src = body.srcOrder;
  const oldName = String(src?.name ?? '');
  const oldDateDue = toISODate(String(src?.dateDue ?? ''));
  const nameChanged = !!src && oldName !== name;
  const dueChanged = !!src && oldDateDue !== dateDue;
  // Cascade rename needs the order's jobs list; skip the read if neither
  // name nor dateDue changed (the common case — spec-only edits).
  const needsCascadeRead = !src || nameChanged || dueChanged;

  let cascadeJobs: Job[] = [];
  let existing: SrcOrderSnapshot;
  if (needsCascadeRead) {
    let snap: Awaited<ReturnType<typeof loadOrderAndJobs>>;
    try {
      snap = await loadOrderAndJobs(id);
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
    if (!snap.order) {
      return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
    }
    existing = snap.order as unknown as SrcOrderSnapshot;
    cascadeJobs = snap.jobs as unknown as Job[];
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
  // we have the jobs list (read was performed; loadOrderAndJobs already
  // pre-filters to this orderId, so just match by oldName).
  const matching = (nameChanged || dueChanged) && cascadeJobs.length > 0
    ? cascadeJobs.filter((j: Job) => String(j.name || '') === oldName)
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

  // ── Phase 2 path ────────────────────────────────────────────────
  if (phase2WriteEnabled('updateOrder')) {
    let found = false;
    try {
      const r = await updateOrderInPostgres(orderPayload);
      found = r.found;
    } catch (err) {
      const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    if (!found) {
      // Row not in Postgres yet — fall through to legacy below.
    } else {
      const cascade = await cascadeRenameJobsInPostgres(
        id,
        oldName,
        name,
        dateDue || null,
        nameChanged,
        dueChanged,
      );
      await appendAuditToPostgres({
        action: 'updateOrder',
        role: session.role,
        user: session.user,
        targetId: id,
        data: { name, customer },
      });
      try {
        const { revalidatePath, revalidateTag } = await import('next/cache');
        revalidateTag('load-all'); // bust loadAll() snapshot cache
        revalidatePath('/board');
        revalidatePath('/orders');
      } catch { /* ignore */ }
      return NextResponse.json({
        ok: true,
        orderId: id,
        cascaded: cascade.cascaded,
        cascadeFailed: cascade.failedJobIds,
        nameChanged,
        dueChanged,
      });
    }
  }

  // Cap concurrency at 3 on the cascade fan-out — same pattern as
  // /api/orders/{cancel,delete} (M5 auditor finding). Wide cowork orders
  // (5-10+ matching jobs) firing all writes at once risks Apps Script
  // LockService.waitLock(10000) timeouts on the tail of the queue. The
  // order write itself stays uncapped — it's the primary mutation and
  // must land first. (Auditor PERF-B2 finding, 2026-05-12.)
  const orderTaskFactory = () => post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
  const cascadeTaskFactories = cascadePayloads.map((data) =>
    () => post<{ ok?: boolean; error?: string }>('updateJob', { data }),
  );

  const [orderOutcome, ...cascadeOutcomes] = await allSettledLimit(
    [orderTaskFactory, ...cascadeTaskFactories],
    3,
  );

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
