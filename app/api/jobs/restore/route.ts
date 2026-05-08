import { NextResponse } from 'next/server';
import { post, loadAll, loadAllFresh, loadOrder, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';

interface SrcCancelled {
  name?: string;
  dept?: string;
  staff?: string;
  orderId?: number | string | null;
}

/**
 * Restore a cancelled job back into the Kanban — admin only. Mirrors WP
 * `restoreCancelledJob` (production-monitoring.js:3692).
 *
 * Strategy: read the cancelled row + its parent order (for date / dateIn),
 * call Apps Script `restoreJob` which atomically deletes from `cancelled`
 * and appends to `jobs`.
 *
 * Perf: when the client passes `srcCancelled` (which the /cancelled page
 * already has from its loadAll snapshot), we skip the full loadAllFresh
 * read for the cancelled row. We still need the parent order for due/in
 * dates — fetched via `loadOrder(orderId)` which is a single-row read
 * (~200ms vs the full snapshot's ~600ms). If there's no parent order,
 * we skip the second fetch entirely. Net savings: ~400-600ms per restore.
 *
 * Request body: { id, srcCancelled?: { name, dept, staff, orderId } }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string; srcCancelled?: SrcCancelled };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

  // Resolve the cancelled-row fields. Always read the actual row from
  // the Sheet so name/dept/staff/orderId reflect ground truth — auditor
  // H3 (2026-05-08): previously trusted client-supplied src verbatim,
  // which let a buggy client send a real `id` but mismatched name/dept,
  // appending a fresh row with arbitrary content.
  //
  // Perf: when src is provided we use the cached `loadAll()` (60s ISR)
  // so we still avoid the ~600ms loadAllFresh cost in the common case.
  // Cache miss falls back to fresh read. Without src we go straight to
  // loadAllFresh (legacy / external callers).
  const src = body.srcCancelled;
  let snap;
  try {
    snap = src && src.name ? await loadAll() : await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  let cj = snap.cancelled.find((c) => Number(c.id) === id);
  // Cache might be stale for newly-cancelled rows — retry fresh.
  if (!cj && src && src.name) {
    try {
      snap = await loadAllFresh();
      cj = snap.cancelled.find((c) => Number(c.id) === id);
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
  }
  if (!cj) {
    return NextResponse.json({ error: `ไม่พบรายการยกเลิก id=${id}` }, { status: 404 });
  }
  // If client supplied src, sanity-check that the snapshot matches —
  // otherwise the client is out of sync (or buggy) and we shouldn't
  // restore a row whose real content the user can't see.
  if (src && src.name && String(src.name).trim() !== String(cj.name || '').trim()) {
    return NextResponse.json(
      {
        error: `ข้อมูลที่ส่งมาไม่ตรงกับ row id=${id} ใน Sheet — refresh หน้า /cancelled แล้วลองใหม่`,
      },
      { status: 409 },
    );
  }
  const cjName = String(cj.name || '');
  const cjDept = String(cj.dept || '');
  const cjStaff = String(cj.staff || '');
  const cjOrderId = cj.orderId ? Number(cj.orderId) : null;

  // Reattach to parent order (if any) to recover due/in dates. Use the
  // single-row `loadOrder` instead of dragging in the full snapshot.
  // Note (auditor L7): cowork list is lost through the cancel→restore
  // cycle — the cancelled sheet schema doesn't include a cowork column.
  // To preserve it would require an Apps Script CANCELLED_HEADERS change.
  // Acceptable for now since cowork on a cancelled job rarely stays valid.
  let orderDateDue = '';
  let orderDateIn = '';
  if (cjOrderId) {
    try {
      const orderResult = await loadOrder(cjOrderId);
      if (orderResult.order) {
        orderDateDue = String(orderResult.order.dateDue || '');
        orderDateIn = String(orderResult.order.dateIn || '');
      }
    } catch {
      // Non-fatal — restore the job with empty dates if the parent order
      // lookup fails. Admin can edit afterwards.
    }
  }

  const restored = {
    id,
    name: cjName,
    dept: cjDept,
    staff: cjStaff,
    status: 'pending',
    orderId: cjOrderId || '',
    date: toISODate(orderDateDue),
    dateIn: toISODate(orderDateIn),
  };

  try {
    const result = await post<{ ok?: boolean; error?: string }>('restoreJob', { data: restored });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
