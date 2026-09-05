import { describe, it, expect } from 'vitest';
import {
  orderLockReason,
  isOrderLocked,
  orderLockMessage,
} from '@/lib/order-lock';

/**
 * Edit-lock for shipped/cancelled orders (2026-09-05). The rule used to live
 * only in orders-table.tsx's render (`canEdit = admin && orderStatus !==
 * 'shipped' && !== 'cancelled'`), so any other entry point — /archive rows,
 * a stale bookmark, a hand-typed /orders/<id>/edit — could still open the
 * form and POST /api/orders/update, which cascades name/dateDue into the
 * tombstoned job rows. These tests pin the ONE decision both the route and
 * the API now share, mirroring lib/orders-list's derivation exactly:
 *   isShipped   = status === 'shipped'   || shipped row exists
 *   isCancelled = status === 'cancelled' || cancelled row exists
 *   cancelled wins over shipped (same precedence as the status pill).
 */
describe('orderLockReason', () => {
  it('active order with no shipped/cancelled row is not locked', () => {
    expect(orderLockReason({ status: 'sent' }, null, null)).toBeNull();
  });

  it('draft order is not locked', () => {
    expect(orderLockReason({ status: 'draft' }, null, null)).toBeNull();
  });

  it('missing order (not found) is not locked — caller owns the 404', () => {
    expect(orderLockReason(null, null, null)).toBeNull();
    expect(orderLockReason(undefined, null, null)).toBeNull();
  });

  it('status "shipped" locks as shipped', () => {
    expect(orderLockReason({ status: 'shipped' }, null, null)).toBe('shipped');
  });

  it('status is normalised (case + surrounding whitespace) like the list view', () => {
    expect(orderLockReason({ status: ' Shipped ' }, null, null)).toBe('shipped');
    expect(orderLockReason({ status: 'CANCELLED' }, null, null)).toBe('cancelled');
  });

  it('a shipped row locks even when order.status still says "sent"', () => {
    // Mirrors shippedOrderIds in lib/orders-list — the shipped table is the
    // record of truth for old rows whose order.status was never flipped.
    expect(orderLockReason({ status: 'sent' }, { id: 9001, orderId: 5 }, null)).toBe('shipped');
  });

  it('status "cancelled" locks as cancelled', () => {
    expect(orderLockReason({ status: 'cancelled' }, null, null)).toBe('cancelled');
  });

  it('a cancelled row locks even when order.status still says "sent"', () => {
    expect(orderLockReason({ status: 'sent' }, null, { id: 7, reason: 'ลูกค้ายกเลิก' })).toBe('cancelled');
  });

  it('cancelled wins over shipped (same precedence as the status pill)', () => {
    expect(orderLockReason({ status: 'shipped' }, { id: 1 }, { id: 2 })).toBe('cancelled');
    expect(orderLockReason({ status: 'cancelled' }, { id: 1 }, null)).toBe('cancelled');
  });

  it('accepts EXISTS-style booleans for the row flags', () => {
    expect(orderLockReason({ status: 'sent' }, true, false)).toBe('shipped');
    expect(orderLockReason({ status: 'sent' }, false, true)).toBe('cancelled');
    expect(orderLockReason({ status: 'sent' }, false, false)).toBeNull();
  });

  it('non-string status never throws', () => {
    expect(orderLockReason({ status: undefined }, null, null)).toBeNull();
    expect(orderLockReason({ status: 42 }, null, null)).toBeNull();
    expect(orderLockReason({}, null, null)).toBeNull();
  });
});

describe('isOrderLocked', () => {
  it('is the boolean view of orderLockReason', () => {
    expect(isOrderLocked({ status: 'sent' }, null, null)).toBe(false);
    expect(isOrderLocked({ status: 'shipped' }, null, null)).toBe(true);
    expect(isOrderLocked({ status: 'sent' }, null, { id: 1 })).toBe(true);
  });
});

describe('orderLockMessage', () => {
  it('shipped → friendly Thai message', () => {
    expect(orderLockMessage('shipped')).toBe('ใบสั่งงานนี้จัดส่งแล้ว — แก้ไขไม่ได้');
  });
  it('cancelled → friendly Thai message', () => {
    expect(orderLockMessage('cancelled')).toBe('ใบสั่งงานนี้ยกเลิกแล้ว — แก้ไขไม่ได้');
  });
});
