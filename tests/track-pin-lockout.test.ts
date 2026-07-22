import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * L-track-pin-lockout-toctou (audit 2026-07-21): Layer-3 per-id PIN lockout
 * was peek-then-record — not atomic (concurrent requests slip past a stale
 * read) and off-by-one (peek denies at n > limit → 6 failed guesses before
 * the lock, not 5). These tests pin the fix: an atomic checkRateLimit
 * (INCR+compare) gate BEFORE the lookup, with the reserved attempt refunded
 * on every outcome that is NOT a PIN failure — so only wrong-PIN attempts
 * consume the 5-per-hour budget, exactly as before, but race-free.
 */

const checkMock = vi.fn();
const refundMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => checkMock(...a),
  refundAttempt: (...a: unknown[]) => refundMock(...a),
}));

const loadMock = vi.fn();
vi.mock('@/lib/api', () => ({
  loadOrder: (...a: unknown[]) => loadMock(...a),
  AppsScriptError: class AppsScriptError extends Error {},
}));

import { POST } from '@/app/api/track/lookup/route';

function mkReq(body: unknown): Request {
  return new Request('http://localhost/api/track/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

const orderRow = {
  id: 123456,
  name: 'งานทดสอบ',
  customer: 'ลูกค้า',
  dateIn: '2026-07-01',
  dateDue: '2026-07-30',
  status: 'sent',
  rawData: { pin: '1234' },
  details: null,
};

describe('POST /api/track/lookup — Layer-3 PIN lockout (atomic)', () => {
  beforeEach(() => {
    checkMock.mockResolvedValue({ ok: true, remaining: 4, resetIn: 3600 });
    refundMock.mockResolvedValue(undefined);
    loadMock.mockResolvedValue({ order: orderRow, job: null, shipped: null, cancelled: null });
  });

  it('gates with atomic checkRateLimit on the pin-fail key BEFORE the lookup', async () => {
    checkMock.mockImplementation((key: string) =>
      Promise.resolve(
        String(key).startsWith('track:pin-fail:')
          ? { ok: false, retryIn: 1800 }
          : { ok: true, remaining: 10, resetIn: 600 },
      ),
    );

    const res = await POST(mkReq({ id: '123456', pin: '9999' }));

    expect(res.status).toBe(429);
    expect(checkMock).toHaveBeenCalledWith(
      'track:pin-fail:123456',
      expect.objectContaining({ limit: 5, windowSec: 3600 }),
    );
    expect(loadMock).not.toHaveBeenCalled();
    expect(refundMock).not.toHaveBeenCalled();
  });

  it('wrong PIN consumes the reserved attempt (401, no refund)', async () => {
    const res = await POST(mkReq({ id: '123456', pin: '9999' }));

    expect(res.status).toBe(401);
    expect(refundMock).not.toHaveBeenCalled();
  });

  it('correct PIN refunds the reserved attempt (legit lookups never burn budget)', async () => {
    const res = await POST(mkReq({ id: '123456', pin: '1234' }));

    expect(res.status).toBe(200);
    expect(refundMock).toHaveBeenCalledWith('track:pin-fail:123456');
  });

  it('order-not-found refunds too — only PIN failures count', async () => {
    loadMock.mockResolvedValue({ order: null, job: null, shipped: null, cancelled: null });

    const res = await POST(mkReq({ id: '123456', pin: '1234' }));

    expect(res.status).toBe(404);
    expect(refundMock).toHaveBeenCalledWith('track:pin-fail:123456');
  });

  it('lookup failure (502) refunds — an outage must not lock legit customers out', async () => {
    loadMock.mockRejectedValue(new Error('db down'));

    const res = await POST(mkReq({ id: '123456', pin: '1234' }));

    expect(res.status).toBe(502);
    expect(refundMock).toHaveBeenCalledWith('track:pin-fail:123456');
  });
});
