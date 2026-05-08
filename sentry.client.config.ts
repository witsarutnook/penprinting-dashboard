/**
 * Sentry init for the browser — auto-detected by Next.js 14 + @sentry/nextjs
 * via the `sentry.client.config.ts` convention at the project root. The
 * Sentry webpack plugin injects this file into the client entry so it runs
 * before any app code on the user's browser.
 *
 * Note (2026-05-08): Used to live at `instrumentation-client.ts` — that name
 * is the Next.js 15.3+ convention. On Next.js 14 the file is silently
 * ignored, leaving `Sentry.init()` un-called and no events ever leaving the
 * browser. Pinned at `sentry.client.config.ts` until we upgrade Next.js.
 *
 * Disabled when DSN is missing so local dev / preview builds without the
 * env var don't ship a half-broken Sentry to the console.
 */
import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (DSN) {
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
