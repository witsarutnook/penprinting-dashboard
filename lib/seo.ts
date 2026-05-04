import type { Metadata } from 'next';

/**
 * SEO config สำหรับ dashboard.penprinting.co (internal app — not for public SEO)
 * Override per-page ด้วย export const metadata
 */
export const SITE_CONFIG = {
  name: 'Penprinting Dashboard',
  shortName: 'PP Dashboard',
  legalName: 'บริษัท เพ็ญพรินติ้ง จำกัด',
  description: 'Production monitoring dashboard for Penprinting (internal staff use)',
  url: 'https://dashboard.penprinting.co',
};

/** Default metadata — internal app, prefer noindex */
export const defaultMetadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    default: SITE_CONFIG.name,
    template: `%s | ${SITE_CONFIG.shortName}`,
  },
  description: SITE_CONFIG.description,
  // Internal app — keep out of search index
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};
