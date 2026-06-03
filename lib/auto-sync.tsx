'use client';

import { CHANNEL_NAME, type SyncMessage } from '@/lib/poll-schedule';

/**
 * Cross-tab write notifier.
 *
 * Mutation handlers call `broadcastWrite()` after a successful POST so that
 * every open dashboard tab — same browser, same device — runs an immediate
 * delta poll via the BroadcastChannel listener in `useDeltaSync` (see
 * lib/delta-sync.tsx). Same-name channels deliver to every instance EXCEPT
 * the sender, so this fires `useDeltaSync`'s listener (a different channel
 * instance) on the writing tab too — that's why a card move on /board
 * propagates without any extra wiring in the calling site.
 *
 * Backoff polling cadence (15s → 30s → 120s → stop at 30 min idle) lives in
 * lib/poll-schedule.ts and is consumed by `useDeltaSync`. This module used
 * to also export a `useAutoSync` hook + `<AutoSync />` wrapper that drove
 * `router.refresh()` for server-rendered pages; both were dropped in 2026-06
 * once /shipped + /cancelled migrated to delta-fetch and /analytics fell
 * back to 60s ISR — at which point no page needed the router.refresh path.
 */

export function broadcastWrite(action: string): void {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'write', action, ts: Date.now() } satisfies SyncMessage);
    channel.close();
  } catch {
    // BroadcastChannel unsupported — receivers fall back to backoff polling.
  }
}
