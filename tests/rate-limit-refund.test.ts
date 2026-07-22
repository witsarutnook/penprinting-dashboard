import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * refundAttempt — pairs with a checkRateLimit (INCR+compare) gate: the gate
 * atomically reserves an attempt; refundAttempt hands it back when the
 * attempt turns out not to count (e.g. /track lookup with the CORRECT pin —
 * only PIN failures may consume lockout budget). Part of the
 * L-track-pin-lockout-toctou fix.
 */

import { refundAttempt } from '@/lib/rate-limit';

interface UpstashCall {
  command: (string | number)[];
}

const calls: UpstashCall[] = [];
let results: unknown[] = [];

const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
  const command = JSON.parse(String(init?.body)) as (string | number)[];
  calls.push({ command });
  const result = results.shift() ?? 0;
  return new Response(JSON.stringify({ result }), { status: 200 });
});

describe('refundAttempt', () => {
  beforeEach(() => {
    calls.length = 0;
    results = [];
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'token';
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  it('DECRs the prefixed key and leaves a non-negative counter alone', async () => {
    results = [3]; // DECR → 3
    await refundAttempt('track:pin-fail:123456');

    expect(calls.map((c) => c.command[0])).toEqual(['DECR']);
    expect(calls[0].command[1]).toBe('rl:track:pin-fail:123456');
  });

  it('deletes the key when the counter went negative (window expired mid-flight)', async () => {
    results = [-1]; // DECR → -1 → stray key
    await refundAttempt('track:pin-fail:123456');

    expect(calls.map((c) => c.command[0])).toEqual(['DECR', 'DEL']);
    expect(calls[1].command[1]).toBe('rl:track:pin-fail:123456');
  });

  it('fails open (no fetch) when KV is not configured', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;

    await refundAttempt('track:pin-fail:123456');

    expect(calls).toHaveLength(0);
  });
});
