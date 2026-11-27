/**
 * Sentry init for the Node.js runtime — runs inside server components,
 * route handlers, and the request lifecycle. Loaded by `instrumentation.ts`
 * when `NEXT_RUNTIME === 'nodejs'`.
 *
 * Disabled at runtime when DSN is not set, so dev / preview / forks that
 * lack the env var keep working without any error reporting.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from '@/lib/sentry-scrub';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    // Internal staff app — low traffic, light sampling is fine.
    tracesSampleRate: 0.1,
    // Surface release info if the build pipeline injects it.
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
    // No request cookie leaves the server (the SDK would send the login cookie
    // on every sampled request — see lib/sentry-scrub.ts). Keep both hooks.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}
