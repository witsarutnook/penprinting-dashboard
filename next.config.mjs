import { withSentryConfig } from '@sentry/nextjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Soften Phase 3.6 cutover (2026-05-09) — staff with /production-monitoring/*
  // bookmarks resolved to Vercel (post DNS switch) would 404 since v2 has no
  // /production-monitoring path. Redirect to /board (canonical landing).
  async redirects() {
    return [
      { source: '/production-monitoring', destination: '/board', permanent: true },
      { source: '/production-monitoring/:path*', destination: '/board', permanent: true },
    ];
  },
};

// Wrap with Sentry. The plugin still works without a DSN at runtime —
// instrumentation hooks short-circuit early — and skips source-map
// upload when SENTRY_AUTH_TOKEN is missing, so preview/fork builds
// don't break.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  // Org + project become the source-map upload target. Set in Vercel
  // Project Settings → Environment Variables.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Tunnel browser-side Sentry events through this internal route so
  // ad-blockers don't drop them. The route is created automatically.
  tunnelRoute: '/monitoring',
  // Hide source maps from the public bundle (they still upload to Sentry
  // for symbolication).
  hideSourceMaps: true,
});
