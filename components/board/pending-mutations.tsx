'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BoardJob } from '@/lib/board';

/**
 * Optimistic-UI bookkeeping for /board mutations (forward, bulk-forward,
 * reassign, ship, cancel). Two states are tracked:
 *
 * 1. `hiddenIds` — job ids that should be filtered out of column rendering.
 *    Used when the SOURCE row should disappear instantly (forward, reassign,
 *    ship, cancel). Cleared after the delta poll lands the new data.
 *
 * 2. `pendingInserts` — phantom job objects to render in destination columns
 *    while the API round-trip is still in flight. Without this, the user
 *    sees a 2-3s gap between source-card-disappears and dest-card-appears.
 *    Phantoms use a NEGATIVE id so they never collide with real ids; the
 *    Card component renders them like normal cards (urgency, name, dates all
 *    derived from the source snapshot we passed in).
 *
 * On success: caller calls `commit(cleanup)`, which fires one delta poll and
 * runs the cleanup as the poll's setState merge lands — React 18 batches the
 * two into one render, so the real card replaces the phantom with no
 * bounceback.
 *
 * On failure: caller calls `unhideJob` + `removePendingInsert` immediately
 * and surfaces an error toast.
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
  /** Fire a delta poll and run cleanup once it resolves. The merge + cleanup
   *  land in the same microtask continuation → React 18 batches them, so the
   *  real card replaces the phantom with no source-card bounceback. */
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

export function PendingMutationsProvider({
  children,
  pollNow,
}: {
  children: ReactNode;
  /** Delta-poll trigger from `useDeltaSync`. `commit()` calls it after a
   *  mutation so the just-written row lands in the same render as phantom
   *  cleanup. */
  pollNow: () => Promise<void>;
}) {
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());
  const [pendingInserts, setPendingInserts] = useState<PendingInsertEntry[]>([]);
  // Counter for monotonically-decreasing tempIds — avoids collisions even if
  // two phantoms are added in the same millisecond.
  const tempIdCounter = useRef(0);

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

  // One delta poll covers the mutation's just-committed write; `then(cleanup,
  // cleanup)` runs cleanup either way so a failed poll still recovers (the
  // next backoff tick will catch up).
  const commit = useCallback((cleanup: () => void) => {
    pollNow().then(cleanup, cleanup);
  }, [pollNow]);

  // Memoized so the context value keeps referential identity across provider
  // re-renders that don't touch pending state (e.g. every delta poll that
  // lands data). Every Card subscribes via usePendingMutations(); a fresh
  // object here would re-render ~all visible cards and defeat the Card memo
  // comparator. All fns above are useCallback-stable (commit's pollNow dep is
  // itself stable — useDeltaSync builds it from a []-dep pollOnce).
  const value = useMemo<PendingState>(
    () => ({
      hiddenIds,
      pendingInserts,
      hideJob,
      unhideJob,
      addPendingInsert,
      removePendingInsert,
      commit,
    }),
    [hiddenIds, pendingInserts, hideJob, unhideJob, addPendingInsert, removePendingInsert, commit],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePendingMutations(): PendingState {
  return useContext(Ctx);
}
