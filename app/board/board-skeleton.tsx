/** Layout-matched skeleton for /board. Geometry is tuned to the real board:
 *  4 KPI chips + toolbar row + 3 dept sections × 3 staff columns × 4 card
 *  stubs. Animates with `animate-pulse`.
 *
 *  Used in two places that must render an IDENTICAL placeholder so the
 *  hand-off is seamless:
 *   1. `page.tsx` — Suspense fallback while the server awaits `loadBoardDelta`.
 *   2. `board-client.tsx` — the pre-mount render. The board's data-derived
 *      content (KPI counts, dept totals, cards) is computed client-side off a
 *      live `useDeltaSync` snapshot, so SSR-ing it invites hydration text
 *      mismatches (React 19 throws #418 and regenerates the tree). Rendering
 *      this stable skeleton on the server + first client render keeps the two
 *      byte-identical; the real board mounts a tick later. No `'use client'`
 *      directive — pure presentational, importable from both server + client.
 */
export function BoardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {/* KPI bar — 4 urgency chips */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 w-32 bg-stone-100 rounded-lg animate-pulse" />
        ))}
      </div>
      {/* Toolbar — create-order + admin buttons */}
      <div className="flex gap-2">
        <div className="h-9 w-36 bg-stone-100 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
      </div>
      {/* 3 dept sections */}
      {[0, 1, 2].map((s) => (
        <div key={s} className="space-y-2">
          <div className="flex items-baseline gap-3 px-1 pt-2">
            <div className="h-4 w-28 bg-stone-200 rounded animate-pulse" />
            <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
            <div className="h-3 w-12 bg-stone-100 rounded animate-pulse ml-auto" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((c) => (
              <div key={c} className="space-y-2 bg-white border border-stone-100 rounded-lg p-2">
                <div className="h-12 bg-stone-100 rounded animate-pulse" />
                {[0, 1, 2, 3].map((j) => (
                  <div
                    key={j}
                    className="h-20 bg-stone-50 border border-stone-100 rounded animate-pulse"
                    style={{ animationDelay: `${(s + c + j) * 80}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
