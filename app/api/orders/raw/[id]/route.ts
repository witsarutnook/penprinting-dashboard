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
 *  Perf: `loadOrder(id, { orderOnly: true })` is a Postgres single-row
 *  read (Apps Script left this path in Phase 4.2) — no snapshot fetch. */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    // Fresh single-row Postgres read on every hit — no caching layer
    // (spec must reflect an edit immediately when the modal reopens).
    //
    // Note (2026-05-08): /orders detail modal now reads rawData inline
    // from the page-level snapshot (matches /board card detail), so this
    // route is rarely hit on the happy path — only as fallback when the
    // inline rawData is missing or empty, plus the /orders/new
    // "ดึงงานล่าสุด" button and lazy spec fetches.
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
