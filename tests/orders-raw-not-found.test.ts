import { describe, it, expect, vi } from 'vitest';
import { OrderNotFoundError } from '@/lib/postgres-errors';

/**
 * Audit H1 (2026-10-08): /api/orders/raw/[id] branched on `!result.order`
 * for its 404, but `loadOrder` throws on a missing row — so an unknown id
 * came back as 502 "อ่านข้อมูลไม่ได้ — Postgres read failed: order N not
 * found in Postgres". Pin the typed-error → 404 mapping.
 */

const loadMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrder: (...a: unknown[]) => loadMock(...a),
}));

vi.mock('@/lib/route-helpers', () => ({
  requireSession: async () => ({ role: 'sales', user: 'กบ' }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async () => ({ ok: true, remaining: 100, resetIn: 60 }),
}));

import { GET } from '@/app/api/orders/raw/[id]/route';

function call(id: string) {
  return GET(new Request(`http://localhost/api/orders/raw/${id}`), { params: Promise.resolve({ id }) });
}

// No explicit mockReset() here: vitest.config already clears + restores
// mocks between tests, and calling mockReset() on top of restoreMocks
// (vitest 4) re-surfaces the mocked rejection as a phantom test error.
describe('GET /api/orders/raw/[id] — order row missing', () => {
  it('404 "ไม่พบใบสั่งงาน #id" when loadOrder throws OrderNotFoundError', async () => {
    loadMock.mockRejectedValue(new OrderNotFoundError(202609999));

    const res = await call('202609999');
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('ไม่พบใบสั่งงาน #202609999');
  });

  it('any other read failure stays a 502 (outage ≠ wrong id)', async () => {
    loadMock.mockRejectedValue(new Error('Postgres read failed: connection refused'));

    const res = await call('5');

    expect(res.status).toBe(502);
  });
});
