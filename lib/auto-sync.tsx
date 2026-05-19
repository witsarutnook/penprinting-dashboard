'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

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
// Why this matters: every poll is a `router.refresh()` → server re-renders
// the route → `loadAll()` snapshot read. With the loadAll() unstable_cache
// (15s coalescing) most polls now hit cache, but the long-idle tail still
// dominates Postgres network transfer — a board left open all day. Entering
// long-idle after 5 min (was 10) at a 120s interval (was 60s) roughly
// quarters the cost of an abandoned tab, with no effect on active use.
//
// Hard-stop: backoff alone never reaches zero, so a tab abandoned overnight
// still fires ~720 router.refresh() ticks (auditor H1, 2026-05-19). After
// 30 min of zero activity polling stops entirely; the next user input or
// tab re-visibility resumes it (both already trigger an immediate refresh,
// so resume loses nothing).
const POLL_ACTIVE_MS     = 15000;   // fresh activity within last 2 min
const POLL_IDLE_MS       = 30000;   // 2-5 min since last activity
const POLL_LONG_IDLE_MS  = 120000;  // 5-30 min since last activity
const ACTIVE_WINDOW_MS   = 2 * 60 * 1000;
const LONG_IDLE_AFTER_MS = 5 * 60 * 1000;
const POLL_STOP_AFTER_MS = 30 * 60 * 1000;  // > 30 min idle — stop polling entirely
const CHANNEL_NAME = 'pp_dashboard_sync';

interface SyncMessage {
  type: 'write';
  action: string;
  ts: number;
}

/** True when refreshing now would disrupt the user — port of WP
 *  autoRefreshTick guards (production-monitoring.js:5666). Returns the
 *  reason for the skip (used for a debug log) or null when safe. */
