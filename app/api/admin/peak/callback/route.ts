import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { PeakConfigError } from '@/lib/peak/crypto';
import { exchangeCode } from '@/lib/peak/oauth';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { getPeakClientId, recordPeakOk, savePeakTokens } from '@/lib/peak/token-store';

export const dynamic = 'force-dynamic';

const COOKIE = 'pp_peak_oauth';

function readCookie(req: Request): { state: string; verifier: string } | null {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== COOKIE) continue;
    try {
      const v = JSON.parse(decodeURIComponent(part.slice(i + 1).trim())) as Record<string, unknown>;
      if (typeof v.state === 'string' && v.state && typeof v.verifier === 'string' && v.verifier) {
        return { state: v.state, verifier: v.verifier };
      }
    } catch {
      return null;
    }
  }
  return null;
}

/** Redirect to /peak?<query> and always clear the one-shot PKCE cookie. */
function done(req: Request, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/peak?${query}`, req.url), 302);
  res.cookies.set(COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/api/admin/peak',
    maxAge: 0,
  });
  return res;
}

/** OAuth redirect target (admin only). Nothing secret ever goes into a redirect URL. */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const params = new URL(req.url).searchParams;
  const saved = readCookie(req);

  if (params.get('error')) return done(req, 'error=denied');

  const code = params.get('code');
  if (!saved || !code || params.get('state') !== saved.state) return done(req, 'error=state');

  try {
    const clientId = await getPeakClientId();
    if (!clientId) return done(req, 'error=state');
    const tokens = await exchangeCode({ clientId, code, verifier: saved.verifier });
    await savePeakTokens(tokens);
    await recordPeakOk();
    return done(req, 'connected=1');
  } catch (err) {
    if (err instanceof PeakConfigError) return done(req, 'error=config');
    console.error('peak callback failed:', peakErrorLabel(err));
    return done(req, 'error=exchange');
  }
}
