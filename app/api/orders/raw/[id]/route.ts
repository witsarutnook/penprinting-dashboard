import { NextResponse } from 'next/server';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/** Fetch a single order's rawData on demand.
 *  Consumers:
 *    - /orders/new "ดึงงานล่าสุดของลูกค้านี้" button (admin/sales)
 *    - /orders detail modal "สเปคงาน" tab (any role — same spec staff can
 *      already see on the Kanban card detail)
 *  Gate at the lowest common denominator: requireSession() = any logged-in
 *  user. rawData carries the order's full spec (paper, plate, colors, etc.)
 *  with no internal-only fields.
 *
 *  Perf: uses Apps Script `getOrder` (single-row read) instead of
 *  `loadAll` (~200KB snapshot). Roughly 600ms → 200ms per modal open. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  let result;
  // [DEBUG-perf-N1] Timing instrument 2026-05-08 — Bug 4 Fix A (Apps
  // Script loadOrder TextFinder rewrite) deployed but modal still ~4s.
  // Bisect Apps Script time vs Vercel overhead by logging the
  // loadOrder() roundtrip duration; remove after diagnosis.
  const t0 = Date.now();
  try {
    // 30s ISR — modal opens often hit the same order repeatedly (user
    // browses the orders list and reopens to glance at spec). The
    // revalidatePath('/orders') call from PATHS_BY_ACTION after order
    // edits invalidates the page cache that ultimately feeds back into
    // here, so 30s of staleness is the worst case if a user edits and
    // immediately reopens — acceptable for spec-display.
    result = await loadOrder(id, { revalidate: 30 });
    // eslint-disable-next-line no-console
    console.log(`[DEBUG-perf-N1] /api/orders/raw/${id} loadOrder: ${Date.now() - t0}ms`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log(`[DEBUG-perf-N1] /api/orders/raw/${id} loadOrder: ERROR after ${Date.now() - t0}ms`);
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const order = result.order;
  if (!order) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    id: Number(order.id),
    name: String(order.name || ''),
    customer: String(order.customer || ''),
    rawData: raw,
  });
}
