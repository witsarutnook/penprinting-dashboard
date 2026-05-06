'use client';

import { useEffect } from 'react';

/** Triggers the browser print dialog after the page mounts.
 *  Skipped if the URL contains ?noprint=1 — useful for previewing the
 *  layout without the dialog popping up. */
export function AutoPrint() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.search.includes('noprint=1')) return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
