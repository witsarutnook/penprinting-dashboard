/**
 * Edit-lock for shipped / cancelled orders — the ONE decision shared by the
 * edit route (`app/orders/[id]/edit/page.tsx`) and the update API
 * (`app/api/orders/update/route.ts`).
 *
 * History: the rule lived only in `orders-table.tsx`'s render
 * (`canEdit = role === 'admin' && orderStatus !== 'shipped' && !== 'cancelled'`),
 * so every other entry point — /archive rows, a stale bookmark, a hand-typed
 * URL — could still open the form and POST an update that cascades
 * name/dateDue into tombstoned job rows (2026-09-05).
 *
 * Derivation mirrors `lib/orders-list.ts` exactly:
 *   isShipped   = status === 'shipped'   || a `shipped`   row exists for the order
 *   isCancelled = status === 'cancelled' || a `cancelled` row exists for the order
 * and cancelled wins over shipped — same precedence as the status pill.
 *
 * `shipped` / `cancelled` accept whatever the caller has: the raw row from
 * `loadOrder(id)`, or an EXISTS boolean from `loadOrderLockState(id)`.
 * Any truthy value means "a row exists".
 */

export type OrderLockReason = 'shipped' | 'cancelled';

export interface OrderLockInput {
  status?: unknown;
}

const LABEL: Record<OrderLockReason, string> = {
  shipped: 'จัดส่งแล้ว',
  cancelled: 'ยกเลิกแล้ว',
};

/** Why the order can't be edited, or `null` when it can. A missing order
 *  (`null`/`undefined`) is NOT locked — the caller owns the 404. */
export function orderLockReason(
  order: OrderLockInput | null | undefined,
  shipped: unknown,
  cancelled: unknown,
): OrderLockReason | null {
  if (!order) return null;
  const status = typeof order.status === 'string' ? order.status.trim().toLowerCase() : '';
  if (status === 'cancelled' || !!cancelled) return 'cancelled';
  if (status === 'shipped' || !!shipped) return 'shipped';
  return null;
}

export function isOrderLocked(
  order: OrderLockInput | null | undefined,
  shipped: unknown,
  cancelled: unknown,
): boolean {
  return orderLockReason(order, shipped, cancelled) !== null;
}

/** Short Thai label for the lock state — "จัดส่งแล้ว" / "ยกเลิกแล้ว". */
export function orderLockLabel(reason: OrderLockReason): string {
  return LABEL[reason];
}

/** Friendly one-liner shown by the edit page panel and returned as the
 *  409 `error` by /api/orders/update. */
export function orderLockMessage(reason: OrderLockReason): string {
  return `ใบสั่งงานนี้${LABEL[reason]} — แก้ไขไม่ได้`;
}

/** 409 `error` from /api/orders/cancel (audit M5, 2026-10-08): shipped is
 *  final — cancelling it flipped `status` with no cancelled row and left
 *  every surface disagreeing. Re-cancelling a cancelled order is a no-op. */
export function orderCancelLockMessage(reason: OrderLockReason): string {
  return reason === 'shipped'
    ? 'ใบสั่งงานนี้จัดส่งแล้ว — ยกเลิกไม่ได้'
    : 'ใบสั่งงานนี้ยกเลิกแล้ว';
}

/** 409 `error` from /api/jobs/add + /api/jobs/update when a job would be
 *  attached to a shipped/cancelled order (audit M4, 2026-10-08) — a live job
 *  under a terminal order is the one state every classifier gets wrong.
 *  Re-prints are a new order via "สั่งซ้ำ". */
export function orderAttachLockMessage(orderId: number | string, reason: OrderLockReason): string {
  return `ใบสั่งงาน #${orderId} ${LABEL[reason]} — เพิ่มงานไม่ได้ ถ้าต้องพิมพ์ซ้ำให้ "สั่งซ้ำ" เป็นใบใหม่`;
}

/** Browser-tab title for `/orders/[id]/edit`. A locked order renders the
 *  lock panel, not the form, so the tab must not say "แก้ไข" (audit L6) —
 *  it mirrors the panel's "ใบสั่งงาน #id" header + status pill instead. */
export function orderEditPageTitle(id: number, reason: OrderLockReason | null): string {
  return reason ? `ใบสั่งงาน #${id} · ${LABEL[reason]}` : 'แก้ไขใบสั่งงาน';
}
