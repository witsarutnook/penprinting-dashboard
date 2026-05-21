'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { BoardJob } from '@/lib/board';

/**
 * Optimistic-UI bookkeeping for /board mutations (forward, bulk-forward,
 * reassign, ship, cancel). Two states are tracked:
 *
 * 1. `hiddenIds` — job ids that should be filtered out of column rendering.
 *    Used when the SOURCE row should disappear instantly (forward, reassign,
 *    ship, cancel). Cleared after `router.refresh()` lands the new data.
 *
 * 2. `pendingInserts` — phantom job objects to render in destination columns
 *    while the Apps Script round-trip is still in flight. Without this, the
 *    user sees a 2-3s gap between source-card-disappears and dest-card-appears.
 *    Phantoms use a NEGATIVE id so they never collide with real ids; the
 *    Card component renders them like normal cards (urgency, name, dates all
 *    derived from the source snapshot we passed in).
 *
 * On success: caller triggers `router.refresh()`, then on a short timeout
 * (~500ms — long enough for the SSR re-render to land) clears both the
 * hidden id and the phantom. State updates batch so the user sees the real
 * card replace the phantom in a single render.
 *
 * On failure: caller calls `unhideJob` + `removePendingInsert` immediately
 * and surfaces an error toast.
 *
 * Why phantoms instead of mutating a client-side `jobs[]` mirror (WP-style):
 * keeping the SSR-rendered server data as the source of truth means a tab
 * coming online via auto-sync polling sees real data, not stale local
 * mutations. Phantoms are explicitly visual-only.
 */
interface PendingInsertEntry {
  tempId: number;
  job: BoardJob;
  destDept: string;
  destStaff: string;
}

interface PendingState {
  hiddenIds: Set<number>;
  pendingInserts: PendingInsertEntry[];
  hideJob: (id: number | string) => void;
  unhideJob: (id: number | string) => void;
  /** Returns the tempId so the caller can match removePendingInsert. */
  addPendingInsert: (input: { job: BoardJob; destDept: string; destStaff: string }) => number;
  removePendingInsert: (tempId: number) => void;
  /**
   * Refresh server data and queue a cleanup that fires AFTER the new data
   * has streamed in (Next.js soft-navigation transition completes). Use
   * this on the success path of a mutation so the phantom + hidden flag
   * stay in place until the real card is rendered — prevents the source
   * row from briefly bouncing back when SSR is slower than the previous
   * fixed `setTimeout` budget.
   */
  commit: (cleanup: () => void) => void;
}

const Ctx = createContext<PendingState>({
  hiddenIds: new Set(),
  pendingInserts: [],
  hideJob: () => {},
  unhideJob: () => {},
  addPendingInsert: () => 0,
  removePendingInsert: () => {},
  commit: () => {},
});

/**
 * @param pollNow  Delta-fetch trigger (from `useDeltaSync`). When provided
 *   (Delta-fetch P3, `NEXT_PUBLIC_DELTA_FETCH` on), `commit()` polls the
 *   delta endpoint instead of `router.refresh()` — see `commit` below.
 *   Omitted on the legacy server-rendered path → `router.refresh()`.
 */
export function PendingMutationsProvider({
  children,
  pollNow,
}: {
  children: ReactNode;
  pollNow?: (() => Promise<void>) | null;
}) {
  const router = useRouter();
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [pendingInserts, setPendingInserts] = useState<PendingInsertEntry[]>([]);
  // Counter for monotonically-decreasing tempIds — avoids collisions even if
  // two phantoms are added in the same millisecond.
  const tempIdCounter = useRef(0);
  // Single shared transition wraps every router.refresh() — isPending stays
  // true until the new SSR snapshot has actually streamed in. Cleanup
  // callbacks queued via `commit()` fire only after the transition ends,
  // which is the precise moment the real card replaces the phantom.
  const [isPending, startTransition] = useTransition();
  const queuedCleanups = useRef<Array<() => void>>([]);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !isPending) {
      // Transition finished — flush whatever was queued. We snapshot first
      // so a cleanup that itself triggers a state update doesn't reorder
      // entries pushed by another commit() during the same tick.
      const toRun = queuedCleanups.current;
      queuedCleanups.current = [];
      toRun.forEach((fn) => {
        try { fn(); } catch { /* never block other cleanups */ }
      });
    }
    wasPending.current = isPending;
  }, [isPending]);

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

  const addPendingInsert = useCallback(
    ({ job, destDept, destStaff }: { job: BoardJob; destDept: string; destStaff: string }): number => {
      tempIdCounter.current -= 1;
      const tempId = tempIdCounter.current;  // negative, unique
      const phantomJob: BoardJob = {
        ...job,
        id: tempId,
        dept: destDept,
        staff: destStaff,
      };
      setPendingInserts((prev) => [...prev, { tempId, job: phantomJob, destDept, destStaff }]);
      return tempId;
    },
    [],
  );

  const removePendingInsert = useCallback((tempId: number) => {
    setPendingInserts((prev) => prev.filter((p) => p.tempId !== tempId));
  }, []);

  const commit = useCallback((cleanup: () => void) => {
    // Delta-fetch path: there is no server re-render to wait on — the board
    // updates by merging a delta poll. Fire one poll now (it covers the
    // mutation's just-committed write), then run cleanup. The poll's
    // `setState` merge and the cleanup's `setHiddenIds`/`setPendingInserts`
    // land in the same microtask continuation → React 18 batches them into
    // one render, so the real card replaces the phantom with no bounceback.
    // On a failed poll, still run cleanup (the next backoff tick recovers).
    if (pollNow) {
      pollNow().then(cleanup, cleanup);
      return;
    }
    // Legacy path: refresh the server tree; cleanup fires when the
    // transition (and thus the new SSR snapshot) has landed.
    queuedCleanups.current.push(cleanup);
    startTransition(() => {
      router.refresh();
    });
  }, [router, pollNow]);

  return (
    <Ctx.Provider
      value={{
        hiddenIds,
        pendingInserts,
        hideJob,
        unhideJob,
        addPendingInsert,
        removePendingInsert,
        commit,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function usePendingMutations(): PendingState {
  return useContext(Ctx);
}
