import { NextResponse } from 'next/server';
import { COOKIE_NAME } from '@/lib/auth';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  // Expire cookie by setting maxAge: 0
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
