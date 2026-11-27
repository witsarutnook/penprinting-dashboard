/**
 * Sentry init for the Edge runtime — runs inside middleware.ts and any
 * `runtime: 'edge'` route handlers. Loaded by `instrumentation.ts` when
 * `NEXT_RUNTIME === 'edge'`.
 *
 * The Edge runtime has a smaller surface — keep this lightweight.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/sentry-scrub';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.1,
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // No request cookie leaves the server (the SDK would send the login cookie
    // on every sampled request — see lib/sentry-scrub.ts). Keep both hooks.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}
