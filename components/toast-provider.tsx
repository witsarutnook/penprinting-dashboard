'use client';

import {
  createContext, useCallback, useContext, useMemo, useRef, useState,
} from 'react';
import { IconCheck, IconAlertCircle, IconAlertTriangle, IconX } from '@/lib/icons';

type ToastKind = 'info' | 'success' | 'error' | 'warn';
const DEFAULT_TTL_MS = 3500;

interface ToastEntry {
  id: number;
  kind: ToastKind;
  text: string;
  createdAt: number;
}

interface ToastApi {
  /** Show a status pill at bottom-center. WP-style — short, dismissable. */
  show: (text: string, kind?: ToastKind, ttlMs?: number) => void;
  /** Convenience helpers */
  success: (text: string, ttlMs?: number) => void;
  error: (text: string, ttlMs?: number) => void;
  warn: (text: string, ttlMs?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (text: string, kind: ToastKind = 'info', ttlMs = DEFAULT_TTL_MS) => {
      idRef.current += 1;
      const id = idRef.current;
      const entry: ToastEntry = { id, kind, text, createdAt: Date.now() };
      setToasts((list) => [...list, entry].slice(-3)); // cap at 3 visible
      setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (t, ttl) => show(t, 'success', ttl),
    error: (t, ttl) => show(t, 'error', ttl ?? 5000),
    warn: (t, ttl) => show(t, 'warn', ttl),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed left-1/2 -translate-x-1/2 bottom-20 md:bottom-8 z-[60] flex flex-col items-center gap-2 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {toasts.map((t) => (
          <ToastPill key={t.id} entry={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback no-op so callers don't crash if Provider missing.
    return { show: () => {}, success: () => {}, error: () => {}, warn: () => {} };
  }
  return ctx;
}

// ─── Toast pill ───────────────────────────────────────────

function ToastPill({
  entry, onDismiss,
}: { entry: ToastEntry; onDismiss: () => void }) {
  const styles = STYLES[entry.kind];
  return (
    <div
      role="status"
      className={`pointer-events-auto inline-flex items-center gap-2.5 max-w-[92vw] sm:max-w-md
        rounded-full shadow-2xl px-4 py-2.5 text-sm font-medium ${styles.bg} ${styles.text}`}
    >
      <span className="flex-shrink-0">{styles.icon}</span>
      <span className="flex-grow truncate" title={entry.text}>{entry.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="ปิด"
        className={`flex-shrink-0 -mr-1 w-9 h-9 inline-flex items-center justify-center rounded-full ${styles.dismiss}`}
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

const STYLES: Record<ToastKind, { bg: string; text: string; dismiss: string; icon: React.ReactNode }> = {
  info: {
    bg: 'bg-stone-900/95 backdrop-blur',
    text: 'text-white',
    dismiss: 'text-stone-400 hover:text-white hover:bg-white/10',
    icon: <span aria-hidden="true" className="inline-block w-4 h-4 rounded-full bg-sky-400" />,
  },
  success: {
    bg: 'bg-emerald-600',
    text: 'text-white',
    dismiss: 'text-emerald-200 hover:text-white hover:bg-white/15',
    icon: <IconCheck size={14} />,
  },
  warn: {
    bg: 'bg-amber-500',
    text: 'text-amber-950',
    dismiss: 'text-amber-900 hover:text-black hover:bg-black/10',
    icon: <IconAlertTriangle size={14} />,
  },
  error: {
    bg: 'bg-red-600',
    text: 'text-white',
    dismiss: 'text-red-200 hover:text-white hover:bg-white/15',
    icon: <IconAlertCircle size={14} />,
  },
};
