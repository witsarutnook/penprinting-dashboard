import { NextResponse } from 'next/server';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { displayDate } from '@/lib/jobs';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, type Urgency } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';
import type { Job, Shipped, Cancelled } from '@/lib/types';
import { checkRateLimit, peekRateLimit, recordFailure } from '@/lib/rate-limit';

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
 * staff names, internal flags. Rate-limit 15/hr per browser via signed
 * cookie (auditor H1 — in-memory Map didn't survive Vercel serverless
 * cold starts; cookie state is stable across instances). */

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

function maskName(name: string): string {
  const s = (name || '').trim();
  if (!s) return '-';
  if (s.length <= 2) return s;
  return s.slice(0, 2) + '•'.repeat(Math.max(1, s.length - 2));
}

interface TrackResult {
  orderId: number;
  name: string;
  customerMasked: string;
  dateIn: string;
  dateDue: string;
  status: 'cancelled' | 'shipped' | 'in_progress' | 'received';
  /** Status pill label — e.g. "อยู่ระหว่างพิมพ์", "จัดส่งเรียบร้อยแล้ว". */
  statusLabel: string;
  step: string;             // "กราฟิก", "พิมพ์", "หลังพิมพ์/จัดส่ง", "ยกเลิก", "จัดส่งแล้ว"
  /** Current dept of the active job — drives the 6-step progress UI on
   *  the client. null when received-but-no-job-yet, shipped, or cancelled. */
  currentDept: 'graphic' | 'print' | 'post' | null;
  daysHint: string;         // "เหลือ Xว", "ส่งวันนี้", "เกิน Xว"
  urgencyKey: Urgency | 'shipped' | 'cancelled' | 'received';
  shippedDate?: string;
  cancelReason?: string;
}

