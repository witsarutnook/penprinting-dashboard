import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { scrubSentryEvent } from '@/lib/sentry-scrub';

/**
 * M3-session-cookie-to-sentry (audit 2026-11-27). @sentry/nextjs 10.56 copies the request headers
 * onto the root span of every sampled request, one attribute per cookie, and masks a cookie only
 * when its NAME looks sensitive. `pp_dashboard_v6` (the 30-day login cookie) does not, so its
 * value was sent: 20,800 spans in Sentry carried it (counted 2026-11-27). No cookie leaves the
 * server at all now — by name-independent scrubbing in the SDK's own before-send hooks.
 */

const SESSION = 'admin|nook.c2Vzc2lvbi1zaWduYXR1cmU'; // what must never be in an outgoing event
// Independent review 2026-11-27: the request block also carries the Authorization header as it
// came (the cron routes authenticate with `Bearer ${CRON_SECRET}`), and the SDK can attach the
// request body (a login password, a /track PIN, a customer's LINE message).
const BEARER = 'Bearer cron-secret-9f2c';
const PASSWORD = 'hunter2-not-a-real-one';

/** A sampled server request as the SDK hands it to beforeSendTransaction. */
function transactionEvent() {
  return {
    type: 'transaction' as const,
    transaction: 'GET /api/orders/raw/[id]',
    contexts: {
      trace: {
        trace_id: '0af7651916cd43dd8448eb211c80319c',
        span_id: 'b7ad6b7169203331',
        op: 'http.server',
        data: {
          'http.request.header.cookie.pp_dashboard_v6': SESSION,
          'http.request.header.cookie.pp_peak_oauth': '[Filtered]',
          'http.request.header.cookie': '[Filtered]',
          'http.response.header.set_cookie.pp_dashboard_v6': SESSION,
          'http.request.header.authorization': BEARER,
          'http.request.header.proxy_authorization': BEARER,
          'http.request.header.user_agent': 'Mozilla/5.0',
          'http.route': '/api/orders/raw/[id]',
        } as Record<string, unknown>,
      },
    },
    spans: [
      { span_id: 'c1', data: { 'db.system': 'postgresql', 'http.request.header.cookie.pp_dashboard_v6': SESSION } as Record<string, unknown> },
      { span_id: 'c2' },
    ],
    request: {
      url: 'https://dashboard.penprinting.co/api/orders/raw/202611151',
      headers: {
        cookie: `pp_dashboard_v6=${SESSION}`, 'Set-Cookie': `pp_dashboard_v6=${SESSION}`,
        authorization: BEARER, 'Proxy-Authorization': BEARER, 'user-agent': 'Mozilla/5.0',
      } as Record<string, string>,
      cookies: { pp_dashboard_v6: SESSION } as Record<string, string>,
      data: { password: PASSWORD } as unknown,
    },
  };
}

describe('scrubSentryEvent', () => {
  it('the login cookie is nowhere in a transaction after scrubbing', () => {
    const out = scrubSentryEvent(transactionEvent());
    expect(JSON.stringify(out)).not.toContain(SESSION);
  });

  it('the Authorization header is nowhere in it either', () => {
    expect(JSON.stringify(scrubSentryEvent(transactionEvent()))).not.toContain('cron-secret-9f2c');
  });

  it('the request body is not sent', () => {
    const out = scrubSentryEvent(transactionEvent());
    expect(JSON.stringify(out)).not.toContain(PASSWORD);
    expect(out.request).not.toHaveProperty('data');
  });

  it('every cookie attribute goes, whatever the cookie is called — masked ones too', () => {
    const data = scrubSentryEvent(transactionEvent()).contexts.trace.data;
    expect(Object.keys(data).sort()).toEqual(['http.request.header.user_agent', 'http.route']);
  });

  it('child spans lose their cookie attributes and keep the rest', () => {
    const out = scrubSentryEvent(transactionEvent());
    expect(out.spans[0].data).toEqual({ 'db.system': 'postgresql' });
    expect(out.spans[1]).toEqual({ span_id: 'c2' });
  });

  it('the request block keeps its url and other headers, without cookies', () => {
    const out = scrubSentryEvent(transactionEvent());
    expect(out.request).toEqual({
      url: 'https://dashboard.penprinting.co/api/orders/raw/202611151',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
  });

  it('the event itself is kept: scrubbing never drops it', () => {
    const out = scrubSentryEvent(transactionEvent());
    expect(out.transaction).toBe('GET /api/orders/raw/[id]');
    expect(out.contexts.trace.trace_id).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('an event with none of those parts comes back as it was', () => {
    const bare: { message: string; request?: undefined } = { message: 'boom' };
    expect(scrubSentryEvent(bare)).toEqual({ message: 'boom' });
    expect(scrubSentryEvent({ contexts: {}, spans: [], request: {} })).toEqual({ contexts: {}, spans: [], request: {} });
  });
});

// The two server-side inits must actually use it: an init without the hooks sends the cookie.
describe.each([
  ['sentry.server.config', () => import('../sentry.server.config')],
  ['sentry.edge.config', () => import('../sentry.edge.config')],
])('%s', (_name, load) => {
  const initMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    vi.doMock('@sentry/nextjs', () => ({ init: initMock }));
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/0');
  });
  afterEach(() => {
    vi.doUnmock('@sentry/nextjs');
    vi.unstubAllEnvs();
  });

  it('a transaction leaves without the login cookie', async () => {
    await load();
    const options = initMock.mock.calls[0]?.[0] as { beforeSendTransaction?: (e: unknown) => unknown } | undefined;
    expect(options?.beforeSendTransaction, 'init must set beforeSendTransaction').toBeTypeOf('function');
    const out = options!.beforeSendTransaction!(transactionEvent());
    expect(out, 'the event is still sent').not.toBeNull();
    expect(JSON.stringify(out)).not.toContain(SESSION);
  });

  it('an error event leaves without the login cookie', async () => {
    await load();
    const options = initMock.mock.calls[0]?.[0] as { beforeSend?: (e: unknown) => unknown } | undefined;
    expect(options?.beforeSend, 'init must set beforeSend').toBeTypeOf('function');
    const { request } = transactionEvent();
    const out = options!.beforeSend!({ exception: { values: [{ type: 'Error', value: 'boom' }] }, request });
    expect(out, 'the event is still sent').not.toBeNull();
    expect(JSON.stringify(out)).not.toContain(SESSION);
    expect(JSON.stringify(out)).not.toContain('cron-secret-9f2c');
    expect(JSON.stringify(out)).not.toContain(PASSWORD);
    expect(JSON.stringify(out)).toContain('boom');
  });
});
