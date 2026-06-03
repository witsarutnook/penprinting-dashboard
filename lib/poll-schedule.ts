/**
 * Shared adaptive-backoff polling primitives.
 *
 * Consumed by `useDeltaSync` (lib/delta-sync.tsx) for backoff schedule +
 * skip guards. Kept in its own pure module — no React, no next/* imports —
 * so `mergeDelta` unit tests stay free of a Next.js runtime. (Historical:
 * a former `useAutoSync` hook in auto-sync.tsx also consumed this, dropped
 * 2026-06 when /shipped + /cancelled migrated to delta-fetch.)
 *
 * `refreshGuard` touches `document` but only when called (inside browser
 * effects), never at module-eval time.
 */

// Backoff schedule — when a user is actively interacting (mouse / keyboard /
// scroll), poll fast (matches WP 15s). After a couple of minutes of no user
// input the screen is just being watched; back off to 30s. After 5 minutes
// it's almost certainly idle (lunch / left for the day) — 120s is plenty.
//
// User input resets the timer, so the moment they touch anything we're back
// to 15s for a full pickup. Plus the visibilitychange + BroadcastChannel
// paths fire immediate refreshes, so coming back from a hidden tab or another
// tab's mutation is still instant.
//
// Hard-stop: backoff alone never reaches zero, so a tab abandoned overnight
// still fires ~720 ticks (auditor H1, 2026-05-19). After 30 min of zero
// activity polling stops entirely; the next user input or tab re-visibility
// resumes it (both already trigger an immediate refresh, so resume loses
// nothing).
export const POLL_ACTIVE_MS     = 15000;   // fresh activity within last 2 min
export const POLL_IDLE_MS       = 30000;   // 2-5 min since last activity
export const POLL_LONG_IDLE_MS  = 120000;  // 5-30 min since last activity
export const ACTIVE_WINDOW_MS   = 2 * 60 * 1000;
export const LONG_IDLE_AFTER_MS = 5 * 60 * 1000;
export const POLL_STOP_AFTER_MS = 30 * 60 * 1000;  // > 30 min idle — stop entirely

/** BroadcastChannel name — every tab on this device listens here so one
 *  tab's mutation refreshes the others. */
export const CHANNEL_NAME = 'pp_dashboard_sync';

export interface SyncMessage {
  type: 'write';
  action: string;
  ts: number;
}

/** True when refreshing now would disrupt the user — port of WP
 *  autoRefreshTick guards (production-monitoring.js:5666). Returns the
 *  reason for the skip (used for a debug log) or null when safe. */
export function refreshGuard(): string | null {
  if (document.visibilityState !== 'visible') return 'tab-hidden';
  // 1. Any open native <dialog open>? (forward / cowork / detail / order-form)
  if (document.querySelector('dialog[open]')) return 'dialog-open';
  // 2. User typing into an input?
  const ae = document.activeElement;
  if (ae) {
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return 'input-focused';
    if ((ae as HTMLElement).isContentEditable) return 'contenteditable';
  }
  // 3. User mid-drag — set on the body during card drag (see card.tsx).
  if (document.body.dataset.dragging === '1') return 'dragging';
  return null;
}
