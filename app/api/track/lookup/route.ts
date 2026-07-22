import { NextResponse } from 'next/server';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { getBangkokToday } from '@/lib/calendar';
import type { Job, Shipped, Cancelled } from '@/lib/types';
import { buildTrackResult } from '@/lib/track-result';
import { checkRateLimit, refundAttempt } from '@/lib/rate-limit';

// Public route — no auth, no Node-specific deps. Run on Vercel's Edge
// runtime to skip Node.js cold starts (~150-300ms saved on the first
// hit of the day). Customer scanning the QR on an A4 invoice gets a
// faster TTFB. All deps are fetch + Web Crypto + cookie reads — all
// Edge-supported.
export const runtime = 'edge';

/**
 * Public order lookup (no auth) — mirrors WP page-track-order.php.
 *
 * Body: { id, pin }
 * Returns redacted order data + status + step. Hides price, spec, full
 * staff names, internal flags. Rate-limit 15/hr per browser via a
 * PLAINTEXT httpOnly cookie (auditor H1 — in-memory Map didn't survive
 * Vercel serverless cold starts; cookie state is stable across
 * instances). A tampered/cleared cookie only resets Layer 2 — Layer 1
 * (per-IP KV) and Layer 3 (per-id PIN lockout) still bound attempts. */

const RATE_COOKIE = 'pp_track_rl';
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_HITS = 15;

interface RateState {
  hits: number;
  resetAt: number;
}

function readRate(req: Request): RateState {
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.match(new RegExp(`(?:^|; )${RATE_COOKIE}=([^;]+)`));
  if (!m) return { hits: 0, resetAt: Date.now() + WINDOW_MS };
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1])) as RateState;
    if (typeof parsed.hits !== 'number' || typeof parsed.resetAt !== 'number') {
      return { hits: 0, resetAt: Date.now() + WINDOW_MS };
    }
    if (Date.now() > parsed.resetAt) {
      return { hits: 0, resetAt: Date.now() + WINDOW_MS };
    }
    return parsed;
  } catch {
    return { hits: 0, resetAt: Date.now() + WINDOW_MS };
  }
}

function attachRateCookie(res: NextResponse, state: RateState) {
  res.cookies.set(RATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    expires: new Date(state.resetAt),
    path: '/api/track',
  });
}