function deptStepLabel(dept: string, staff: string): string {
  const d = (DEPT_LABELS as Record<string, string>)[dept] || dept;
  // Mask staff to first 2 chars to keep names somewhat private
  const def = (STAFF as Record<string, Array<{ id: string; name: string }>>)[dept]?.find(
    (s) => s.id === staff,
  );
  const staffName = def ? def.name : staff;
  return `${d} (${maskName(staffName)})`;
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
  // id within 1h lock that id out for the remainder. The 4-digit PIN
  // space (10k) means ~5 guesses with effectively 0 hit-rate per attempt
  // before being locked out. PEEK here so a legitimate lookup with the
  // correct PIN doesn't burn the counter — only `recordFailure` below on
  // PIN mismatch increments. (Auditor A04-1.)
  const pinLockState = await peekRateLimit(`track:pin-fail:${id}`, { limit: 5, windowSec: 3600 });
  if (!pinLockState.ok) {
    return respond(
      { error: `ใบสั่งงาน #${id} ถูกล็อกชั่วคราว (ใส่ PIN ผิดเกินกำหนด) — รออีก ${Math.ceil(pinLockState.retryIn / 60)} นาที` },
      429,
    );
  }

  // Single-order lookup is much faster than loadAll for /track:
  // public users only need ONE order — ~1KB payload vs ~200KB.
  // loadOrder() is Postgres-first with built-in Apps Script fallback
  // (throws PostgresStaleError on row-not-found → falls through). The
  // pre-2026-05-12 retry-with-revalidate-0 to "force Apps Script direct"
  // is no longer needed — the fallback now happens inside loadOrder
  // itself, so retrying buys nothing. (Auditor M1 finding.)
  let lookup;
  try {
    lookup = await loadOrder(id, { revalidate: 30 });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return respond({ error: `ระบบเชื่อมต่อไม่ได้ — ${msg}` }, 502);
  }

  const order = lookup.order;
  if (!order) {
    return respond({ error: 'ไม่พบใบสั่งงานนี้' }, 404);
  }

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;
  const storedPin = String(raw.pin || '');
  // Constant-time PIN compare to defend against timing oracle. With the
  // rate limits above this is mostly belt-and-suspenders, but cheap.
  if (!storedPin || !timingSafeStringEqual(storedPin, pin)) {
    // Record the PIN failure so the per-id lockout (Layer 3 above) sees
    // it on subsequent attempts. Fire-and-forget — even if Upstash is
    // down we return 401 immediately so the user sees a fast response.
    void recordFailure(`track:pin-fail:${id}`, { windowSec: 3600 });
    return respond({ error: 'PIN ไม่ถูกต้อง' }, 401);
  }

  // loadOrder returns the SINGLE most recent matching row per state. The
  // legacy loadAll path used .find() which has the same single-row semantics,
  // so behavior is preserved.
  const jobMatch = lookup.job as unknown as Job | null;
  const shippedMatch = lookup.shipped as unknown as Shipped | null;
  const cancelledMatch = lookup.cancelled as unknown as Cancelled | null;

  // Status label = current step name, matching WP wording exactly so the
  // 6-step progress bar on the client is consistent with the badge.
  const STATUS_BY_DEPT: Record<string, string> = {
    graphic: 'กราฟิกกำลังดำเนินการ',
    print:   'อยู่ระหว่างพิมพ์',
    post:    'ขั้นตอนหลังพิมพ์',
  };

  let status: TrackResult['status'];
  let statusLabel = '';
  let step = '';
  let daysHint = '';
  let urgencyKey: TrackResult['urgencyKey'] = 'received';
  let currentDept: TrackResult['currentDept'] = null;

  if (cancelledMatch) {
    status = 'cancelled';
    statusLabel = 'ยกเลิก';
    step = 'ยกเลิก';
    urgencyKey = 'cancelled';
  } else if (shippedMatch) {
    status = 'shipped';
    statusLabel = 'จัดส่งเรียบร้อยแล้ว';
    step = 'จัดส่งแล้ว';
    urgencyKey = 'shipped';
  } else if (jobMatch) {
    status = 'in_progress';
    const dept = String(jobMatch.dept || '');
    currentDept = (dept === 'graphic' || dept === 'print' || dept === 'post') ? dept : null;
    if (currentDept) {
      // Standard happy path — known dept drives both badge + 6-step UI.
      step = deptStepLabel(jobMatch.dept, jobMatch.staff);
      statusLabel = STATUS_BY_DEPT[dept];
      const due = parseDateDMY(jobMatch.date);
      const today = getBangkokToday();
      const u = computeUrgency(due, today);
      urgencyKey = u;
      if (due) {
        const days = Math.floor((due.getTime() - today.getTime()) / 86400000);
        if (days < 0) daysHint = `เลยกำหนด ${Math.abs(days)} วัน`;
        else if (days === 0) daysHint = 'กำหนดส่งวันนี้';
        else daysHint = `เหลืออีก ${days} วัน`;
      }
    } else {
      // Auditor M4 (2026-05-08): job.dept is empty/unknown (e.g. archive
      // ingestion oddity, manual Sheet edit). Don't show "overdue" red
      // alongside an empty 6-step timeline — the customer would see a
      // contradiction (urgent + nothing-in-progress). Force a benign
      // "received" state so badge + steps stay internally consistent.
      step = 'รับใบสั่งงาน';
      statusLabel = 'รับใบสั่งงานแล้ว';
      urgencyKey = 'received';
    }
  } else {
    status = 'received';
    statusLabel = 'รับใบสั่งงานแล้ว';
    step = 'รับใบสั่งงาน';
    urgencyKey = 'received';
  }

  const result: TrackResult = {
    orderId: Number(order.id),
    name: String(order.name || '-'),
    customerMasked: maskName(String(order.customer || '')),
    dateIn: displayDate(order.dateIn),
    dateDue: displayDate(order.dateDue),
    status,
    statusLabel,
    step,
    currentDept,
    daysHint,
    urgencyKey,
    shippedDate: shippedMatch ? displayDate(shippedMatch.shippedDate) : undefined,
    cancelReason: cancelledMatch ? String(cancelledMatch.reason || '') : undefined,
  };

  return respond({ ok: true, result });
}

// Allow Dept import to satisfy ts; suppress unused complaints
void (null as Dept | null);
