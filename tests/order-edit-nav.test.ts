import { describe, it, expect } from 'vitest';
import { boardReturnPath, orderEditHref, orderEditReturnPath } from '@/lib/order-edit-nav';

/**
 * The board card's "แก้ใบสั่ง" button goes to the full edit page (audit 2026-11-27: the form the
 * card used to open in place held a slim order — the PIN was wiped and a failed spec fetch could
 * be saved as a blank spec). The page takes the user back to where they came from.
 */
describe('order edit navigation', () => {
  it('the edit page of an order', () => {
    expect(orderEditHref(202611151)).toBe('/orders/202611151/edit');
  });

  it('opened from the board, the link says so', () => {
    expect(orderEditHref(202611151, 'board')).toBe('/orders/202611151/edit?from=board');
  });

  it('an edit opened from the board goes back to the board', () => {
    expect(orderEditReturnPath('board')).toBe('/board');
  });

  it('any other origin goes back to the orders list — the value is never used as a path', () => {
    for (const from of [undefined, null, '', 'orders', 'BOARD', '/board', 'https://example.com', '//example.com', ['board', 'x'], 42]) {
      expect(orderEditReturnPath(from), JSON.stringify(from)).toBe('/orders');
    }
  });

  // Independent review 2026-11-27: "back" in history is not always the board (a login page in
  // between after the session expired, a pasted link). The card remembers the board URL it was
  // pressed on — with the dept / staff / search filters, which live in the query — and the edit
  // page goes there.
  describe('the board URL to go back to', () => {
    it('the board as the user left it, filters and all', () => {
      expect(boardReturnPath('/board')).toBe('/board');
      expect(boardReturnPath('/board?dept=graphic&u=overdue')).toBe('/board?dept=graphic&u=overdue');
      expect(boardReturnPath('/board?q=%E0%B9%83%E0%B8%9A%E0%B8%9B%E0%B8%A5%E0%B8%B4%E0%B8%A7')).toBe('/board?q=%E0%B9%83%E0%B8%9A%E0%B8%9B%E0%B8%A5%E0%B8%B4%E0%B8%A7');
    });

    it('anything that is not a board URL of this site → the plain board', () => {
      for (const saved of [
        null, undefined, '', 42, ['/board'],
        '/orders', '/boardx', '/board/../orders', '/board#frag', '/board?dept=graphic#frag',
        '//example.com/board', 'https://example.com/board', 'javascript:alert(1)', ' /board', '/board?a=1 b',
        `/board?q=${'x'.repeat(600)}`,
      ]) {
        expect(boardReturnPath(saved), JSON.stringify(saved)).toBe('/board');
      }
    });
  });
});
