/**
 * Sentry init for the browser — auto-detected by Next.js v15+ (and v14
 * via the same convention) when present at the project root. Captures
 * uncaught exceptions, unhandled promise rejections, and any Sentry
 * integrations we layer on later.
 *
 * Disabled when DSN is missing so local dev doesn't ship a half-broken
 * Sentry to the console.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    tracesSampleRate: 0.1,
    // Browser-only — opt out of session replay since we don't have the
    // bundle budget for it on a small internal app.
    integrations: [],
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
