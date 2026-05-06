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

/** Manual print button (server components can't have onClick handlers). */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        padding: '4px 12px', borderRadius: 4, border: '1px solid #1e3a8a',
        background: '#1e3a8a', color: '#fff', fontWeight: 600, cursor: 'pointer',
      }}
    >
      พิมพ์
    </button>
  );
}
