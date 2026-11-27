import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining } from './helpers/mock-postgres';

/**
 * H1-board-edit-wipes-pin (audit 2026-11-27). The route and the real write function together,
 * over the SQL mock: what an edit leaves in the row's PIN.
 *
 * The form opened from a board card holds a slim order (no rawData / details — lib/board-delta.ts
 * strips them), so the `srcOrder` it sends back has no PIN. When the name and due date are
 * unchanged the route skips its read, and it used to take the PIN from that snapshot: pin "" was
 * written over raw_data / details / the raw copy (19 orders on production, Jul–Nov 2026).
 */

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

const loadMock = vi.fn();
const lockMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrderAndJobs: (...a: unknown[]) => loadMock(...a),
  loadOrderLockState: (...a: unknown[]) => lockMock(...a),
}));

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));

import { POST } from '@/app/api/orders/update/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/orders/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** What the form posts: header fields + a spec field. The form has no PIN field. */
const FORM = {
  id: 202611151,
  name: 'ใบปลิว A5',
  customer: 'ร้านกาแฟ',
  dateDue: '2026-11-30',
  orderer: 'นุ๊ก',
  assignStaff: 'กบ',
  notes: 'พิมพ์ 4 สี 2 หน้า',
};

/** The order as it sits in the row: PIN 4821 in both snapshots. */
const STORED_SNAPSHOT = { name: 'ใบปลิว A5', customer: 'ร้านกาแฟ', notes: 'พิมพ์ 4 สี', pin: '4821', orderType: 'normal' };
function rowHoldsPin(pin: string | null) {
  // updateOrderInPostgres: the read of the row, then the UPDATE.
  queueResult({
    rows: [{
      raw: { id: 202611151, name: 'ใบปลิว A5', dateDue: '2026-11-30', status: 'sent', rawData: STORED_SNAPSHOT, details: STORED_SNAPSHOT },
      pin,
      peak: null,
    }],
    rowCount: 1,
  });
  queueResult({ rowCount: 1 });
}

/** The JSON bound to `column` in the UPDATE of orders. */
function written(column: 'raw_data' | 'details' | 'raw'): Record<string, unknown> {
  const upd = findCallContaining('UPDATE orders SET');
  expect(upd, 'must UPDATE orders').toBeDefined();
  const slot = new RegExp(`\\b${column} = \\$(\\d+)::jsonb`).exec(upd!.text);
  expect(slot, `${column} must be a bound jsonb parameter`).not.toBeNull();
  return JSON.parse(String(upd!.values[Number(slot![1]) - 1])) as Record<string, unknown>;
}

describe('POST /api/orders/update — the PIN of the order', () => {
  beforeEach(() => {
    resetMockPostgres();
    loadMock.mockReset();
    sessionMock.mockResolvedValue({ role: 'admin', user: 'นุ๊ก' });
    lockMock.mockResolvedValue({ status: 'sent', shipped: false, cancelled: false });
  });

  it('an edit from a board card (slim order, name and due date unchanged) leaves the PIN in the row', async () => {
    rowHoldsPin('4821');

    const res = await POST(mkReq({
      ...FORM,
      // what app/board/order-form.tsx sends for `initial = job.order` (slim)
      srcOrder: { name: 'ใบปลิว A5', dateDue: '2026-11-30', dateIn: '2026-11-26', price: '', status: 'sent', rawData: null, details: null },
    }));

    expect(res.status).toBe(200);
    expect(loadMock, 'the scenario is the read-skip path').not.toHaveBeenCalled();
    expect(written('raw_data').pin).toBe('4821');
    expect(written('details').pin).toBe('4821');
    expect((written('raw').rawData as Record<string, unknown>).pin).toBe('4821');
    expect((written('raw').details as Record<string, unknown>).pin).toBe('4821');
    // the edit itself went through
    expect(written('raw_data').notes).toBe('พิมพ์ 4 สี 2 หน้า');
  });

  // Control: this path was never broken (the route read the order and found the PIN there).
  it('a caller without srcOrder (the route reads the order itself) leaves the PIN in the row', async () => {
    loadMock.mockResolvedValue({
      order: { name: 'ใบปลิว A5', dateDue: '2026-11-30', status: 'sent', rawData: STORED_SNAPSHOT, details: STORED_SNAPSHOT },
      jobs: [],
    });
    rowHoldsPin('4821');

    const res = await POST(mkReq(FORM));

    expect(res.status).toBe(200);
    expect(written('raw_data').pin).toBe('4821');
  });

  it('a PIN the client sends back is not what gets written: the PIN of the row is', async () => {
    rowHoldsPin('4821');

    const res = await POST(mkReq({
      ...FORM,
      pin: '0000',
      srcOrder: { name: 'ใบปลิว A5', dateDue: '2026-11-30', status: 'sent', rawData: { pin: '0000' }, details: { pin: '0000' } },
    }));

    expect(res.status).toBe(200);
    expect(written('raw_data').pin).toBe('4821');
    expect(written('details').pin).toBe('4821');
  });

  it('an order whose row holds no PIN is not given one by the client', async () => {
    rowHoldsPin(null);

    const res = await POST(mkReq({
      ...FORM,
      srcOrder: { name: 'ใบปลิว A5', dateDue: '2026-11-30', status: 'sent', rawData: { pin: '0000' }, details: null },
    }));

    expect(res.status).toBe(200);
    expect(written('raw_data')).not.toHaveProperty('pin');
    expect(written('details')).not.toHaveProperty('pin');
  });
});
