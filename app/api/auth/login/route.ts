import { NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_TTL_SECONDS, lookupPassword, signSession } from '@/lib/auth';

// Basic in-memory rate limiter — per IP, 5 failed attempts → 5 min cooldown.
// Survives within a single Vercel function instance, not across regions —
// good enough for low-traffic internal dashboard.
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const failures = new Map<string, { count: number; firstAt: number }>();

function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip: string): { allowed: boolean; retryInMin?: number } {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f) return { allowed: true };
  if (now - f.firstAt > ATTEMPT_WINDOW_MS) {
    failures.delete(ip);
    return { allowed: true };
  }
  if (f.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryInMin: Math.ceil((ATTEMPT_WINDOW_MS - (now - f.firstAt)) / 60000) };
  }
  return { allowed: true };
}

function recordFailure(ip: string) {
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || now - f.firstAt > ATTEMPT_WINDOW_MS) {
    failures.set(ip, { count: 1, firstAt: now });
  } else {
    f.count++;
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: `เข้าระบบผิดพลาดบ่อยเกินไป กรุณารออีก ${rate.retryInMin} นาที` },
      { status: 429 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const password = (body.password || '').trim();
  if (!password) {
    return NextResponse.json({ error: 'กรุณาใส่รหัสผ่าน' }, { status: 400 });
  }

  let mapping;
  try {
    mapping = lookupPassword(password);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Auth misconfigured';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  if (!mapping) {
    recordFailure(ip);
    return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
  }

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
  return res;
}
