'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setBulkActive } from '@/lib/bulk-mode-signal';

interface BulkState {
  mode: boolean;
  selected: Set<number>;
  toggleMode: () => void;
  toggleJob: (id: number) => void;
  clearSelection: () => void;
  selectIds: (ids: number[]) => void;
}

const BulkContext = createContext<BulkState | null>(null);

const MAX_SELECT = 25;

/** Provider for inline bulk-select mode on /board. State is client-only —
 *  selection doesn't persist across reloads (matches WP behaviour). */
export function BulkModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleMode = useCallback(() => {
    setMode((m) => {
      // Exiting bulk-mode also clears selection.
      if (m) setSelected(new Set());
      return !m;
    });
  }, []);

  const toggleJob = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECT) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectIds = useCallback((ids: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (next.size >= MAX_SELECT) break;
        next.add(id);
      }
      return next;
    });
  }, []);

  // Mirror bulk mode into the module-level signal so the global Quote FAB
  // (mounted in DashboardShell, outside this provider) can hide itself on
  // mobile while the full-width bulk-actions bar is showing. Cleanup resets
  // the signal when the provider unmounts (navigating away from /board).
  useEffect(() => {
    setBulkActive(mode);
    return () => setBulkActive(false);
  }, [mode]);

  const value = useMemo<BulkState>(
    () => ({ mode, selected, toggleMode, toggleJob, clearSelection, selectIds }),
    [mode, selected, toggleMode, toggleJob, clearSelection, selectIds],
  );

  return <BulkContext.Provider value={value}>{children}</BulkContext.Provider>;
}

export function useBulkMode(): BulkState {
  const ctx = useContext(BulkContext);
  if (!ctx) {
    // Defensive default — avoid crashing if a card renders outside provider
    // (e.g. inside a future drawer view that hasn't been wrapped yet).
    return {
      mode: false,
      selected: new Set(),
      toggleMode: () => {},
      toggleJob: () => {},
      clearSelection: () => {},
      selectIds: () => {},
    };
  }
  return ctx;
}

export const BULK_MAX_SELECT = MAX_SELECT;
