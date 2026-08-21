'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job, Order, Shipped, Cancelled } from '@/lib/types';
import type { BoardDelta } from '@/lib/board-delta';
import {
  POLL_ACTIVE_MS,
  POLL_IDLE_MS,
  POLL_LONG_IDLE_MS,
  ACTIVE_WINDOW_MS,
  LONG_IDLE_AFTER_MS,
  POLL_STOP_AFTER_MS,
  CHANNEL_NAME,
  refreshGuard,
  type SyncMessage,
} from '@/lib/poll-schedule';

/**
 * Delta-fetch board sync (Delta-fetch P3).
 *
 * Replaces `/board`'s per-tick `router.refresh()` (which re-renders the
 * route server-side and streams the whole board HTML back) with a small
 * JSON delta poll against `GET /api/board/delta`. The client holds jobs +
 * orders in local state; each poll merges only the rows that changed since
 * the cursor, so an idle board left open all day costs near-zero Postgres
 * transfer instead of a full snapshot every 15-120s.
 *
 * The poll cadence (adaptive backoff + 30-min hard-stop + skip guards)
 * lives in lib/poll-schedule.ts.
 *
 * ── Opts ──
 * `{ lists: true }` — also tracks shipped/cancelled orderId sets (/orders).
 * `{ fullLists: true }` — also tracks FULL shipped + cancelled rows + uses
 *   the server's current-ID-set to drop rows hard-deleted by /restore
 *   (/shipped + /cancelled). Supersedes `lists`.
 */

export interface DeltaState {
  jobs: Job[];
  orders: Order[];
  /** Distinct orderIds with a shipped / cancelled row. Empty `[]` on /board
   *  and /calendar (they don't request `?lists=1`); populated on /orders. */
  shippedOrderIds: number[];
  cancelledOrderIds: number[];
  /** Full shipped / cancelled rows — populated only when fullLists is set.
   *  Empty `[]` for other consumers so client code stays type-safe. */
  shipped: Shipped[];
  cancelled: Cancelled[];
}

/** True when `b` carries no change vs `a`. `b === undefined` → the delta
 *  didn't include that list → treat as no change so callers stay
 *  byte-identical to the pre-extension behavior. */
