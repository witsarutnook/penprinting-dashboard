'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { IconSparkles, IconX } from '@/lib/icons';
import { QuoteAssistantClient } from '@/app/quote-assistant/quote-assistant-client';

/** Floating AI-quote assistant — a FAB (bottom-right) that opens the quote
 *  chat in a popup panel from any dashboard page, à la PEAK Support's chat
 *  bubble. Reuses <QuoteAssistantClient/> verbatim (in `compact` layout).
 *
 *  Mounted by DashboardShell, gated to admin (gating lives there). Hidden on
 *  /quote-assistant itself so we never run two live chats on one screen. */
export function AiQuoteWidget() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close on Esc while the panel is open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The dedicated page already hosts the full assistant — don't double it.
  if (pathname === '/quote-assistant') return null;

  return (
    <>
      {/* Popup panel */}
      {open && (
        <div
          role="dialog"
          aria-label="ผู้ช่วยตีราคา AI"
          className="fixed z-40 inset-x-3 bottom-36 sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[400px] max-h-[78vh] flex flex-col rounded-2xl border border-stone-200 bg-stone-50 shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-stone-200 bg-white">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
              <IconSparkles size={16} className="text-accent" />
              ผู้ช่วยตีราคา (AI)
            </h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="ปิด"
              className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            >
              <IconX size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <QuoteAssistantClient compact />
          </div>
        </div>
      )}

      {/* FAB — sits above the mobile bottom-nav (h-16); no nav on md+ */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'ปิดผู้ช่วยตีราคา' : 'เปิดผู้ช่วยตีราคา (AI)'}
        aria-expanded={open}
        className="fixed z-40 bottom-20 md:bottom-6 right-4 md:right-6 w-14 h-14 rounded-full bg-accent text-white shadow-lg flex items-center justify-center hover:bg-accent-dark active:scale-95 transition-transform"
      >
        {open ? <IconX size={24} /> : <IconSparkles size={24} />}
      </button>
    </>
  );
}
