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

/**
 * Auto-refresh hook for read pages (board / analytics / calendar / archive).
 *
 *   1. Polls every 15s while the tab is visible — picks up writes from other
 *      users / WP without a manual reload.
 *   2. Listens to BroadcastChannel `pp_dashboard_sync` — when ANY tab on this
 *      device commits a mutation, every other tab refreshes immediately
 *      (matches WP's `_ppChannel` cross-tab sync).
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

    // Visibility-aware interval — pause when tab hidden so we don't burn quota.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);

    // When the user comes back to the tab, refresh if it's been ≥ POLL_MS.
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastRefresh >= POLL_MS) {
        refresh();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    // Cross-tab sync via BroadcastChannel (same channel name as WP, so v2 + WP
    // tabs cross-pollinate when running side-by-side during the migration).
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', (e: MessageEvent<SyncMessage>) => {
        if (e?.data?.type === 'write') refresh();
      });
    } catch {
      // BroadcastChannel unsupported (very old Safari) — polling alone covers it.
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
