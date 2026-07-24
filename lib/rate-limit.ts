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

/** Run several Upstash commands in ONE `/pipeline` REST request
 *  (L-ratelimit-serial-upstash-hops — the limiter sits on modal opens and
 *  the AI webhook hot path, so each saved hop is 50-150ms off a user-facing
 *  wait). Returns one result slot per command; a slot is null when that
 *  command errored. Whole-request failure → null, callers fail open. */
async function upstashPipeline(
  cfg: { url: string; token: string },
  commands: (string | number)[][],
): Promise<(unknown | null)[] | null> {
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    if (!Array.isArray(body)) return null;
    return body.map((slot) => (slot && !slot.error ? slot.result ?? null : null));
  } catch {
    return null;
  }
}

/** Coerce an Upstash result slot to a finite number (REST returns GET
 *  values as strings, INCR/TTL as numbers). Null when not numeric. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
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
  // Sliding-window counter: every hit refreshes the TTL ("INCR + EXPIRE
  // every time" is idempotent on Upstash and matches their ratelimit
  // reference recipe). All three commands ride ONE /pipeline request —
  // the TTL slot is only read on the over-limit branch but costs nothing
  // extra inside the same round-trip.
  const slots = await upstashPipeline(cfg, [
    ['INCR', fullKey],
    ['EXPIRE', fullKey, opts.windowSec],
    ['TTL', fullKey],
  ]);
  const count = slots ? asNumber(slots[0]) : null;
  if (count == null) {
    return { ok: true, remaining: opts.limit, resetIn: opts.windowSec };
  }

  if (count > opts.limit) {
    const ttl = asNumber(slots![2]);
    const retryIn = ttl != null && ttl > 0 ? ttl : opts.windowSec;
    return { ok: false, retryIn };
  }

  return { ok: true, remaining: Math.max(0, opts.limit - count), resetIn: opts.windowSec };
}

/** Read-only counter check — does NOT increment. Use to decide if a
 *  caller is currently locked out before performing an action whose
 *  failure should bump the counter (via `recordFailure`). Returns ok
 *  with remaining budget, or denied if the counter has already exceeded
 *  the limit. Fails open. */
export async function peekRateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<RateLimitResult> {
  const cfg = configured();
  if (!cfg) {
    return { ok: true, remaining: opts.limit, resetIn: opts.windowSec };
  }
  const fullKey = `rl:${key}`;
  // GET + TTL in one /pipeline request — TTL read only on the over-limit
  // branch, same round-trip either way.
  const slots = await upstashPipeline(cfg, [
    ['GET', fullKey],
    ['TTL', fullKey],
  ]);
  const n = slots ? asNumber(slots[0]) : null;
  if (n == null || n <= 0) {
    return { ok: true, remaining: opts.limit, resetIn: opts.windowSec };
  }
  if (n > opts.limit) {
    const ttl = asNumber(slots![1]);
    const retryIn = ttl != null && ttl > 0 ? ttl : opts.windowSec;
    return { ok: false, retryIn };
  }
  return { ok: true, remaining: Math.max(0, opts.limit - n), resetIn: opts.windowSec };
}

/** Hand back one attempt reserved by a `checkRateLimit` gate. Pattern for
 *  atomic failure-only counting (L-track-pin-lockout-toctou): gate with
 *  checkRateLimit (INCR+compare — race-free, unlike peek-then-record),
 *  then refund on every outcome that should NOT consume budget (e.g. a
 *  correct PIN). If the counter went negative — the window expired between
 *  the INCR and this refund — delete the stray key (a TTL-less negative
 *  key would otherwise skew future windows). Fails open. */
export async function refundAttempt(key: string): Promise<void> {
  const cfg = configured();
  if (!cfg) return;
  const fullKey = `rl:${key}`;
  const n = await upstash<number>(cfg, 'DECR', fullKey);
  if (n != null && n < 0) await upstash(cfg, 'DEL', fullKey);
}

/** Increment a failure counter. Use after an action fails so subsequent
 *  `peekRateLimit` checks see the bump. Combined pattern: peek before
 *  action, recordFailure after fail, do nothing after success. Fails
 *  open. Returns the new count for logging (null on KV miss). */
export async function recordFailure(
  key: string,
  opts: { windowSec: number },
): Promise<number | null> {
  const cfg = configured();
  if (!cfg) return null;
  const fullKey = `rl:${key}`;
  // INCR + EXPIRE in one /pipeline request.
  const slots = await upstashPipeline(cfg, [
    ['INCR', fullKey],
    ['EXPIRE', fullKey, opts.windowSec],
  ]);
  return slots ? asNumber(slots[0]) : null;
}
