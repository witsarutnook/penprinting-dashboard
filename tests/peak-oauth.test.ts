import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PEAK_REDIRECT_URI,
  PeakAuthError,
  PeakUnavailableError,
  buildAuthorizeUrl,
  exchangeCode,
  newPkce,
  refreshPeakTokens,
  registerPeakClient,
} from '@/lib/peak/oauth';

const SENTINEL = 'SENTINEL-SECRET-123';

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeFetch(res: Response | (() => Promise<Response>)) {
  return vi.fn(async (..._a: Parameters<typeof fetch>) =>
    typeof res === 'function' ? res() : res,
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function formOf(f: ReturnType<typeof fakeFetch>): URLSearchParams {
  const init = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
  return new URLSearchParams(String(init.body));
}

describe('registerPeakClient', () => {
  it('posts the DCR body and returns clientId', async () => {
    const f = fakeFetch(jsonRes(201, { client_id: 'cid-1' }));
    await expect(registerPeakClient(f)).resolves.toEqual({ clientId: 'cid-1' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://mcp.peakaccount.com/oauth/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      client_name: 'penprinting-dashboard',
      redirect_uris: [PEAK_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp:read',
    });
  });

  it('throws PeakAuthError when client_id missing', async () => {
    await expect(registerPeakClient(fakeFetch(jsonRes(201, {})))).rejects.toBeInstanceOf(
      PeakAuthError,
    );
  });

  it('maps 5xx and network failure to PeakUnavailableError', async () => {
    await expect(registerPeakClient(fakeFetch(jsonRes(500, {})))).rejects.toBeInstanceOf(
      PeakUnavailableError,
    );
    const boom = fakeFetch(() => Promise.reject(new Error('down')));
    await expect(registerPeakClient(boom)).rejects.toBeInstanceOf(PeakUnavailableError);
  });
});

describe('newPkce', () => {
  it('produces verifier, S256 challenge and state', () => {
    const a = newPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(a.challenge).toBe(createHash('sha256').update(a.verifier).digest('base64url'));
    expect(a.state.length).toBeGreaterThanOrEqual(16);
    const b = newPkce();
    expect(b.verifier).not.toBe(a.verifier);
    expect(b.state).not.toBe(a.state);
  });
});

describe('buildAuthorizeUrl', () => {
  it('carries all 7 params', () => {
    const u = new URL(buildAuthorizeUrl({ clientId: 'cid', challenge: 'chal', state: 'st' }));
    expect(u.origin + u.pathname).toBe('https://mcp.peakaccount.com/oauth/authorize');
    const p = u.searchParams;
    expect(p.get('response_type')).toBe('code');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('redirect_uri')).toBe(PEAK_REDIRECT_URI);
    expect(p.get('scope')).toBe('mcp:read');
    expect(p.get('code_challenge')).toBe('chal');
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('state')).toBe('st');
  });
});

describe('exchangeCode', () => {
  it('sends the form and maps the token set', async () => {
    const f = fakeFetch(
      jsonRes(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'mcp:read',
      }),
    );
    const out = await exchangeCode({ clientId: 'cid', code: 'cd', verifier: 'vf' }, f);
    expect(out).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresInSec: 3600,
      scope: 'mcp:read',
    });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://mcp.peakaccount.com/oauth/token');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = formOf(f);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('cd');
    expect(form.get('redirect_uri')).toBe(PEAK_REDIRECT_URI);
    expect(form.get('client_id')).toBe('cid');
    expect(form.get('code_verifier')).toBe('vf');
  });

  it('null scope when absent', async () => {
    const f = fakeFetch(jsonRes(200, { access_token: 'a', refresh_token: 'r', expires_in: 60 }));
    const out = await exchangeCode({ clientId: 'c', code: 'c', verifier: 'v' }, f);
    expect(out.scope).toBeNull();
  });
});

