'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Manually initializes the Sentry browser SDK from a `useEffect`.
 *
 * History (2026-05-08):
 * 1. Started with `instrumentation-client.ts` (Next.js 15.3+ convention).
 *    Next.js 14 silently ignored it — Sentry.init never ran. Fixed in 212bb7a.
 * 2. Tried `sentry.client.config.ts` (legacy convention). @sentry/nextjs v10
 *    dropped auto-loading of this file — also never ran. Fixed in f299dc9.
 * 3. Tried module-level `Sentry.init()` in this 'use client' file. The DSN
 *    literal made it into `layout-*.js` chunk (verified via Sources search)
 *    but the module's top-level side effect never executed at runtime —
 *    `window.__SENTRY__[version]` had only default scopes, no `acs`, no
 *    client. Likely a Next.js 14 + 'use client' module evaluation quirk.
 * 4. Final approach (this file): call `Sentry.init` from `useEffect`.
 *    React guarantees the effect fires after first mount — DSN is read,
 *    init configures the SDK, global error handlers attach. Trade-off:
 *    errors thrown during initial render aren't captured (rare on a
 *    staff dashboard; the server-side Sentry catches API errors anyway).
 *
 * Disabled when DSN is missing so dev / preview / fork builds don't ship
 * a half-broken Sentry to the console.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

// Module-eval debug — survives until we know init works
// eslint-disable-next-line no-console
console.log('[Sentry][debug] module loaded, DSN:', DSN ? `present (${DSN.slice(0, 30)}…)` : 'MISSING');

export function SentryInit(): null {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[Sentry][debug] useEffect fired, DSN:', DSN ? 'present' : 'MISSING', 'existing client:', Sentry.getClient() ? 'YES' : 'NO');
    if (!DSN) return;
    if (Sentry.getClient()) return; // idempotent — re-mounts in dev / Strict Mode
    // eslint-disable-next-line no-console
    console.log('[Sentry][debug] calling Sentry.init...');
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
      ],
    });
    // eslint-disable-next-line no-console
    console.log('[Sentry][debug] Sentry.init returned, client:', Sentry.getClient());
  }, []);
  return null;
}
