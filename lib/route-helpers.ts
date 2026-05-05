import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COOKIE_NAME, verifySession, type Session } from './auth';

type Role = Session['role'];

/** Verify cookie-based session. Returns Session if valid, else returns a
 *  401/403 NextResponse that the caller should return as-is. */
export async function requireSession(allowedRoles?: Role[]): Promise<Session | NextResponse> {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (allowedRoles && !allowedRoles.includes(session.role)) {
    return NextResponse.json(
      { error: `Forbidden — ต้องเป็น ${allowedRoles.join(' หรือ ')}` },
      { status: 403 },
    );
  }
  return session;
}

/** Format a date as DD/MM/YYYY (Bangkok TZ — server runs UTC) */
export function formatThaiDate(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return fmt.format(d);
}
