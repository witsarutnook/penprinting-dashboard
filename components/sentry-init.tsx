'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Manually initializes the Sentry browser SDK from a `useEffect`.
 *
 * History (2026-05-08): five layers of silent failure on the way to
 * working Sentry on this stack — each looked correct in isolation:
 *
 * 1. `instrumentation-client.ts` — Next.js 15.3+ convention; Next.js 14
 *    silently ignores it. Build still uploaded sourcemaps so it looked OK.
 * 2. `sentry.client.config.ts` — legacy convention; @sentry/nextjs v10
 *    dropped auto-loading. File sat at root but webpack plugin no longer
 *    threaded it into the client entry.
 * 3. Module-level `Sentry.init()` in this 'use client' file — DSN literal
 *    made it into the `layout-*.js` chunk (verified via Sources search)
 *    but the top-level side effect never ran at runtime. Likely a quirk
 *    of how Next.js 14 evaluates 'use client' modules.
 * 4. `NEXT_PUBLIC_SENTRY_DSN` marked Sensitive in Vercel — Vercel doesn't
 *    inline Sensitive vars into the client bundle, so DSN was undefined
 *    in the browser even after rebuild. Sourcemap upload still worked
 *    because that's a server-side step using `SENTRY_AUTH_TOKEN`.
 * 5. (this file): call `Sentry.init` from `useEffect`. React guarantees
 *    the effect fires after first mount; DSN reads, init runs, default
 *    integrations attach (`BrowserApiErrors`, `GlobalHandlers`, etc.).
 *    Trade-off: errors thrown during initial render aren't captured
 *    client-side. Rare on this staff dashboard; the server Sentry
 *    instance catches API errors regardless.
 *
 * Disabled when DSN is missing so dev / preview / fork builds don't ship
 * a half-broken Sentry to the console.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function SentryInit(): null {
  useEffect(() => {
    if (!DSN) return;
    if (Sentry.getClient()) return; // idempotent — re-mounts in dev / Strict Mode
    Sentry.init({
      dsn: DSN,
      // Internal staff app — low traffic, light sampling is fine.
      tracesSampleRate: 0.1,
      release: process.env.NEXT_PUBLIC_APP_VERSION || undefined,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'development',
      // Filter out noise from browser extensions (crypto wallets etc.)
      // that inject scripts into every page and fight over `window.ethereum`.
      // Their errors aren't ours to fix and would flood the issues list.
      ignoreErrors: [
        /window\.ethereum/i,
        /redefine property/i,
        /Failed to assign ethereum proxy/i,
        /Backpack couldn't override/i,
        /Invalid property descriptor/i,
        /Cannot redefine property/i,
        // Browser extension content scripts whose context got invalidated
        // (extension updated/disabled mid-page). chrome.runtime becomes undefined
        // and any .sendMessage call throws — not our code, not our bug.
        /Cannot read propert(y|ies) of undefined \(reading ['"]sendMessage['"]\)/i,
        /Extension context invalidated/i,
      ],
    });
  }, []);
  return null;
}
