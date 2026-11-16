import { describe, expect, it, vi } from 'vitest';
import { PeakAuthError, PeakUnavailableError } from '@/lib/peak/oauth';
import { PeakToolError, createPeakClient, type PeakToolName } from '@/lib/peak/mcp-client';

const SENTINEL = 'SENTINEL-TOKEN-ABC123';

interface Req {
  method: string;
  headers: Record<string, string>;
  body: { id?: number; method: string; params?: Record<string, unknown> };
}
type Handler = (r: Req, n: number) => Response | Promise<Response>;

function sse(msgs: unknown[]): Response {
  const text = msgs.map((m) => `event: message\ndata: ${JSON.stringify(m)}\n\n`).join('');
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
function toolResult(text: string, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

/** Scripted server: handles initialize/initialized itself; tools/call via `onCall`. */
function server(onCall: Handler, sessionPrefix = 'sess') {
  const reqs: Req[] = [];
  let inits = 0;
  let calls = 0;
  const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const req: Req = { method: init?.method ?? 'GET', headers, body: JSON.parse(String(init?.body)) };
    reqs.push(req);
    if (req.body.method === 'initialize') {
      inits += 1;
      return json(
        200,
        { jsonrpc: '2.0', id: req.body.id, result: { protocolVersion: '2025-06-18' } },
        { 'mcp-session-id': `${sessionPrefix}-${inits}` },
      );
    }
    if (req.body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    calls += 1;
    return onCall(req, calls);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  return { f, reqs, inits: () => inits };
}

const ok = (req: Req, payload: unknown = { ok: true }) =>
  sse([{ jsonrpc: '2.0', id: req.body.id, result: toolResult(JSON.stringify(payload)) }]);

const getToken = () => vi.fn(async (_o?: { forceRefresh?: boolean }) => SENTINEL);

describe('createPeakClient', () => {
  it('parses an SSE response, picking the message whose id matches', async () => {
    const s = server((req) =>
      sse([
        { jsonrpc: '2.0', method: 'notifications/progress', params: {} },
        { jsonrpc: '2.0', id: 9999, result: toolResult('"wrong"') },
        { jsonrpc: '2.0', id: req.body.id, result: toolResult('{"a":1}') },
      ]),
    );
    const c = createPeakClient({ fetch: s.f, getToken: getToken() });
    expect(await c.call('get_quotation', { code: 'QO1' })).toEqual({ a: 1 });
  });

  it('parses a plain JSON response and joins content text parts', async () => {
    const s = server((req) =>
      json(200, {
        jsonrpc: '2.0',
        id: req.body.id,
        result: {
          content: [
            { type: 'text', text: '{"a":' },
            { type: 'text', text: '2}' },
          ],
        },
      }),
    );
    const c = createPeakClient({ fetch: s.f, getToken: getToken() });
    expect(await c.call('list_quotation', {})).toEqual({ a: 2 });
  });

  it('first call = initialize + initialized + tools/call with the right headers; second call reuses the session', async () => {
    const s = server((req) => ok(req));
    const c = createPeakClient({ fetch: s.f, getToken: getToken() });
    await c.call('get_quotation', { code: 'QO1' });
    await c.call('search_contacts', { q: 'x' });
    expect(s.inits()).toBe(1);
    expect(s.reqs.map((r) => r.body.method)).toEqual([
      'initialize',
      'notifications/initialized',
      'tools/call',
      'tools/call',
    ]);
    const [init, note, call1, call2] = s.reqs;
    expect(init.method).toBe('POST');
    expect(init.body.params).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'penprinting-dashboard', version: '1' },
    });
    expect(init.headers['mcp-session-id']).toBeUndefined();
    expect(note.body.id).toBeUndefined();
    expect(note.headers['mcp-session-id']).toBe('sess-1');
    expect(call1.body.params).toEqual({ name: 'get_quotation', arguments: { code: 'QO1' } });
    expect(call2.body.params).toEqual({ name: 'search_contacts', arguments: { q: 'x' } });
    for (const r of s.reqs) {
      expect(r.headers['content-type']).toBe('application/json');
      expect(r.headers.accept).toBe('application/json, text/event-stream');
      expect(r.headers.authorization).toBe(`Bearer ${SENTINEL}`);
      expect(r.headers['mcp-protocol-version']).toBe('2025-06-18');
    }
    expect(call2.headers['mcp-session-id']).toBe('sess-1');
  });

  it('does not share sessions across clients', async () => {
    const s = server((req) => ok(req));
    await createPeakClient({ fetch: s.f, getToken: getToken() }).call('get_quotation', {});
    await createPeakClient({ fetch: s.f, getToken: getToken() }).call('get_quotation', {});
    expect(s.inits()).toBe(2);
  });

  it('re-initialises once on 404 session-not-found and returns the retried result', async () => {
    const s = server((req, n) =>
      n === 1
        ? json(404, { error: { code: -32001, message: 'Session not found' } })
        : ok(req, { v: 7 }),
    );
    const c = createPeakClient({ fetch: s.f, getToken: getToken() });
    expect(await c.call('get_quotation', {})).toEqual({ v: 7 });
    expect(s.inits()).toBe(2);
    const lastCall = s.reqs.filter((r) => r.body.method === 'tools/call').pop()!;
    expect(lastCall.headers['mcp-session-id']).toBe('sess-2');
  });

  it('404 three times in a row -> PeakUnavailableError', async () => {
    const s = server(() => json(404, { error: { code: -32001, message: 'Session not found' } }));
    const c = createPeakClient({ fetch: s.f, getToken: getToken() });
    await expect(c.call('get_quotation', {})).rejects.toBeInstanceOf(PeakUnavailableError);
    expect(s.inits()).toBeLessThanOrEqual(3);
  });

  it('401 -> forceRefresh once, retried with the new bearer; second 401 -> PeakAuthError', async () => {
    const gt = vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? 'new-tok' : 'old-tok'));
    const s = server((req) =>
      req.headers.authorization === 'Bearer new-tok' ? ok(req) : json(401, { error: 'invalid_token' }),
    );
    const c = createPeakClient({ fetch: s.f, getToken: gt });
    expect(await c.call('get_quotation', {})).toEqual({ ok: true });
    expect(gt.mock.calls.filter((a) => a[0]?.forceRefresh).length).toBe(1);

    const s2 = server(() => json(401, { error: 'invalid_token' }));
    const gt2 = vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? 'b' : 'a'));
    const c2 = createPeakClient({ fetch: s2.f, getToken: gt2 });
    await expect(c2.call('get_quotation', {})).rejects.toBeInstanceOf(PeakAuthError);
    expect(gt2.mock.calls.filter((a) => a[0]?.forceRefresh).length).toBe(1);
  });

  it('result.isError -> PeakToolError; non-JSON text -> PeakToolError', async () => {
    const s = server((req) =>
      sse([{ jsonrpc: '2.0', id: req.body.id, result: toolResult('boom', true) }]),
    );
    await expect(
      createPeakClient({ fetch: s.f, getToken: getToken() }).call('get_quotation', {}),
    ).rejects.toBeInstanceOf(PeakToolError);

    const s2 = server((req) =>
      sse([{ jsonrpc: '2.0', id: req.body.id, result: toolResult('not json at all') }]),
    );
    await expect(
      createPeakClient({ fetch: s2.f, getToken: getToken() }).call('get_quotation', {}),
    ).rejects.toBeInstanceOf(PeakToolError);
  });

  it('HTTP 500 / fetch rejects / timeout -> PeakUnavailableError', async () => {
    const s = server(() => new Response('oops', { status: 500 }));
    await expect(
      createPeakClient({ fetch: s.f, getToken: getToken() }).call('get_quotation', {}),
    ).rejects.toBeInstanceOf(PeakUnavailableError);

    const rejecting = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    await expect(
      createPeakClient({ fetch: rejecting, getToken: getToken() }).call('get_quotation', {}),
    ).rejects.toBeInstanceOf(PeakUnavailableError);

    const hanging = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    await expect(
      createPeakClient({ fetch: hanging, getToken: getToken(), timeoutMs: 20 }).call('get_quotation', {}),
    ).rejects.toBeInstanceOf(PeakUnavailableError);
  });

  it('a tool name outside the union throws before any fetch or token read', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    const gt = getToken();
    const c = createPeakClient({ fetch: f, getToken: gt });
    await expect(c.call('create_quotation' as PeakToolName, {})).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
    expect(gt).not.toHaveBeenCalled();
  });

  it('never leaks the bearer token into thrown messages', async () => {
    const cases: Array<[string, Handler]> = [
      ['500', () => new Response(`echo ${SENTINEL}`, { status: 500 })],
      ['401', () => json(401, { error: SENTINEL })],
      ['404', () => json(404, { error: { message: SENTINEL } })],
      ['isError', (req) => sse([{ jsonrpc: '2.0', id: req.body.id, result: toolResult(SENTINEL, true) }])],
      ['nonjson', (req) => sse([{ jsonrpc: '2.0', id: req.body.id, result: toolResult(SENTINEL) }])],
      ['rpcerror', (req) => json(200, { jsonrpc: '2.0', id: req.body.id, error: { code: -1, message: SENTINEL } })],
    ];
    for (const [label, h] of cases) {
      const s = server(h);
      const err = await createPeakClient({ fetch: s.f, getToken: getToken() })
        .call('get_quotation', {})
        .then(() => null, (e: unknown) => e);
      expect(err, label).toBeInstanceOf(Error);
      expect(String((err as Error).message), label).not.toContain(SENTINEL);
    }
    const rejecting = vi.fn(async () => {
      throw new TypeError(`Authorization: Bearer ${SENTINEL}`);
    }) as unknown as typeof fetch;
    const err = await createPeakClient({ fetch: rejecting, getToken: getToken() })
      .call('get_quotation', {})
      .then(() => null, (e: unknown) => e);
    expect(String((err as Error).message)).not.toContain(SENTINEL);
  });
});

import { it as itName, expect as expectName } from 'vitest';
itName('error class names are stable (survive minification)', async () => {
  expectName(new (await import('@/lib/peak/mcp-client')).PeakToolError('m').name).toBe('PeakToolError');
  expectName(new (await import('@/lib/peak/mcp-client')).PeakToolError('m')).toBeInstanceOf(Error);
});
