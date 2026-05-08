/**
 * Next.js instrumentation hook — auto-detected by the framework when present
 * at the project root. Runs once per server boot to wire up runtime-specific
 * Sentry config, then exposes `onRequestError` so server errors thrown during
 * the request lifecycle get captured.
 *
 * Client-side init lives in `components/sentry-init.tsx`, mounted from
 * `app/layout.tsx`. Neither `instrumentation-client.ts` (Next.js 15.3+
 * convention) nor `sentry.client.config.ts` (deprecated in @sentry/nextjs
 * v10) auto-loads on this stack — see the comment in sentry-init.tsx.
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
