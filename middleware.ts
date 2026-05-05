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
  // Protect analytics + calendar + future internal routes. Public: '/', '/login', '/api/auth/*'
  matcher: ['/analytics/:path*', '/calendar/:path*'],
};
