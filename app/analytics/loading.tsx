/** Route-segment loading boundary for /analytics. (Auditor PERF-F1.) */
export default function AnalyticsLoading() {
  return (
    <div className="min-h-screen bg-stone-50 p-4 md:p-6 md:pl-[236px]" aria-hidden="true">
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-stone-200 p-4 space-y-2">
              <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
              <div className="h-7 w-16 bg-stone-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="h-4 w-32 bg-stone-100 rounded animate-pulse mb-3" />
              <div
                className="h-48 bg-stone-50 rounded animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
