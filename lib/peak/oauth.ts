import 'server-only';
import { createHash, randomBytes } from 'node:crypto';

export const PEAK_MCP_BASE = 'https://mcp.peakaccount.com';
export const PEAK_MCP_URL = 'https://mcp.peakaccount.com/mcp';
export const PEAK_REDIRECT_URI = 'https://dashboard.penprinting.co/api/admin/peak/callback';
export const PEAK_SCOPE = 'mcp:read';

const TIMEOUT_MS = 10_000;

export interface PeakTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string | null;
}

/** Peak rejected us — reconnect needed. */
export class PeakAuthError extends Error {
  // explicit: constructor.name is mangled by production minification
  name = 'PeakAuthError';
}
/** Network / 5xx / timeout — retry later. */
export class PeakUnavailableError extends Error {
  // explicit: constructor.name is mangled by production minification
  name = 'PeakUnavailableError';
}

type FetchLike = typeof fetch;

/** Only a short OAuth error code is ever echoed; never the raw body. */
function oauthCode(body: unknown): string | null {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' && /^[a-z_]{1,64}$/.test(e) ? e : null;
}

async function post(
  path: string,
  init: { headers: Record<string, string>; body: string },
  f: FetchLike,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await f(`${PEAK_MCP_BASE}${path}`, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PeakUnavailableError(`Peak ${path} unreachable`);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  // 429 (rate-limited) and 408 (request timeout) are transient: retry later,
  // never "reconnect needed" (must not raise the daily auth alert).
  if (res.status >= 500 || res.status === 429 || res.status === 408) {
    throw new PeakUnavailableError(`Peak ${path} returned ${res.status}`);
  }
  if (!res.ok) {
    const code = oauthCode(json);
    throw new PeakAuthError(`Peak ${path} rejected: ${res.status}${code ? ` ${code}` : ''}`);
  }
  if (!json || typeof json !== 'object') {
    throw new PeakAuthError(`Peak ${path} returned an unreadable response`);
  }
  return json as Record<string, unknown>;
}

export async function registerPeakClient(f: FetchLike = fetch): Promise<{ clientId: string }> {
  const json = await post(
    '/oauth/register',
    {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'penprinting-dashboard',
        redirect_uris: [PEAK_REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: PEAK_SCOPE,
      }),
    },
    f,
  );
  if (typeof json.client_id !== 'string' || !json.client_id) {
    throw new PeakAuthError('Peak registration response had no client_id');
  }
  return { clientId: json.client_id };
}

export function newPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(p: { clientId: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: PEAK_REDIRECT_URI,
    scope: PEAK_SCOPE,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
  });
  return `${PEAK_MCP_BASE}/oauth/authorize?${q.toString()}`;
}

async function tokenCall(form: Record<string, string>, f: FetchLike): Promise<PeakTokenSet> {
  const json = await post(
    '/oauth/token',
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    },
    f,
  );
  const { access_token, refresh_token, expires_in, scope } = json;
  if (
    typeof access_token !== 'string' ||
    !access_token ||
    typeof refresh_token !== 'string' ||
    !refresh_token
  ) {
    throw new PeakAuthError('Peak token response was missing access_token or refresh_token');
  }
  return {
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresInSec: typeof expires_in === 'number' ? expires_in : Number(expires_in) || 0,
    scope: typeof scope === 'string' ? scope : null,
  };
}

export function exchangeCode(
  p: { clientId: string; code: string; verifier: string },
  f: FetchLike = fetch,
): Promise<PeakTokenSet> {
  return tokenCall(
    {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: PEAK_REDIRECT_URI,
      client_id: p.clientId,
      code_verifier: p.verifier,
    },
    f,
  );
}

export function refreshPeakTokens(
  p: { clientId: string; refreshToken: string },
  f: FetchLike = fetch,
): Promise<PeakTokenSet> {
  return tokenCall(
    { grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId },
    f,
  );
}
