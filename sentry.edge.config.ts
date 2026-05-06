/**
 * Sentry init for the Edge runtime — runs inside middleware.ts and any
 * `runtime: 'edge'` route handlers. Loaded by `instrumentation.ts` when
 * `NEXT_RUNTIME === 'edge'`.
 *
 * The Edge runtime has a smaller surface — keep this lightweight.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.1,
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}
