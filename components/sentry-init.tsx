'use client';

import * as Sentry from '@sentry/nextjs';

/**
 * Manually initializes the Sentry browser SDK.
 *
 * History (2026-05-08): @sentry/nextjs v10 dropped auto-detection of the
 * `sentry.client.config.ts` convention, and Next.js 14 doesn't load the
 * `instrumentation-client.ts` convention either (that's Next.js 15.3+).
 * Both files exist in the repo at various points in history but neither
 * one actually fires `Sentry.init()` on this stack — events never leave
 * the browser.
 *
 * The reliable workaround is to call `Sentry.init` from a 'use client'
 * module imported in `app/layout.tsx`. Module-level code in a client
 * component runs ONCE per browser session, the first time the layout
 * component renders. The `getClient()` guard makes a re-import (e.g.
 * during dev hot reload or Strict Mode double-render) idempotent.
 *
 * Disabled when DSN is missing so dev / preview / fork builds without
 * the env var don't ship a half-broken Sentry to the console.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (typeof window !== 'undefined' && DSN && !Sentry.getClient()) {
  Sentry.init({
    dsn: DSN,
    // Internal staff app — low traffic, light sampling is fine.
    tracesSampleRate: 0.1,
    release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
    // Filter out noise from browser extensions (crypto wallets etc.) that
    // inject scripts into every page and fight over `window.ethereum`.
    // Their errors aren't ours to fix and would flood the issues list.
    ignoreErrors: [
      /window\.ethereum/i,
      /redefine property/i,
      /Failed to assign ethereum proxy/i,
      /Backpack couldn't override/i,
      /Invalid property descriptor/i,
      /Cannot redefine property/i,
    ],
  });
}

/** Render-nothing component — its only job is to be a 'use client' hook
 *  point so the module-level Sentry.init runs once per browser session.
 *  Mount it inside the root layout's <body>. */
export function SentryInit(): null {
  return null;
}
