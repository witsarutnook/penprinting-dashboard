/**
 * Route-level shipped/cancelled gate for mutations that target an ORDER by
 * id without loading it — /api/orders/cancel, /api/jobs/add and
 * /api/jobs/update (audit M4 + M5, 2026-10-08). One lock read
 * (`loadOrderLockState`: status + EXISTS flags), one decision
 * (`orderLockReason`), three outcomes:
 *
 *   502 — the read itself failed (outage, not a verdict)
 *   404 — no such order (a typo'd orderId is not a standalone job)
 *   409 — locked; `error` is the caller's wording, `locked` the reason
 *   null — go ahead
 *
 * /api/orders/update runs the same read inline because it also needs the
 * fresh `status` for the write (audit M3).
 */
import { NextResponse } from 'next/server';
import { loadOrderLockState } from '@/lib/api';
import { orderLockReason, type OrderLockReason } from './order-lock';

export async function gateLockedOrder(
  orderId: number,
  message: (reason: OrderLockReason) => string,
): Promise<NextResponse | null> {
  let lock: Awaited<ReturnType<typeof loadOrderLockState>>;
  try {
    lock = await loadOrderLockState(orderId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  if (!lock) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${orderId}` }, { status: 404 });
  }
  const reason = orderLockReason({ status: lock.status }, lock.shipped, lock.cancelled);
  if (reason) {
    return NextResponse.json({ error: message(reason), locked: reason }, { status: 409 });
  }
  return null;
}
