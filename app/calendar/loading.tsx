/** Route-segment loading boundary for /calendar. (Auditor PERF-F1.) */
export default function CalendarLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 md:pl-[236px]" aria-hidden="true">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-32 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-7 w-7 bg-stone-100 rounded-lg animate-pulse" />
          <div className="h-7 w-7 bg-stone-100 rounded-lg animate-pulse" />
          <div className="ml-auto h-3 w-24 bg-stone-100 rounded animate-pulse" />
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 p-3">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-3 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square bg-stone-50 border border-stone-100 rounded animate-pulse"
                style={{ animationDelay: `${i * 25}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
