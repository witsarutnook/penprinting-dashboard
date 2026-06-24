// lib/bulk-mode-signal.ts
// Module-level signal so the global Quote FAB (mounted in DashboardShell) can
// react to /board's bulk-select mode WITHOUT sharing the board-scoped
// BulkContext. BulkModeProvider writes it; QuoteFab reads it via
// useSyncExternalStore. Mobile hides the FAB while bulk mode is active so it
// doesn't collide with the full-width bulk-actions bar.

let bulkActive = false;
const listeners = new Set<() => void>();

export function setBulkActive(active: boolean): void {
  if (active === bulkActive) return;
  bulkActive = active;
  for (const l of listeners) l();
}

export function getBulkActive(): boolean {
  return bulkActive;
}

export function subscribeBulkActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
