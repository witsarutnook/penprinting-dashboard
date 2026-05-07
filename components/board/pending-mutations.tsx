'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

/**
 * Optimistic-UI bookkeeping for /board mutations (forward, bulk-forward,
 * reassign-to-other-staff). When a mutation kicks off, the originating
 * card is added to `hiddenIds` so it disappears from the column instantly
 * — the user sees WP-style instant feedback while the Apps Script
 * round-trip runs in the background.
 *
 * On success: caller triggers `router.refresh()` then drops the id from
 * the set. The fresh server data won't include the old id (forward → new
 * id; reassign → still has the same id but different staff), so the card
 * stays gone or reappears in the right column without a flicker.
 *
 * On failure: caller calls `unhideJob` to bring the card back + shows an
 * error toast. The rollback window is short because we keep the id in the
 * set only as long as the fetch is pending.
 *
 * Keep the API tiny — the rest of the system (auto-sync polling, drag
 * source-staff lookup, etc.) deliberately doesn't know about this
 * optimistic layer; it only affects render-time card visibility.
 */
interface PendingState {
  hiddenIds: Set<number>;
  hideJob: (id: number | string) => void;
  unhideJob: (id: number | string) => void;
}

const Ctx = createContext<PendingState>({
  hiddenIds: new Set(),
  hideJob: () => {},
  unhideJob: () => {},
});

export function PendingMutationsProvider({ children }: { children: ReactNode }) {
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const hideJob = useCallback((id: number | string) => {
    const n = Number(id);
    if (!n || !Number.isFinite(n)) return;
    setHiddenIds((prev) => {
      if (prev.has(n)) return prev;
      const next = new Set(prev);
      next.add(n);
      return next;
    });
  }, []);

  const unhideJob = useCallback((id: number | string) => {
    const n = Number(id);
    if (!n || !Number.isFinite(n)) return;
    setHiddenIds((prev) => {
      if (!prev.has(n)) return prev;
      const next = new Set(prev);
      next.delete(n);
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ hiddenIds, hideJob, unhideJob }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePendingMutations(): PendingState {
  return useContext(Ctx);
}
