// components/quote-fab.tsx
'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { IconSparkles, IconX } from '@/lib/icons';
import { QuoteAssistantClient } from '@/app/quote-assistant/quote-assistant-client';
import { shouldShowFab } from '@/lib/quote-fab-visibility';
import { subscribeBulkActive, getBulkActive } from '@/lib/bulk-mode-signal';

/** Floating launcher (admin/sales) that opens the AI Quote Assistant as a
 *  slide-over (desktop) / bottom sheet (mobile) on any dashboard page.
 *  Reuses <QuoteAssistantClient /> as-is. Hidden on /quote-assistant (full
 *  view) and on mobile while /board bulk mode is active (collision). */
export function QuoteFab({ role }: { role: string }) {
  const pathname = usePathname();
  const bulkActive = useSyncExternalStore(subscribeBulkActive, getBulkActive, () => false);
  const [open, setOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!shouldShowFab(role, pathname)) return null;

  function close() {
    setOpen(false);
    fabRef.current?.focus();
  }

  return (
    <>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30 md:bg-transparent md:pointer-events-none"
            onClick={close}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="ผู้ช่วยตีราคา (AI)"
            tabIndex={-1}
            className="fixed z-50 bg-white outline-none flex flex-col shadow-xl
                       inset-x-0 bottom-0 h-[85vh] rounded-t-2xl
                       md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[380px] md:rounded-none md:border-l md:border-stone-200"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 shrink-0">
              <span className="flex items-center gap-2 font-medium text-stone-800">
                <IconSparkles className="w-5 h-5 text-accent" />
                ผู้ช่วยตีราคา (AI)
              </span>
              <button
                onClick={close}
                aria-label="ปิด"
                className="w-11 h-11 -mr-2 flex items-center justify-center text-stone-500 hover:text-stone-800 rounded-lg"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              <QuoteAssistantClient />
            </div>
          </div>
        </>
      )}

      <button
        ref={fabRef}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'ปิดผู้ช่วยตีราคา (AI)' : 'เปิดผู้ช่วยตีราคา (AI)'}
        aria-expanded={open}
        className={`fixed right-4 bottom-[80px] md:right-6 md:bottom-6 z-40 w-14 h-14 rounded-full
                    bg-accent text-white shadow-lg flex items-center justify-center
                    hover:opacity-90 active:scale-95 transition
                    ${bulkActive ? 'max-md:hidden' : ''}`}
      >
        {open ? <IconX className="w-6 h-6" /> : <IconSparkles className="w-6 h-6" />}
      </button>
    </>
  );
}
