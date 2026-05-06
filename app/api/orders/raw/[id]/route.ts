import { NextResponse } from 'next/server';
import { loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/** Fetch a single order's rawData on demand.
 *  Consumers:
 *    - /orders/new "ดึงงานล่าสุดของลูกค้านี้" button (admin/sales)
 *    - /orders detail modal "สเปคงาน" tab (any role — same spec staff can
 *      already see on the Kanban card detail)
 *  Gate at the lowest common denominator: requireSession() = any logged-in
 *  user. rawData carries the order's full spec (paper, plate, colors, etc.)
 *  with no internal-only fields. */
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

  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  const order = snap.orders.find((o) => Number(o.id) === id);
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
