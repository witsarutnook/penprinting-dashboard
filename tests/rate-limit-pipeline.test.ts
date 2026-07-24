import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * L-ratelimit-serial-upstash-hops: checkRateLimit used to spend 2-3
 * sequential Upstash REST hops (INCR → EXPIRE → TTL) per call — paid on
 * every modal open and inside the AI webhook hot path. All three commands
 * now ride ONE `/pipeline` request; peekRateLimit (GET → TTL) and
 * recordFailure (INCR → EXPIRE) collapse the same way. refundAttempt is
 * intentionally untouched — its DEL is conditional on the DECR result.
 *
 * Fail-open contract is unchanged: whole-request failure OR a malformed
 * count slot → allow (the limiter is defense-in-depth, endpoints are
 * auth-gated regardless).
 */

import { checkRateLimit, peekRateLimit, recordFailure } from '@/lib/rate-limit';

interface PipelineCall {
  url: string;
  commands: (string | number)[][];
}

const calls: PipelineCall[] = [];
let response: { status: number; body: unknown } = { status: 200, body: [] };
let networkFail = false;

const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
  if (networkFail) throw new Error('network down');
  calls.push({ url: String(url), commands: JSON.parse(String(init?.body)) as (string | number)[][] });
  return new Response(JSON.stringify(response.body), { status: response.status });
});

describe('rate-limit via Upstash /pipeline (single hop)', () => {
  beforeEach(() => {
    calls.length = 0;
    networkFail = false;
    response = { status: 200, body: [] };
    process.env.KV_REST_API_URL = 'https://kv.test';
    process.env.KV_REST_API_TOKEN = 'token';
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  describe('checkRateLimit', () => {
    it('sends INCR + EXPIRE + TTL as ONE pipeline request', async () => {
      response = { status: 200, body: [{ result: 3 }, { result: 1 }, { result: 57 }] };
      const r = await checkRateLimit('raw:nook', { limit: 120, windowSec: 60 });

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://kv.test/pipeline');
      expect(calls[0].commands).toEqual([
        ['INCR', 'rl:raw:nook'],
        ['EXPIRE', 'rl:raw:nook', 60],
        ['TTL', 'rl:raw:nook'],
      ]);
      expect(r).toEqual({ ok: true, remaining: 117, resetIn: 60 });
    });

    it('over-limit: denies with retryIn from the TTL slot of the SAME request', async () => {
      response = { status: 200, body: [{ result: 121 }, { result: 1 }, { result: 42 }] };
      const r = await checkRateLimit('raw:nook', { limit: 120, windowSec: 60 });

      expect(calls).toHaveLength(1);
      expect(r).toEqual({ ok: false, retryIn: 42 });
    });

    it('over-limit with a useless TTL slot (-1 / error) falls back to windowSec', async () => {
      response = { status: 200, body: [{ result: 121 }, { result: 1 }, { error: 'ERR' }] };
      const r = await checkRateLimit('raw:nook', { limit: 120, windowSec: 60 });
      expect(r).toEqual({ ok: false, retryIn: 60 });
    });

    it('fails open on a network error', async () => {
      networkFail = true;
      const r = await checkRateLimit('raw:nook', { limit: 120, windowSec: 60 });
      expect(r).toEqual({ ok: true, remaining: 120, resetIn: 60 });
    });

    it('fails open when the INCR slot carries an error', async () => {
      response = { status: 200, body: [{ error: 'OOM' }, { result: 1 }, { result: 57 }] };
      const r = await checkRateLimit('raw:nook', { limit: 120, windowSec: 60 });
      expect(r).toEqual({ ok: true, remaining: 120, resetIn: 60 });
    });
  });

  describe('recordFailure', () => {
    it('sends INCR + EXPIRE as ONE pipeline request and returns the count', async () => {
      response = { status: 200, body: [{ result: 4 }, { result: 1 }] };
      const n = await recordFailure('login:ip:1.2.3.4', { windowSec: 900 });

      expect(calls).toHaveLength(1);
      expect(calls[0].commands).toEqual([
        ['INCR', 'rl:login:ip:1.2.3.4'],
        ['EXPIRE', 'rl:login:ip:1.2.3.4', 900],
      ]);
      expect(n).toBe(4);
    });
  });

  describe('peekRateLimit', () => {
    it('sends GET + TTL as ONE pipeline request', async () => {
      // Upstash REST returns GET values as strings
      response = { status: 200, body: [{ result: '3' }, { result: 500 }] };
      const r = await peekRateLimit('login:ip:1.2.3.4', { limit: 10, windowSec: 900 });

      expect(calls).toHaveLength(1);
      expect(calls[0].commands).toEqual([
        ['GET', 'rl:login:ip:1.2.3.4'],
        ['TTL', 'rl:login:ip:1.2.3.4'],
      ]);
      expect(r).toEqual({ ok: true, remaining: 7, resetIn: 900 });
    });

    it('over-limit: denies with retryIn from the TTL slot', async () => {
      response = { status: 200, body: [{ result: '11' }, { result: 321 }] };
      const r = await peekRateLimit('login:ip:1.2.3.4', { limit: 10, windowSec: 900 });
      expect(r).toEqual({ ok: false, retryIn: 321 });
    });

    it('missing key (null GET) → full budget', async () => {
      response = { status: 200, body: [{ result: null }, { result: -2 }] };
      const r = await peekRateLimit('login:ip:1.2.3.4', { limit: 10, windowSec: 900 });
      expect(r).toEqual({ ok: true, remaining: 10, resetIn: 900 });
    });
  });
});