describe('refreshPeakTokens', () => {
  it('sends grant_type=refresh_token', async () => {
    const f = fakeFetch(
      jsonRes(200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 }),
    );
    const out = await refreshPeakTokens({ clientId: 'cid', refreshToken: 'r1' }, f);
    expect(out.refreshToken).toBe('r2');
    const form = formOf(f);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('r1');
    expect(form.get('client_id')).toBe('cid');
  });

  it('200 without refresh_token -> PeakAuthError', async () => {
    const f = fakeFetch(jsonRes(200, { access_token: 'a', expires_in: 3600 }));
    await expect(
      refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f),
    ).rejects.toBeInstanceOf(PeakAuthError);
  });
});

describe('error mapping', () => {
  it.each([400, 401])('HTTP %i -> PeakAuthError', async (status) => {
    const f = fakeFetch(jsonRes(status, { error: 'invalid_grant' }));
    const err = await refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f).catch((e) => e);
    expect(err).toBeInstanceOf(PeakAuthError);
    expect(err.message).toContain(String(status));
    expect(err.message).toContain('invalid_grant');
  });

  it.each([429, 408])('HTTP %i (rate-limit / timeout) -> PeakUnavailableError', async (status) => {
    const f = fakeFetch(jsonRes(status, { error: 'slow_down' }));
    const err = await refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f).catch((e) => e);
    expect(err).toBeInstanceOf(PeakUnavailableError);
    expect(err).not.toBeInstanceOf(PeakAuthError);
    expect(err.message).toContain(String(status));
    const r = fakeFetch(jsonRes(status, {}));
    await expect(registerPeakClient(r)).rejects.toBeInstanceOf(PeakUnavailableError);
  });

  it('HTTP 500 (JSON or not) -> PeakUnavailableError', async () => {
    const f1 = fakeFetch(jsonRes(500, { error: 'x' }));
    await expect(
      refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f1),
    ).rejects.toBeInstanceOf(PeakUnavailableError);
    const f2 = fakeFetch(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(
      refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f2),
    ).rejects.toBeInstanceOf(PeakUnavailableError);
  });

  it('fetch rejection (incl. abort) -> PeakUnavailableError', async () => {
    const f = fakeFetch(() => Promise.reject(new DOMException('timeout', 'TimeoutError')));
    await expect(
      refreshPeakTokens({ clientId: 'c', refreshToken: 'r' }, f),
    ).rejects.toBeInstanceOf(PeakUnavailableError);
  });

  it('never leaks secrets or raw body in messages', async () => {
    const cases: Array<() => Promise<unknown>> = [
      () =>
        exchangeCode(
          { clientId: 'c', code: SENTINEL, verifier: SENTINEL },
          fakeFetch(jsonRes(400, { error: 'invalid_grant', error_description: SENTINEL })),
        ),
      () =>
        refreshPeakTokens(
          { clientId: 'c', refreshToken: SENTINEL },
          fakeFetch(jsonRes(200, { access_token: SENTINEL })),
        ),
      () =>
        refreshPeakTokens(
          { clientId: 'c', refreshToken: SENTINEL },
          fakeFetch(jsonRes(500, { access_token: SENTINEL })),
        ),
      () =>
        refreshPeakTokens(
          { clientId: 'c', refreshToken: SENTINEL },
          fakeFetch(() => Promise.reject(new Error(SENTINEL))),
        ),
    ];
    for (const run of cases) {
      const err = (await run().catch((e) => e)) as Error;
      expect(err).toBeInstanceOf(Error);
      expect(String(err.message)).not.toContain(SENTINEL);
    }
  });
});

import { it as itName, expect as expectName } from 'vitest';
itName('error class names are stable (survive minification)', async () => {
  expectName(new (await import('@/lib/peak/oauth')).PeakAuthError('m').name).toBe('PeakAuthError');
  expectName(new (await import('@/lib/peak/oauth')).PeakAuthError('m')).toBeInstanceOf(Error);
  expectName(new (await import('@/lib/peak/oauth')).PeakUnavailableError('m').name).toBe('PeakUnavailableError');
  expectName(new (await import('@/lib/peak/oauth')).PeakUnavailableError('m')).toBeInstanceOf(Error);
});
