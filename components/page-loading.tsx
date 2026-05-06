/**
 * Loading skeleton shown during route transitions inside the dashboard
 * shell. Each authenticated folder route has a `loading.tsx` that
 * renders this — Next.js shows it as the Suspense fallback the moment
 * the user clicks a Link, so the page never feels "frozen" while the
 * server runs `loadAll()` (300-1500ms cold-cache).
 *
 * The DashboardShell of the *previous* page unmounts immediately when
 * navigation starts, so this skeleton must render its own sidebar +
 * bottom-nav placeholders to avoid a visual jump. Static color blocks
 * match the real shell's geometry (220px sidebar, 64px bottom-nav,
 * 220px content offset on desktop, 80px content offset on mobile).
 *
 * Variant lets each route hint at its body shape — the skeleton bars
 * are tuned roughly to /board (3 columns), /orders (table), or
 * generic page (single column).
 */
type Variant = 'board' | 'table' | 'page';

interface PageLoadingProps {
  variant?: Variant;
}

export function PageLoading({ variant = 'page' }: PageLoadingProps) {
  return (
    <div className="min-h-screen bg-stone-50">
      <SidebarSkeleton />
      <BottomNavSkeleton />
      <div className="md:pl-[220px] pb-20 md:pb-0">
        <div className="px-4 md:px-6 py-4 md:py-6 max-w-7xl mx-auto">
          <HeaderSkeleton />
          {variant === 'board' && <BoardBodySkeleton />}
          {variant === 'table' && <TableBodySkeleton />}
          {variant === 'page' && <PageBodySkeleton />}
        </div>
      </div>
    </div>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-[220px] bg-white border-r border-stone-100 flex-col z-30">
      <div className="px-5 py-6 border-b border-stone-100">
        <div className="h-[66px] w-[140px] bg-stone-100 rounded animate-pulse" />
      </div>
      <div className="flex-grow py-3 px-5 space-y-6 overflow-hidden">
        {[0, 1].map((g) => (
          <div key={g} className="space-y-2">
            <div className="h-2 w-16 bg-stone-100 rounded animate-pulse" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5 py-1">
                <div className="size-4 bg-stone-100 rounded animate-pulse" />
                <div
                  className="h-3 bg-stone-100 rounded animate-pulse"
                  style={{ width: `${60 + ((g + i) % 3) * 12}%` }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-stone-100 px-4 py-3 space-y-2">
        <div className="h-3 w-24 bg-stone-100 rounded animate-pulse" />
        <div className="h-2 w-12 bg-stone-100 rounded animate-pulse" />
      </div>
    </aside>
  );
}

function BottomNavSkeleton() {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="grid grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex flex-col items-center justify-center gap-1 py-2.5">
            <div className="size-5 bg-stone-100 rounded animate-pulse" />
            <div className="h-2 w-10 bg-stone-100 rounded animate-pulse" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-4 space-y-2">
      <div className="h-6 w-48 bg-stone-200 rounded animate-pulse" />
      <div className="h-3 w-32 bg-stone-100 rounded animate-pulse" />
    </div>
  );
}

function BoardBodySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
      {[0, 1, 2].map((c) => (
        <div key={c} className="space-y-2">
          <div className="h-5 w-24 bg-stone-200 rounded animate-pulse" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-20 bg-white rounded border border-stone-100 animate-pulse"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function TableBodySkeleton() {
  return (
    <div className="mt-4 bg-white rounded-lg border border-stone-100 overflow-hidden">
      <div className="border-b border-stone-100 p-3 flex gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-3 flex-1 bg-stone-100 rounded animate-pulse" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div key={row} className="border-b border-stone-50 p-3 flex gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-3 flex-1 bg-stone-100 rounded animate-pulse"
              style={{ animationDelay: `${(row + i) * 60}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function PageBodySkeleton() {
  return (
    <div className="mt-4 space-y-3">
      <div className="h-32 bg-white rounded-lg border border-stone-100 animate-pulse" />
      <div className="h-64 bg-white rounded-lg border border-stone-100 animate-pulse" />
    </div>
  );
}
