import { NextResponse } from 'next/server';
import { loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/** Fetch a single order's rawData on demand. Used by /orders/new
 *  "ดึงงานล่าสุด" button so we don't have to preload 1000 full orders
 *  with rawData on every render of the order entry page (M2 from auditor). */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await requireSession(['admin', 'sales']);
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