function refreshGuard(): string | null {
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

/**
 * Auto-refresh hook for read pages (board / orders / shipped / cancelled /
 * analytics / calendar). Mirrors WP autoRefreshTick + cross-tab broadcast,
 * with adaptive backoff on top.
 *
 *   1. Polls on an interval that adapts to user activity:
 *      - 15s when the user touched mouse/keyboard/scroll within 2 min
 *      - 30s after 2-5 min of no activity (still watching screen)
 *      - 120s after 5-30 min of no activity (probably stepped away)
 *      - stops entirely after 30 min idle; resumes on next input / re-visibility
 *      Skips entirely when:
 *      - tab is hidden (saves quota)
 *      - any <dialog> is open (forward / cowork / detail modal mid-edit)
 *      - an input / textarea / select is focused (user typing)
 *      - a card is mid-drag (`document.body.dataset.dragging === '1'`)
 *   2. Any user input (pointerdown/keydown/scroll) resets the activity
 *      timer — instant snap back to 15s polling.
 *   3. Listens to BroadcastChannel `pp_dashboard_sync` — when ANY tab on
 *      this device commits a mutation, every other tab refreshes
 *      immediately (matches WP's `_ppChannel`).
 *   4. On tab re-visibility, refreshes immediately if the active interval
 *      has elapsed since the last refresh.
 *
 * Use `broadcastWrite()` after a successful POST to notify sibling tabs.
 */
export function useAutoSync(): void {
  const router = useRouter();
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    let lastRefresh = Date.now();
    function refresh() {
      lastRefresh = Date.now();
      router.refresh();
    }

    function pollIntervalMs(): number {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor < ACTIVE_WINDOW_MS) return POLL_ACTIVE_MS;
      if (idleFor < LONG_IDLE_AFTER_MS) return POLL_IDLE_MS;
      return POLL_LONG_IDLE_MS;
    }

    function maybeRefresh() {
      const reason = refreshGuard();
      if (reason) {
        // Useful when debugging: console.debug(`[auto-sync] skip — ${reason}`);
        return;
      }
      refresh();
    }

    // Self-rescheduling timer so each tick reads the freshly-computed
    // interval — `setInterval` would lock to whichever value was current
    // at start. Using setTimeout means the moment activity arrives, the
    // NEXT scheduled tick uses the new (faster) interval.
    //
    // Auditor M7 (2026-05-08): unmount-during-tick guard. The cleanup
    // path runs `clearTimeout(timer)` but if React tears down between
    // the setTimeout fire (callback invoked) and the line that reassigns
    // `timer`, the callback would queue a fresh setTimeout that the
    // cleanup never sees, leaking one orphan tick. Tiny window — but the
    // `unmounted` flag makes it impossible.
    let timer: ReturnType<typeof setTimeout>;
    let unmounted = false;
    let stopped = false;
    function tick() {
      if (unmounted) return;
      maybeRefresh();
      if (unmounted) return;
      // Hard-stop: a tab idle > 30 min is almost certainly abandoned.
      // Stop rescheduling entirely — resumeIfStopped() (user input /
      // tab re-visibility) restarts the timer when the user is back.
      if (Date.now() - lastActivityRef.current >= POLL_STOP_AFTER_MS) {
        stopped = true;
        return;
      }
      timer = setTimeout(tick, pollIntervalMs());
    }
    timer = setTimeout(tick, pollIntervalMs());

    // Restart the poller after a hard-stop. No-op while the timer is live.
    // Refreshes once immediately so the board is fresh the moment the user
    // is back — the 30-min-stale snapshot would otherwise linger 15s.
    function resumeIfStopped() {
      if (stopped && !unmounted) {
        stopped = false;
        maybeRefresh();
        timer = setTimeout(tick, pollIntervalMs());
      }
    }

    // Reset the activity timer on any meaningful user input. `passive: true`
    // so we never block scroll. Pointermove fires constantly so we throttle
    // it via a 1s window (only update if last activity was > 1s ago).
    function markActive() {
      lastActivityRef.current = Date.now();
      resumeIfStopped();
    }
    function markActiveThrottled() {
      if (Date.now() - lastActivityRef.current > 1000) {
        lastActivityRef.current = Date.now();
        resumeIfStopped();
      }
    }
    document.addEventListener('pointerdown', markActive, { passive: true });
    document.addEventListener('keydown', markActive);
    document.addEventListener('wheel', markActiveThrottled, { passive: true });
    document.addEventListener('touchstart', markActive, { passive: true });

    // When the user comes back to the tab, refresh if the *active* interval
    // (15s) has elapsed — that's the user's expectation regardless of the
    // long-idle backoff. Returning to the tab counts as activity.
    function onVisible() {
      if (document.visibilityState === 'visible') {
        markActive();
        if (Date.now() - lastRefresh >= POLL_ACTIVE_MS) {
          maybeRefresh();
        }
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    // Cross-tab sync via BroadcastChannel.
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', (e: MessageEvent<SyncMessage>) => {
        if (e?.data?.type === 'write') {
          // Cross-tab sync should still respect the user-typing guard so we
          // don't blow away an open form just because another tab saved.
          if (!refreshGuard()) refresh();
        }
      });
    } catch {
      // BroadcastChannel unsupported — polling alone covers it.
    }

    return () => {
      unmounted = true;
      clearTimeout(timer);
      document.removeEventListener('pointerdown', markActive);
      document.removeEventListener('keydown', markActive);
      document.removeEventListener('wheel', markActiveThrottled);
      document.removeEventListener('touchstart', markActive);
      document.removeEventListener('visibilitychange', onVisible);
      channel?.close();
    };
  }, [router]);
}

/** Notify sibling tabs that we just committed a mutation. Call from
 *  client-side write handlers after a successful POST. Safe no-op when
 *  BroadcastChannel is unavailable. */
export function broadcastWrite(action: string): void {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'write', action, ts: Date.now() } satisfies SyncMessage);
    channel.close();
  } catch {
    // ignore
  }
}

/** Tiny client wrapper for server-rendered pages — drop in to enable auto-sync. */
export function AutoSync(): null {
  useAutoSync();
  return null;
}
