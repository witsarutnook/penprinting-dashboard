/** Route-segment loading boundary — fires during navigation INTO /board.
 *  Eliminates the blank-screen gap between click and the page's own
 *  Suspense fallback (which only kicks in once the segment mounts).
 *
 *  Kept structural-only (no session/role data available at route level)
 *  so it renders before DashboardShell mounts. Once the real page lands,
 *  the in-page BoardSkeleton inside Suspense takes over until data
 *  streaming completes. (Auditor PERF-F1 finding, 2026-05-12.) */
export default function BoardLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 md:pl-[236px]" aria-hidden="true">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 w-32 bg-stone-100 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-36 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
        </div>
        {[0, 1, 2].map((s) => (
          <div key={s} className="space-y-2">
            <div className="h-4 w-28 bg-stone-200 rounded animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[0, 1, 2].map((c) => (
                <div key={c} className="space-y-2 bg-white border border-stone-100 rounded-lg p-2">
                  <div className="h-12 bg-stone-100 rounded animate-pulse" />
                  {[0, 1, 2].map((j) => (
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
    </div>
  );
}
