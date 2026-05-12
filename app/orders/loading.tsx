/** Route-segment loading boundary for /orders. See app/board/loading.tsx
 *  for rationale. (Auditor PERF-F1.) */
export default function OrdersLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 md:pl-[236px]" aria-hidden="true">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-7 w-24 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-7 w-32 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
          <div className="ml-auto h-7 w-28 bg-stone-100 rounded-lg animate-pulse" />
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="border-b border-stone-100 p-3 flex gap-3 bg-stone-50">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-3 flex-1 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((row) => (
            <div key={row} className="border-b border-stone-50 p-3 flex gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-3 flex-1 bg-stone-100 rounded animate-pulse"
                  style={{ animationDelay: `${(row + i) * 60}ms` }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
