/**
 * Next.js instrumentation hook — auto-detected by the framework when present
 * at the project root. Runs once per server boot to wire up runtime-specific
 * Sentry config, then exposes `onRequestError` so server errors thrown during
 * the request lifecycle get captured.
 *
 * Client-side init lives in `sentry.client.config.ts` (auto-detected by
 * the Sentry webpack plugin on Next.js 14). The Next.js 15.3+ alternative
 * `instrumentation-client.ts` does NOT load on 14 — kept here as a reminder
 * for future Next.js upgrade.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Next.js calls `onRequestError` for unhandled errors during the request
// lifecycle. Sentry v10 exports this as `captureRequestError`.
export { captureRequestError as onRequestError } from '@sentry/nextjs';
