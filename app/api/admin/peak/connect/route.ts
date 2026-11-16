import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { PeakConfigError, assertPeakKey } from '@/lib/peak/crypto';
import {
  buildAuthorizeUrl,
  newPkce,
  registerPeakClient,
} from '@/lib/peak/oauth';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { getPeakClientId, savePeakClient } from '@/lib/peak/token-store';

export const dynamic = 'force-dynamic';

function back(req: Request, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/peak?error=${error}`, req.url), 302);
}

/** Start the Peak OAuth flow (admin only): ensure a client, set the PKCE cookie, go to Peak. */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  // Safely off: validate the key with the real loader before any registration / DB write / redirect.
  try {
    assertPeakKey();
  } catch {
    return back(req, 'config');
  }

  try {
    let clientId = await getPeakClientId();
    if (!clientId) {
      clientId = (await registerPeakClient()).clientId;
      await savePeakClient(clientId);
    }
    const { verifier, challenge, state } = newPkce();
    const res = NextResponse.redirect(buildAuthorizeUrl({ clientId, challenge, state }), 302);
    res.cookies.set('pp_peak_oauth', JSON.stringify({ state, verifier }), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/admin/peak',
      maxAge: 600,
    });
    return res;
  } catch (err) {
    if (err instanceof PeakConfigError) return back(req, 'config');
    console.error('peak connect failed:', peakErrorLabel(err));
    return back(req, 'exchange');
  }
}
