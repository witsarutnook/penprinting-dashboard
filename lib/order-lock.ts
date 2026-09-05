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
