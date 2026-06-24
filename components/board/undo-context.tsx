'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { broadcastWrite } from '@/lib/auto-sync';
import { IconAlertCircle, IconCheck, IconRefreshCw, IconX } from '@/lib/icons';

const UNDO_TTL_MS = 10000;

interface UndoSnapshot {
  /** Pre-forward job state — the undo route restores this verbatim (with a new id). */
  name: string;
  dept: string;
  staff: string;
  date: string;
  dateIn: string;
  status: string;
  orderId: number | null;
  cowork?: unknown;
}

interface UndoEntry {
  /** ID of the NEW (post-forward) job — what the undo route deletes. */
  newJobId: number;
  /** Snapshot of the old job — restored on undo. */
  snapshot: UndoSnapshot;
  /** Human-friendly destination label, shown in toast. */
  destinationLabel: string;
  /** Snapshot of the original job name — for toast text. */
  jobName: string;
  /** When the entry was created — used to drive the 10s expiry. */
  createdAt: number;
}

interface UndoState {
  /** Set after a successful admin forward. Replaces previous entry. */
  recordForward: (entry: Omit<UndoEntry, 'createdAt'>) => void;
}

const UndoContext = createContext<UndoState | null>(null);

export function UndoProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (expiryTimer.current) {
      clearTimeout(expiryTimer.current);
      expiryTimer.current = null;
    }
  }, []);

  const recordForward = useCallback(
    (e: Omit<UndoEntry, 'createdAt'>) => {
      clearTimer();
      setResultMsg(null);
      const next: UndoEntry = { ...e, createdAt: Date.now() };
      setEntry(next);
      expiryTimer.current = setTimeout(() => setEntry(null), UNDO_TTL_MS);
    },
    [clearTimer],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  async function performUndo() {
    if (!entry || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/jobs/forward-undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentJobId: entry.newJobId, snapshot: entry.snapshot }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setResultMsg({ kind: 'err', text: data?.error || `HTTP ${res.status}` });
        return;
      }
      broadcastWrite('/api/jobs/forward-undo');
      router.refresh();
      setResultMsg({ kind: 'ok', text: `กู้ "${entry.jobName}" เรียบร้อย` });
      clearTimer();
      setEntry(null);
      // Auto-hide success message after 3s
      setTimeout(() => setResultMsg(null), 3000);
    } catch (err) {
      setBusy(false);
      setResultMsg({
        kind: 'err',
        text: err instanceof Error ? err.message : 'เครือข่ายขัดข้อง',
      });
    }
  }

  function dismiss() {
    clearTimer();
    setEntry(null);
    setResultMsg(null);
  }

  const value = useMemo<UndoState>(() => ({ recordForward }), [recordForward]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {entry && <UndoToast entry={entry} busy={busy} onUndo={performUndo} onDismiss={dismiss} />}
      {resultMsg && <ResultToast msg={resultMsg} onDismiss={() => setResultMsg(null)} />}
    </UndoContext.Provider>
  );
}

export function useUndo(): UndoState {
  const ctx = useContext(UndoContext);
  if (!ctx) {
    return { recordForward: () => {} };
  }
  return ctx;
}

// ─── Toast components ─────────────────────────────────────────

function UndoToast({
  entry,
  busy,
  onUndo,
  onDismiss,
}: {
  entry: UndoEntry;
  busy: boolean;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    return Math.max(0, Math.ceil((entry.createdAt + UNDO_TTL_MS - Date.now()) / 1000));
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const remain = Math.max(0, Math.ceil((entry.createdAt + UNDO_TTL_MS - Date.now()) / 1000));
      setSecondsLeft(remain);
    }, 250);
    return () => clearInterval(interval);
  }, [entry.createdAt]);

  return (
    <div
      className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-24 md:max-w-md mx-auto md:mx-0 z-50 bg-stone-900 text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3 animate-in"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
    >
      <IconRefreshCw size={16} className="flex-shrink-0 text-stone-300" />
      <div className="flex-grow min-w-0 text-sm">
        <div className="truncate">
          ส่งต่อ &ldquo;{entry.jobName}&rdquo; → {entry.destinationLabel}
        </div>
      </div>
      <button
        type="button"
        onClick={onUndo}
        disabled={busy}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/25 text-xs font-semibold tabular-nums whitespace-nowrap disabled:opacity-50"
      >
        ↩ ย้อนกลับ <span className="text-stone-300">{secondsLeft}s</span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        disabled={busy}
        className="text-stone-400 hover:text-white p-1 rounded disabled:opacity-50"
        aria-label="ปิด"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}

function ResultToast({
  msg,
  onDismiss,
}: {
  msg: { kind: 'ok' | 'err'; text: string };
  onDismiss: () => void;
}) {
  const isOk = msg.kind === 'ok';
  return (
    <div
      className={`fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-24 md:max-w-md mx-auto md:mx-0 z-50 rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 ${
        isOk
          ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
          : 'bg-red-50 border border-red-200 text-red-800'
      }`}
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
    >
      {isOk ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
      <span className="flex-grow text-sm">{msg.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="opacity-50 hover:opacity-100 p-1"
        aria-label="ปิด"
      >
        <IconX size={14} />
      </button>
    </div>
  );
}
