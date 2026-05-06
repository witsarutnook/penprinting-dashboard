import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';

/**
 * Restore a cancelled job back into the Kanban — admin only. Mirrors WP
 * `restoreCancelledJob` (production-monitoring.js:3692).
 *
 * Strategy: read the cancelled row + its parent order (for date / dateIn),
 * call Apps Script `restoreJob` which atomically deletes from `cancelled`
 * and appends to `jobs`.
 *
 * Request body: { id }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

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

  // Reattach to parent order (if any) to recover due/in dates
  const order = cj.orderId ? snap.orders.find((o) => Number(o.id) === Number(cj.orderId)) : null;
  const restored = {
    id: cj.id,
    name: cj.name,
    dept: cj.dept,
    staff: cj.staff,
    status: 'pending',
    orderId: cj.orderId || '',
    date: toISODate(order?.dateDue || ''),
    dateIn: toISODate(order?.dateIn || ''),
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