function sameIdList(a: number[], b: number[] | undefined): boolean {
  if (b === undefined) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Upsert `newRows` into `current` WITHOUT a drop pass — the default
 *  incremental fullLists poll carries new rows but no id set
 *  (M-fulllists-id-array-every-poll); deletes are detected separately via
 *  `fullListsStale` + a reconcile poll. Same-ref on an idle poll. */
function upsertRows<T extends { id: number | string }>(
  current: T[],
  newRows: T[] | undefined,
): T[] {
  if (!newRows || newRows.length === 0) return current;
  const m = new Map<number, T>();
  for (const r of current) m.set(Number(r.id), r);
  for (const r of newRows) m.set(Number(r.id), r);
  return Array.from(m.values()).sort((a, b) => Number(b.id) - Number(a.id));
}

/** Largest Number(id) in `rows` — 0 when empty (matches the server's
 *  COALESCE-to-0 for an empty windowed table). */
function maxIdOf(rows: Array<{ id: number | string }>): number {
  let max = 0;
  for (const r of rows) {
    const n = Number(r.id);
    if (n > max) max = n;
  }
  return max;
}

/** Which fullLists tables this consumer actually renders. The server's
 *  incremental checks always cover BOTH tables, but /shipped seeds
 *  `cancelled: []` and /cancelled seeds `shipped: []` — an untracked table's
 *  check can never match its empty local state, so scoping the staleness
 *  test to the tracked table(s) is what keeps the reconcile protocol from
 *  chasing a mismatch it can never repair (H1-fulllists-reconcile-loop). */
export interface FullListsTrack {
  shipped: boolean;
  cancelled: boolean;
}

const TRACK_BOTH: FullListsTrack = { shipped: true, cancelled: true };

/** True when the delta's windowed {count, maxId} checks disagree with the
 *  (already-merged) state — meaning a row was hard-deleted server-side
 *  (/restore) or aged out of the server's LIST_WINDOW, and the client needs
 *  one reconcile poll with `?ids=1` to learn WHICH rows to drop. False when
 *  the delta carries no checks (non-fullLists consumers). A transient
 *  mismatch (write landing between the server's parallel statements) just
 *  costs one extra reconcile poll and heals next tick. Only the tables in
 *  `track` are compared — see FullListsTrack. */
export function fullListsStale(
  state: DeltaState,
  delta: BoardDelta,
  track: FullListsTrack = TRACK_BOTH,
): boolean {
  const s = delta.shippedCheck;
  if (track.shipped && s && (state.shipped.length !== s.count || maxIdOf(state.shipped) !== s.maxId)) return true;
  const c = delta.cancelledCheck;
  if (track.cancelled && c && (state.cancelled.length !== c.count || maxIdOf(state.cancelled) !== c.maxId)) return true;
  return false;
}

/** Consecutive stale reconciles before the protocol escalates to a full
 *  re-bootstrap (L2, audit 2026-08-21). Keeps bootstraps ≥ this many ticks
 *  apart — the streak resets whenever a bootstrap is flagged. */
export const REBOOTSTRAP_STALE_RECONCILES = 3;

/** Decide how a fullLists poll response advances the reconcile protocol.
 *  Pure single decision point for the hook's chain-a-reconcile logic:
 *
 *  - Normal poll detects staleness → chain ONE immediate `?ids=1` poll (so
 *    e.g. a row the user just restored in THIS tab drops without waiting a
 *    full backoff tick).
 *  - The reconcile response ITSELF is still stale → circuit breaker: keep
 *    the pending flag (the next scheduled tick re-carries `?ids=1`) but do
 *    NOT chain again. A reconcile can only drop rows + upsert rows-since-
 *    cursor — it cannot materialize a row the client never had (backdated
 *    insert during data repair), so chaining on it would loop back-to-back
 *    forever, bypassing refreshGuard and the 30-min hard stop.
 *  - Not stale → clear the flag + streak, nothing to do.
 *  - L2 escape hatch (audit 2026-08-21): REBOOTSTRAP_STALE_RECONCILES
 *    consecutive stale reconciles mean the mismatch is a row the client
 *    never received (e.g. /cancelled polled through a role swap: gated
 *    responses carried no cancelled rows yet advanced the cursor) — only a
 *    full re-bootstrap can materialize it. `rebootstrap: true` tells the
 *    hook to make its NEXT scheduled poll a since-less fullLists fetch;
 *    never chained, and the streak resets so bootstraps stay spaced out.
 */
export function planReconcile(
  { needIds, wasReconcile, stale, staleReconciles = 0 }: {
    needIds: boolean; wasReconcile: boolean; stale: boolean; staleReconciles?: number;
  },
): { needIds: boolean; chain: boolean; staleReconciles: number; rebootstrap: boolean } {
  if (!stale) return { needIds: false, chain: false, staleReconciles: 0, rebootstrap: false };
  if (wasReconcile) {
    const streak = staleReconciles + 1;
    if (streak >= REBOOTSTRAP_STALE_RECONCILES) {
      return { needIds: false, chain: false, staleReconciles: 0, rebootstrap: true };
    }
    return { needIds: true, chain: false, staleReconciles: streak, rebootstrap: false };
  }
  // Stale normal poll: chain once — unless a reconcile is already pending
  // (this response raced the flag), in which case the flag already covers it.
  // The streak tracks reconcile responses only, so it passes through here.
  return { needIds: true, chain: !needIds, staleReconciles, rebootstrap: false };
}

/** Apply a fullLists update: drop any current rows whose id is not in
 *  `allowedIds` (server hard-deletes from /restore), then upsert `newRows`
 *  (rows added since the cursor). Returns the SAME `current` reference when
 *  nothing changed so an idle poll never re-renders.
 *
 *  Sort is id-DESC to match the server bootstrap order (`ORDER BY id DESC`)
 *  so the client snapshot stays byte-stable. */
function applyFullList<T extends { id: number | string }>(
  current: T[],
  allowedIds: number[],
  newRows: T[],
): T[] {
  // Fast path: nothing added AND every current row survives the allow-list
  // AND counts match (no deletes either) → same ref, no re-render.
  if (newRows.length === 0 && current.length === allowedIds.length) {
    const allowed = new Set(allowedIds);
    let ok = true;
    for (const r of current) {
      if (!allowed.has(Number(r.id))) { ok = false; break; }
    }
    if (ok) return current;
  }
  // Slow path: rebuild.
  const allowed = new Set(allowedIds);
  const m = new Map<number, T>();
  for (const r of current) {
    const id = Number(r.id);
    if (allowed.has(id)) m.set(id, r);
  }
  for (const r of newRows) m.set(Number(r.id), r);
  return Array.from(m.values()).sort((a, b) => Number(b.id) - Number(a.id));
}

/**
 * Pure delta merge — upsert changed jobs/orders by id, drop tombstoned job
 * ids. Returns the SAME `state` reference when the delta carries no changes
 * so a no-op poll never triggers a board re-render (closes audit PA-M2:
 * KPIBar / toolbar churn on every idle tick).
 *
 * Ordering matches `loadBoardDelta(null)` (jobs id asc, orders id desc) so
 * the client snapshot stays byte-stable across merges — `computeBoard`
 * re-sorts columns regardless, but a deterministic `allJobs` order keeps the
 * KPI detail list stable.
 */
export function mergeDelta(state: DeltaState, delta: BoardDelta): DeltaState {
  const noJobChanges = delta.jobs.length === 0 && delta.deletedJobIds.length === 0;
  const noOrderChanges = delta.orders.length === 0;
  const shippedOrderIdsSame = sameIdList(state.shippedOrderIds, delta.shippedOrderIds);
  const cancelledOrderIdsSame = sameIdList(state.cancelledOrderIds, delta.cancelledOrderIds);

  let jobs = state.jobs;
  if (!noJobChanges) {
    const m = new Map<number, Job>(state.jobs.map((j) => [Number(j.id), j]));
    for (const j of delta.jobs) m.set(Number(j.id), j);
    for (const id of delta.deletedJobIds) m.delete(Number(id));
    jobs = Array.from(m.values()).sort((a, b) => Number(a.id) - Number(b.id));
  }

  let orders = state.orders;
  if (!noOrderChanges) {
    const m = new Map<number, Order>(state.orders.map((o) => [Number(o.id), o]));
    for (const o of delta.orders) m.set(Number(o.id), o);
    orders = Array.from(m.values()).sort((a, b) => Number(b.id) - Number(a.id));
  }

  // fullLists: with an id set (bootstrap / reconcile poll) rebuild via the
  // allow-list; without one (default incremental poll) upsert-only — deletes
  // wait for the reconcile poll that fullListsStale triggers. Same-ref
  // shortcuts inside both helpers cover the idle case.
  const shipped = delta.shippedAllIds !== undefined
    ? applyFullList(state.shipped, delta.shippedAllIds, delta.shipped ?? [])
    : upsertRows(state.shipped, delta.shipped);
  const cancelled = delta.cancelledAllIds !== undefined
    ? applyFullList(state.cancelled, delta.cancelledAllIds, delta.cancelled ?? [])
    : upsertRows(state.cancelled, delta.cancelled);

  if (
    jobs === state.jobs
    && orders === state.orders
    && shippedOrderIdsSame
    && cancelledOrderIdsSame
    && shipped === state.shipped
    && cancelled === state.cancelled
  ) {
    return state;
  }

  return {
    jobs,
    orders,
    // `!` is sound: sameIdList returns false only when delta.* is defined.
    shippedOrderIds: shippedOrderIdsSame ? state.shippedOrderIds : delta.shippedOrderIds!,
    cancelledOrderIds: cancelledOrderIdsSame ? state.cancelledOrderIds : delta.cancelledOrderIds!,
    shipped,
    cancelled,
  };
}

export interface DeltaSync {
  jobs: Job[];
  orders: Order[];
  /** Shipped / cancelled orderId sets — populated only when the hook was
   *  created with `{ lists: true }` (/orders); otherwise empty `[]`. */
  shippedOrderIds: number[];
  cancelledOrderIds: number[];
  /** Full shipped / cancelled rows — populated only when the hook was
   *  created with `{ fullLists: true }` (/shipped + /cancelled); otherwise
   *  empty `[]`. */
  shipped: Shipped[];
  cancelled: Cancelled[];
  /** Force an immediate delta poll. Resolves once the response has been
   *  merged into state. The optimistic-UI commit() path awaits this so
   *  phantom-card cleanup fires in the same render as the real row landing
   *  (no source-card bounceback). Coalesced — see `pollNow` below. */
  pollNow: () => Promise<void>;
}

/**
 * @param initial  Server-rendered bootstrap snapshot — jobs + orders from
 *                 `loadBoardDelta(null)`, plus its `serverTime` as the first
 *                 cursor. Used only on mount; later state is delta-merged.
 */
export function useDeltaSync(
  initial: {
    jobs: Job[];
    orders: Order[];
    serverTime: string;
    shippedOrderIds?: number[];
    cancelledOrderIds?: number[];
    shipped?: Shipped[];
    cancelled?: Cancelled[];
  },
  opts: { lists?: boolean; fullLists?: boolean; fullListsTrack?: FullListsTrack } = {},
): DeltaSync {
  const [state, setState] = useState<DeltaState>({
    jobs: initial.jobs,
    orders: initial.orders,
    shippedOrderIds: initial.shippedOrderIds ?? [],
    cancelledOrderIds: initial.cancelledOrderIds ?? [],
    shipped: initial.shipped ?? [],
    cancelled: initial.cancelled ?? [],
  });
  const cursorRef = useRef<string>(initial.serverTime);
  const lastActivityRef = useRef<number>(Date.now());
  const inFlightRef = useRef<Promise<void> | null>(null);
  // `lists` / `fullLists` are fixed for a mount — refs keep pollOnce's
  // useCallback([]) dep list empty while still threading the flags into the
  // poll URL.
  const wantListsRef = useRef<boolean>(opts.lists ?? false);
  const wantFullListsRef = useRef<boolean>(opts.fullLists ?? false);
  const fullListsTrackRef = useRef<FullListsTrack>(opts.fullListsTrack ?? TRACK_BOTH);
  // Mirror of `state` for pollOnce — the staleness check below needs the
  // POST-merge snapshot synchronously, and only pollOnce ever writes this
  // state (all polls are serialized through pollNow's coalescing chain).
  const stateRef = useRef<DeltaState>(state);
  // Set when the fullLists checks disagreed with local state — the next poll
  // carries `?ids=1` so the server returns the full id set to reconcile
  // against (M-fulllists-id-array-every-poll).
  const needIdsRef = useRef<boolean>(false);
  // Re-bootstrap escape hatch (L2, audit 2026-08-21): set when
  // REBOOTSTRAP_STALE_RECONCILES consecutive reconciles stayed stale — the
  // next poll drops `since` entirely so the fullLists bootstrap response can
  // materialize rows the client never received. Cleared once that response
  // has been merged; a failed fetch keeps it for the next tick.
  const needBootstrapRef = useRef<boolean>(false);
  const staleReconcilesRef = useRef<number>(0);
  // Declared before pollOnce so its closure can schedule a follow-up poll;
  // assigned the real pollNow below (runs before any poll can fire).
  const pollNowRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // One poll round-trip: fetch the delta since the cursor, merge it, advance
  // the cursor. Ref-stable so the timer effect below never re-subscribes.
  const pollOnce = useCallback(async (): Promise<void> => {
    // A pending re-bootstrap supersedes a reconcile: a since-less fullLists
    // fetch already carries the full windowed rows + id set.
    const wantBootstrap = wantFullListsRef.current && needBootstrapRef.current;
    const wantIds = wantFullListsRef.current && needIdsRef.current && !wantBootstrap;
    const params: string[] = [];
    if (!wantBootstrap) params.push(`since=${encodeURIComponent(cursorRef.current)}`);
    if (wantFullListsRef.current) params.push('fullLists=1');
    else if (wantListsRef.current) params.push('lists=1');
    if (wantIds) params.push('ids=1');
    const qs = params.join('&');
    let res: Response;
    try {
      res = await fetch(`/api/board/delta?${qs}`, {
        cache: 'no-store',  // session cookie rides along same-origin
      });
    } catch {
      return;  // network blip — keep cursor, next tick retries
    }
    if (!res.ok) return;  // 4xx/5xx — keep cursor, retry next tick
    let delta: BoardDelta;
    try {
      delta = (await res.json()) as BoardDelta;
    } catch {
      return;
    }
    // Advance the cursor ONLY on a clean response — a dropped poll must not
    // skip the rows it failed to fetch. serverTime was snapshotted by the
    // server BEFORE its queries, so the next poll re-covers any write that
    // landed mid-query.
    cursorRef.current = delta.serverTime;
    const next = mergeDelta(stateRef.current, delta);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
    if (wantBootstrap) needBootstrapRef.current = false;
    if (wantFullListsRef.current) {
      // Chain-at-most-once reconcile protocol — all branch logic lives in
      // planReconcile (pure, tested): stale normal poll → one immediate
      // `?ids=1` chain; stale reconcile response → circuit breaker (keep the
      // flag, wait for the next scheduled tick); persistent stale reconciles
      // → re-bootstrap escape hatch (L2); clean → clear flag + streak.
      // `wasReconcile` is request-side truth (this closure sent ?ids=1) —
      // sniffing the response for id sets breaks once a side is untracked.
      const plan = planReconcile({
        needIds: needIdsRef.current,
        wasReconcile: wantIds,
        stale: fullListsStale(next, delta, fullListsTrackRef.current),
        staleReconciles: staleReconcilesRef.current,
      });
      needIdsRef.current = plan.needIds;
      staleReconcilesRef.current = plan.staleReconciles;
      if (plan.rebootstrap) needBootstrapRef.current = true;
      if (plan.chain) void pollNowRef.current();
    }
  }, []);

  // Coalesced imperative trigger. While a poll is in flight, callers get a
  // promise for a FRESH poll that starts strictly AFTER the current one —
  // so commit()'s cleanup, fired after a mutation's write, never resolves
  // against a pre-mutation snapshot.
  const pollNow = useCallback((): Promise<void> => {
    const run = (): Promise<void> => {
      const p = pollOnce();
      const tracked = p.finally(() => {
        if (inFlightRef.current === tracked) inFlightRef.current = null;
      });
      inFlightRef.current = tracked;
      return tracked;
    };
    if (inFlightRef.current) {
      const chained = inFlightRef.current.then(run);
      inFlightRef.current = chained;
      return chained;
    }
    return run();
  }, [pollOnce]);

  // Keep the ref pointing at the latest pollNow so the timer effect (and
  // pollOnce's reconcile follow-up) always call the current instance without
  // re-subscribing. Declared above pollOnce; assigned here every render.
  pollNowRef.current = pollNow;

  useEffect(() => {
    function pollIntervalMs(): number {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor < ACTIVE_WINDOW_MS) return POLL_ACTIVE_MS;
      if (idleFor < LONG_IDLE_AFTER_MS) return POLL_IDLE_MS;
      return POLL_LONG_IDLE_MS;
    }

    // Backoff-timer ticks respect refreshGuard (tab hidden / dialog open /
    // input focused / mid-drag). The commit() path calls pollNow() directly
    // and intentionally bypasses the guard — a mutation just succeeded and
    // its real row must land even if a dialog is still closing.
    function maybePoll() {
      if (refreshGuard()) return;
      void pollNowRef.current();
    }

    let timer: ReturnType<typeof setTimeout>;
    let unmounted = false;
    let stopped = false;
    function tick() {
      if (unmounted) return;
      maybePoll();
      if (unmounted) return;
      // Hard-stop: a tab idle > 30 min is almost certainly abandoned.
      if (Date.now() - lastActivityRef.current >= POLL_STOP_AFTER_MS) {
        stopped = true;
        return;
      }
      timer = setTimeout(tick, pollIntervalMs());
    }
    timer = setTimeout(tick, pollIntervalMs());

    function resumeIfStopped() {
      if (stopped && !unmounted) {
        stopped = false;
        maybePoll();
        timer = setTimeout(tick, pollIntervalMs());
      }
    }
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

    // Tab re-visible → poll immediately (the cursor may be minutes stale).
    function onVisible() {
      if (document.visibilityState === 'visible') {
        markActive();
        if (!refreshGuard()) void pollNowRef.current();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    // BroadcastChannel — any mutation anywhere (this tab OR a sibling tab)
    // calls broadcastWrite() after a successful POST. Same-name channels
    // deliver to every instance except the sender, so a write in THIS tab
    // is received here too: that is what makes card / column / job-form /
    // bulk / order-form / undo writes refresh the delta board without
    // touching any of those files.
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.addEventListener('message', (e: MessageEvent<SyncMessage>) => {
        if (e?.data?.type === 'write' && !refreshGuard()) {
          void pollNowRef.current();
        }
      });
    } catch {
      // BroadcastChannel unsupported — backoff polling still covers it.
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
  }, []);

  return {
    jobs: state.jobs,
    orders: state.orders,
    shippedOrderIds: state.shippedOrderIds,
    cancelledOrderIds: state.cancelledOrderIds,
    shipped: state.shipped,
    cancelled: state.cancelled,
    pollNow,
  };
}
