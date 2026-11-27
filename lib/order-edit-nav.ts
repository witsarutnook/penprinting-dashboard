/**
 * Links to the order edit page (`/orders/[id]/edit`) and the page it returns to.
 * No 'server-only': used by the board card (client) and the edit page (server).
 *
 * The edit page is the one place an order is edited: it loads the full order. The board card
 * used to open the form in place with the slim order the board holds, and that form could not
 * be trusted with what it did not have (audit 2026-11-27: the PIN was wiped on 19 orders, and a
 * failed spec fetch could be saved as a blank spec).
 */

/** Where an edit was opened from, when it is not the orders list. */
export type OrderEditOrigin = 'board';

export function orderEditHref(orderId: number, from?: OrderEditOrigin): string {
  const base = `/orders/${orderId}/edit`;
  return from ? `${base}?from=${from}` : base;
}

/** The page to go back to after the edit. `from` is the raw `?from=` value: it is only ever
 *  compared, never used as a path. */
export function orderEditReturnPath(from: unknown): '/board' | '/orders' {
  return from === 'board' ? '/board' : '/orders';
}

/** sessionStorage key: the board URL (path + query) the card's "แก้ใบสั่ง" button was pressed on. */
export const BOARD_RETURN_KEY = 'pp:order-edit:board-return';

/** The board URL to go back to after an edit opened from a card. `saved` is what the card stored:
 *  it is used only when it is a board URL of this site — `/board` with an optional query, nothing
 *  else — so a stale or tampered value can only ever lead to the plain board. */
export function boardReturnPath(saved: unknown): string {
  return typeof saved === 'string' && saved.length <= 500 && /^\/board(\?[^#\s]*)?$/.test(saved)
    ? saved
    : '/board';
}
