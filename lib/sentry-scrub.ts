/**
 * Keeps request cookies, the Authorization header and the request body out of what the server
 * sends to Sentry.
 * No 'server-only': loaded by sentry.server.config.ts and sentry.edge.config.ts.
 *
 * Why (audit 2026-11-27, M3): @sentry/nextjs 10 copies the request headers onto the root span of
 * every sampled request — one attribute per cookie, `http.request.header.cookie.<name>` — and
 * masks a cookie only when its NAME contains a word from the SDK's own list (auth, session,
 * token, …). `pp_dashboard_v6`, the 30-day login cookie, matches none, so its value was sent on
 * every sampled request (20,800 spans in Sentry when counted). Error events carry the cookies in
 * their `request` block the same way.
 *
 * Nothing here depends on a cookie's name: every cookie goes. A new cookie cannot leak because
 * someone forgot to give it a "sensitive" name.
 *
 * Two more things go with them (independent review 2026-11-27):
 * - the Authorization header: the cron routes authenticate with `Bearer ${CRON_SECRET}`, and the
 *   SDK puts the request headers into the event's `request` block as they came;
 * - the request body: the SDK can attach it, and here a body is a login password, a /track PIN
 *   or a customer's LINE message. (Not seen in what production had sent when checked — the
 *   stored requests had no body — so this one is a guard, not a repair.)
 */

/** The parts of a Sentry event that can carry them. */
interface CookieBearingEvent {
  contexts?: { trace?: { data?: Record<string, unknown> } };
  spans?: Array<{ data?: Record<string, unknown> }>;
  request?: { headers?: Record<string, unknown>; cookies?: unknown; data?: unknown };
}

/** Span attributes: `http.request.header.cookie`, `…cookie.<name>`, the response's set_cookie,
 *  and (proxy_)authorization. */
const SECRET_ATTRIBUTE = /^http\.(request|response)\.header\.(cookie|set_cookie|authorization|proxy_authorization)(\.|$)/i;
/** Headers of the event's `request` block. */
const SECRET_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization)$/i;

function dropKeys(obj: Record<string, unknown> | undefined, match: RegExp): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    if (match.test(key)) delete obj[key];
  }
}

/** Removes every cookie, the Authorization header and the request body from `event` (in place)
 *  and returns it — never null: as a before-send hook it must not drop the event. */
export function scrubSentryEvent<T extends CookieBearingEvent>(event: T): T {
  dropKeys(event.contexts?.trace?.data, SECRET_ATTRIBUTE);
  if (Array.isArray(event.spans)) {
    for (const span of event.spans) dropKeys(span?.data, SECRET_ATTRIBUTE);
  }
  if (event.request && typeof event.request === 'object') {
    delete event.request.cookies;
    delete event.request.data;
    dropKeys(event.request.headers, SECRET_HEADER);
  }
  return event;
}