/** Constant-time string compare — defends against timing oracles on PIN
 *  verification. With rate-limiting above this is defense-in-depth, but
 *  it's a one-liner safety net. */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  // Layer 1 — IP-based rate limit via Upstash KV (survives cookie clearing).
  // The cookie-only rate (below) was bypassable in seconds by clearing
  // browser data; combined with a 4-digit PIN (10k space) it allowed
  // practical brute force. Upstash key is per-IP so cookie rotation
  // doesn't reset it. Fails open if KV not configured — cookie layer is
  // still in place as defense-in-depth. (Auditor A04-1 finding.)
  const ip =
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  const ipRate = await checkRateLimit(`track:ip:${ip}`, { limit: 30, windowSec: 600 });
  if (!ipRate.ok) {
    return NextResponse.json(
      { error: `ตรวจสอบจาก IP นี้บ่อยเกินไป — รออีก ${Math.ceil(ipRate.retryIn / 60)} นาที` },
      { status: 429, headers: { 'Retry-After': String(ipRate.retryIn) } },
    );
  }

  // Layer 2 — Cookie-scoped rate (kept for browsers behind shared IPs e.g.
  // office NAT). Same 15-hits-per-hour but combined with Layer 1 above.
  const rate = readRate(req);
  if (rate.hits >= MAX_HITS) {
    const minutesLeft = Math.ceil((rate.resetAt - Date.now()) / 60000);
    const res = NextResponse.json(
      { error: `พยายามตรวจสอบบ่อยเกินไป — รออีก ${minutesLeft} นาทีแล้วลองใหม่` },
      { status: 429 },
    );
    attachRateCookie(res, rate);
    return res;
  }
  // Increment for THIS request — written to the response cookie before return.
  const nextRate: RateState = { hits: rate.hits + 1, resetAt: rate.resetAt };

  // Helper to wrap the response and attach the updated rate cookie.
  const respond = (json: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(json, { status });
    attachRateCookie(res, nextRate);
    return res;
  };

  let body: { id?: string | number; pin?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const id = String(body.id || '').replace(/[^0-9]/g, '');
  const pin = String(body.pin || '').replace(/[^0-9]/g, '');
  // Allow legacy short ids (≥3 digits) — Penprinting orders pre-2020 had
  // 4-digit ids. Format validation is already strict via numeric-only regex.
  if (id.length < 3 || pin.length !== 4) {
    return respond({ error: 'เลขที่ใบสั่งงานหรือ PIN ไม่ถูกต้อง' }, 400);
  }

  // Layer 3 — Per-id PIN-failure lockout. Independent of IP/cookie: even
  // if an attacker rotates both, 5 failed PIN attempts on the SAME order
  // id within 1h lock that id out for the remainder. Atomic INCR+compare
  // gate (L-track-pin-lockout-toctou — the old peek-then-record let
  // concurrent requests slip past a stale read and only locked after the
  // 6th failure, not the 5th). The INCR *reserves* an attempt; every
  // outcome below that is NOT a wrong PIN refunds it via `refundAttempt`,
  // so only PIN failures consume the budget — same failure-only semantics
  // as before, race-free. Retrying while locked refreshes the TTL
  // (sliding lock) — acceptable: only wrong-PIN spam ever reaches that
  // state. Layer 1 (IP) + Layer 2 (cookie) still bound total attempts.
  const pinKey = `track:pin-fail:${id}`;
  const pinGate = await checkRateLimit(pinKey, { limit: 5, windowSec: 3600 });
  if (!pinGate.ok) {
    return respond(
      { error: `ใบสั่งงาน #${id} ถูกล็อกชั่วคราว (ใส่ PIN ผิดเกินกำหนด) — รออีก ${Math.ceil(pinGate.retryIn / 60)} นาที` },
      429,
    );
  }

  // Single-order lookup is much faster than loadAll for /track:
  // public users only need ONE order — ~1KB payload vs ~200KB.
  // Post §12 loadOrder() reads Postgres directly and throws
  // PostgresReadError on row-not-found — surfaces as the not-found UI.
  let lookup;
  try {
    lookup = await loadOrder(id);
  } catch (err) {
    // Not a PIN failure — refund the reserved attempt so an outage can't
    // lock a legitimate customer's order id for an hour.
    void refundAttempt(pinKey);
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return respond({ error: `ระบบเชื่อมต่อไม่ได้ — ${msg}` }, 502);
  }

  const order = lookup.order;
  if (!order) {
    void refundAttempt(pinKey); // wrong id, not a PIN failure
    return respond({ error: 'ไม่พบใบสั่งงานนี้' }, 404);
  }

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;
  const storedPin = String(raw.pin || '');
  // Constant-time PIN compare to defend against timing oracle. With the
  // rate limits above this is mostly belt-and-suspenders, but cheap.
  if (!storedPin || !timingSafeStringEqual(storedPin, pin)) {
    // PIN failure — the attempt reserved by the Layer-3 gate stays
    // consumed (no refund). Nothing else to record: the gate's INCR
    // already counted this attempt atomically.
    return respond({ error: 'PIN ไม่ถูกต้อง' }, 401);
  }

  // loadOrder returns the SINGLE most recent matching row per state. The
  // legacy loadAll path used .find() which has the same single-row semantics,
  // so behavior is preserved.
  const job = lookup.job as unknown as Job | null;
  const shipped = lookup.shipped as unknown as Shipped | null;
  const cancelled = lookup.cancelled as unknown as Cancelled | null;

  // Status/step/label + redaction. The semantic core (dept, awaiting shipment,
  // days left) comes from deriveTrackStatus — the same source the LINE Flex
  // card and the customer job list use, so all three surfaces agree.
  const result = buildTrackResult(order, job, shipped, cancelled, getBangkokToday());

  // Correct PIN — refund the reserved attempt so legitimate lookups never
  // burn lockout budget. Fire-and-forget: the response must not wait on KV.
  void refundAttempt(pinKey);
  return respond({ ok: true, result });
}
