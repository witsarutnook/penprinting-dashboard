'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const POLL_MS = 15000;
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
 * analytics / calendar). Mirrors WP autoRefreshTick + cross-tab broadcast.
 *
 *   1. Polls every 15s, but **skips** when:
 *      - tab is hidden (saves quota)
 *      - any <dialog> is open (forward / cowork / detail modal mid-edit)
 *      - an input / textarea / select is focused (user typing)
 *      - a card is mid-drag (`document.body.dataset.dragging === '1'`)
 *   2. Listens to BroadcastChannel `pp_dashboard_sync` — when ANY tab on
 *      this device commits a mutation, every other tab refreshes
 *      immediately (matches WP's `_ppChannel`).
 *
 * Use `broadcastWrite()` after a successful POST to notify sibling tabs.
 */
export function useAutoSync(): void {
  const router = useRouter();

  useEffect(() => {
    let lastRefresh = Date.now();
    function refresh() {
      lastRefresh = Date.now();
      router.refresh();
    }
    function maybeRefresh() {
      const reason = refreshGuard();
      if (reason) {
        // Useful when debugging: console.debug(`[auto-sync] skip — ${reason}`);
        return;
      }
      refresh();
    }

    const interval = setInterval(maybeRefresh, POLL_MS);

    // When the user comes back to the tab, refresh if it's been ≥ POLL_MS.
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh >= POLL_MS) {
        maybeRefresh();
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
      clearInterval(interval);
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
