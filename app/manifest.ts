import type { MetadataRoute } from 'next';

/** PWA manifest — lets iPad/Android install the dashboard as a standalone
 *  app. On iOS this (together with the `appleWebApp` metadata in lib/seo.ts)
 *  makes the home-screen icon a real installed web app, so iOS gives it a
 *  stable, persistent storage container. Before this, the home-screen clip
 *  had no manifest → iOS treated it as a throwaway bookmark and evicted its
 *  cookie jar on app-switch, forcing staff to re-login every time they
 *  switched away and came back.
 *
 *  Next.js serves this at /manifest.webmanifest and auto-injects
 *  <link rel="manifest"> into <head>. Icons live in public/icons/. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Penprinting Dashboard',
    short_name: 'PP Dashboard',
    description: 'Production monitoring dashboard for Penprinting (internal staff use)',
    start_url: '/board',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#c8553d',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
