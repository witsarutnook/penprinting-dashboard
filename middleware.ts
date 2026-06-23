import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAME, verifySession } from '@/lib/auth';

/**
 * Auth gate for protected routes. Redirects to /login?next=<original> if no
 * valid session cookie. Excludes /login and /api/auth/* (else login can't work).
 *
 * Uses Web Crypto API in lib/auth so it works on both Edge (middleware) and
 * Node (API routes) without runtime tweaks.
 */
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySession(token);
  if (session) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  // Protect every authenticated route. Each page also calls verifySession()
  // for defence-in-depth, but the matcher is the first line — without it,
  // a future page that forgets the per-page check leaks silently. Public:
  // '/', '/login', '/track', '/api/auth/*' (middleware skips routes not in
  // the matcher).
  matcher: [
    '/analytics/:path*',
    '/calendar/:path*',
    '/archive/:path*',
    '/board/:path*',
    '/orders/:path*',
    '/shipped/:path*',
    '/cancelled/:path*',
    '/quote-assistant/:path*',
    '/quote-leads/:path*',
  ],
};
