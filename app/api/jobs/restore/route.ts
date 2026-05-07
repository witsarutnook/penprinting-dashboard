import { NextResponse } from 'next/server';
import { post, loadAllFresh, loadOrder, AppsScriptError } from '@/lib/api';
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

  // Resolve the cancelled-row fields. Prefer the client snapshot; fall
  // back to a full loadAllFresh for callers that don't pass it (legacy
  // / external scripts hitting the route directly).
  let cjName: string;
  let cjDept: string;
  let cjStaff: string;
  let cjOrderId: number | null;

  const src = body.srcCancelled;
  if (src && src.name && src.dept && src.staff) {
    cjName = String(src.name);
    cjDept = String(src.dept);
    cjStaff = String(src.staff);
    cjOrderId = src.orderId ? Number(src.orderId) : null;
  } else {
    let snap;
    try {
      snap = await loadAllFresh();
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
    const cj = snap.cancelled.find((c) => Number(c.id) === id);
    if (!cj) {
      return NextResponse.json({ error: `ไม่พบรายการยกเลิก id=${id}` }, { status: 404 });
    }
    cjName = String(cj.name || '');
    cjDept = String(cj.dept || '');
    cjStaff = String(cj.staff || '');
    cjOrderId = cj.orderId ? Number(cj.orderId) : null;
  }

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
