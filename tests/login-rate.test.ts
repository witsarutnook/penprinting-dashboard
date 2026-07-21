import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * M-login-no-ip-ratelimit (audit 2026-07-21): the only login throttle was
 * the signed cookie window — a client that never sends the cookie starts
 * every request at count 0 = unlimited guessing. These tests pin the new
 * first-layer IP gate: failures-only counting via peekRateLimit +
 * recordFailure (NOT checkRateLimit-per-attempt — the whole print shop
 * shares one office NAT IP, so successful morning logins must never
 * consume the budget).
 */

const peekMock = vi.fn();
const recordMock = vi.fn();
vi.mock('@/lib/rate-limit', () => ({
  peekRateLimit: (...a: unknown[]) => peekMock(...a),
  recordFailure: (...a: unknown[]) => recordMock(...a),
}));

import { POST } from '@/app/api/auth/login/route';

function mkReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.7', ...headers },
    body: JSON.stringify(body),
  });
}

describe('login IP rate-limit layer', () => {
  beforeEach(() => {
    process.env.DASHBOARD_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
    process.env.DASHBOARD_AUTH_USERS = JSON.stringify({
      'correct-horse': { role: 'admin', user: 'tester' },
    });
    peekMock.mockResolvedValue({ ok: true, remaining: 10, resetIn: 900 });
    recordMock.mockResolvedValue(1);
  });

  it('returns 429 from the IP gate BEFORE checking the password', async () => {
    peekMock.mockResolvedValue({ ok: false, retryIn: 600 });

    const res = await POST(mkReq({ password: 'correct-horse' }));

    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('กรุณารออีก');
    expect(peekMock).toHaveBeenCalledWith(
      'login:ip:203.0.113.7',
      expect.objectContaining({ limit: expect.any(Number), windowSec: expect.any(Number) }),
    );
    // Locked-out IP must not learn whether the password was right, and
    // must not burn more failure budget.
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('records an IP failure on wrong password', async () => {
    const res = await POST(mkReq({ password: 'wrong-guess' }));

    expect(res.status).toBe(401);
    expect(recordMock).toHaveBeenCalledWith(
      'login:ip:203.0.113.7',
      expect.objectContaining({ windowSec: expect.any(Number) }),
    );
  });

  it('does NOT consume IP budget on successful login (shared office NAT)', async () => {
    const res = await POST(mkReq({ password: 'correct-horse' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('falls back to x-forwarded-for first hop when x-real-ip is absent', async () => {
    peekMock.mockResolvedValue({ ok: false, retryIn: 60 });

    const req = new Request('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.9, 10.0.0.1',
      },
      body: JSON.stringify({ password: 'x' }),
    });
    await POST(req);

    expect(peekMock).toHaveBeenCalledWith('login:ip:198.51.100.9', expect.anything());
  });
});
