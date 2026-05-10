import 'server-only';

/**
 * Per-user rate limiter backed by Upstash Redis (Vercel Marketplace KV).
 *
 * Threat model: a logged-in user (or compromised creds) spamming
 * `/api/audit` or `/api/orders/raw/[id]` would burn Apps Script quota
 * on the Dashboard project (50K UrlFetchApp/day on a Workspace account).
 * Anonymous DDoS is already blocked by `requireSession()` returning 401
 * before ever calling Apps Script.
 *
 * Implementation: simple fixed-window counter via Upstash REST API.
 * - First hit: `INCR` returns 1 → set `EXPIRE windowSec`
 * - Subsequent hits in same window: `INCR` returns N → reject if N > limit
 *
 * No npm dependency — Vercel Marketplace's Upstash KV integration auto-injects
 * `KV_REST_API_URL` + `KV_REST_API_TOKEN` env vars when a KV store is connected
 * to the project. Without them, this module fails open (logs once, lets all
 * requests through) so dev / preview / fork builds don't break.
 *
 * To enable in production:
 *   1. Vercel project → Storage → Connect → Upstash KV → free tier
 *   2. Vercel auto-adds KV_REST_API_URL + KV_REST_API_TOKEN to all environments
 *   3. Redeploy → rate limiter activates automatically
 */

interface RateLimitOk {
  ok: true;
  remaining: number;
  resetIn: number;
}

interface RateLimitDenied {
  ok: false;
  retryIn: number;
}

export type RateLimitResult = RateLimitOk | RateLimitDenied;

let warnedMissing = false;

function configured(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    if (!warnedMissing) {
      warnedMissing = true;
      // eslint-disable-next-line no-console
      console.warn(
        '[rate-limit] KV_REST_API_URL/TOKEN missing — failing open. Connect Upstash KV via Vercel Marketplace to enable.',
      );
    }
    return null;
  }
  return { url, token };
}

/** Run an Upstash REST command. Returns null on any error so callers can
 *  fail open. We never want a transient KV outage to break the dashboard. */
async function upstash<T>(cfg: { url: string; token: string }, ...command: (string | number)[]): Promise<T | null> {
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T; error?: string };
    if (body.error) return null;
    return (body.result ?? null) as T | null;
  } catch {
    return null;
  }
}

/** Check + increment a fixed-window counter. Returns ok: true if the caller
 *  is within the limit, ok: false with retryIn (seconds) if rate-limited.
 *
 *  Fails open (returns ok: true) when KV not configured or REST call errors.
 *  This is intentional — the rate-limiter is defense-in-depth, not a
 *  primary security control. The endpoints are auth-gated either way.
 */
export async function checkRateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const cfg = configured();
  if (!cfg) {
    return { ok: true, remaining: opts.limit, resetIn: opts.windowSec };
  }

  const fullKey = `rl:${key}`;
  // Sliding-window counter: every hit refreshes the TTL. This keeps the
  // INCR + EXPIRE pair effectively atomic from the caller's standpoint —
  // even if the EXPIRE call fails on one hit, the next hit will retry it
  // before the orphan key matters. A simple "INCR + EXPIRE every time" is
  // idempotent on Upstash; cost is one extra REST hop per call but matches
  // Upstash's own ratelimit reference recipe.
  const count = await upstash<number>(cfg, 'INCR', fullKey);
  if (count == null) {
    return { ok: true, remaining: opts.limit, resetIn: opts.windowSec };
  }
  await upstash(cfg, 'EXPIRE', fullKey, opts.windowSec);

  if (count > opts.limit) {
    const ttl = await upstash<number>(cfg, 'TTL', fullKey);
    const retryIn = typeof ttl === 'number' && ttl > 0 ? ttl : opts.windowSec;
    return { ok: false, retryIn };
  }

  return { ok: true, remaining: Math.max(0, opts.limit - count), resetIn: opts.windowSec };
}
