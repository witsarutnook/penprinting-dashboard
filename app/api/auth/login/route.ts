import { NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_TTL_SECONDS, lookupPassword, signSession } from '@/lib/auth';

// Auth uses Web Crypto + signed cookies — no Node-only deps. Run on Edge
// to skip the Vercel Node.js cold start (~150ms saved on the first login
// of the day, when staff first open the dashboard each morning).
export const runtime = 'edge';

/**
 * Login rate-limit via signed httpOnly cookie (auditor M-login-ratelimit-map).
 *
 * The previous in-memory Map didn't survive Vercel cold starts or work
 * across regions — a brute-forcer hitting different instances saw a
 * fresh attempt counter on every request. Cookie state is stable per
 * browser regardless of which instance handles the call. Same trick
 * /api/track/lookup uses (auditor H1).
 *
 * Window: 5 minutes / 5 attempts. Cookie scoped to /api/auth so it
 * doesn't ship to other routes. A determined attacker can clear the
 * cookie to reset their counter, but they still pay the round-trips
 * — adequate for a low-traffic internal tool.
 */
const RATE_COOKIE = 'pp_login_rl';
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

interface RateState {
  count: number;
  firstAt: number;
}

function readRate(req: Request): RateState {
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.match(new RegExp(`(?:^|; )${RATE_COOKIE}=([^;]+)`));
  if (!m) return { count: 0, firstAt: Date.now() };
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1])) as RateState;
    if (typeof parsed.count !== 'number' || typeof parsed.firstAt !== 'number') {
      return { count: 0, firstAt: Date.now() };
    }
    if (Date.now() - parsed.firstAt > ATTEMPT_WINDOW_MS) {
      return { count: 0, firstAt: Date.now() };
    }
    return parsed;
  } catch {
    return { count: 0, firstAt: Date.now() };
  }
}

function attachRateCookie(res: NextResponse, state: RateState) {
  // Cookie expires when the window does so the browser clears it on its own.
  const expires = new Date(state.firstAt + ATTEMPT_WINDOW_MS);
  res.cookies.set(RATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    expires,
    path: '/api/auth',
  });
}

function clearRateCookie(res: NextResponse) {
  res.cookies.set(RATE_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    expires: new Date(0),
    path: '/api/auth',
  });
}

export async function POST(req: Request) {
  const rate = readRate(req);
  if (rate.count >= MAX_ATTEMPTS) {
    const retryInMin = Math.ceil((ATTEMPT_WINDOW_MS - (Date.now() - rate.firstAt)) / 60000);
    const res = NextResponse.json(
      { error: `เข้าระบบผิดพลาดบ่อยเกินไป กรุณารออีก ${retryInMin} นาที` },
      { status: 429 },
    );
    attachRateCookie(res, rate);
    return res;
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    const res = NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    attachRateCookie(res, rate);
    return res;
  }
  const password = (body.password || '').trim();
  if (!password) {
    const res = NextResponse.json({ error: 'กรุณาใส่รหัสผ่าน' }, { status: 400 });
    attachRateCookie(res, rate);
    return res;
  }

  let mapping;
  try {
    mapping = lookupPassword(password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth misconfigured';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!mapping) {
    const next: RateState = { count: rate.count + 1, firstAt: rate.firstAt };
    const res = NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    attachRateCookie(res, next);
    return res;
  }

  // Successful login — clear the rate cookie so a future failed attempt
  // starts from zero.
  const cookieValue = await signSession(mapping.role, mapping.user);
  const res = NextResponse.json({ ok: true, role: mapping.role, user: mapping.user });
  res.cookies.set({
    name: COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_TTL_SECONDS,
  });
  clearRateCookie(res);
  return res;
}
