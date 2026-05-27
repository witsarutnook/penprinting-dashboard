import { NextResponse } from 'next/server';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

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

  // Per-user rate limit — 120 req/min handles bursty browsing of the
  // orders list (each modal open is one fetch, sometimes prefetched on
  // hover) while capping runaway loops from burning Apps Script quota.
  const rate = await checkRateLimit(`raw:${session.user}`, { limit: 120, windowSec: 60 });
  if (!rate.ok) {
    return NextResponse.json(
      { error: `เรียกข้อมูลถี่เกินไป กรุณารออีก ${rate.retryIn} วินาที` },
      { status: 429, headers: { 'Retry-After': String(rate.retryIn) } },
    );
  }

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  let result;
  try {
    // 30s ISR — modal opens often hit the same order repeatedly (user
    // browses the orders list and reopens to glance at spec). The
    // revalidatePath('/orders') call from PATHS_BY_ACTION after order
    // edits invalidates the page cache that ultimately feeds back into
    // here, so 30s of staleness is the worst case if a user edits and
    // immediately reopens — acceptable for spec-display.
    //
    // Note (2026-05-08): /orders detail modal now reads rawData inline
    // from the page-level loadAll snapshot (matches /board card detail),
    // so this route is rarely hit on the happy path — only as fallback
    // when the inline rawData is missing or empty.
    result = await loadOrder(id, { orderOnly: true });
  } catch (err) {
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
