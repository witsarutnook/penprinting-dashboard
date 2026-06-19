import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { COOKIE_NAME, verifySession, type Session } from '@/lib/auth';
import { BoardClient } from './board-client';
import { SearchBox } from '@/components/board/search-box';
import { DashboardShell } from '@/components/dashboard-shell';

export const metadata: Metadata = {
  title: 'Kanban Board',
};

function todayThaiLong(): string {
  const fmt = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return fmt.format(new Date());
}

/** Top-level Server Component. Returns the page shell (sidebar, header,
 *  search) immediately — the bootstrap `loadBoardDelta(null)` is awaited
 *  inside the `<BoardDataDelta>` Suspense boundary so the user sees the
 *  layout skeleton in ~50ms instead of staring at a blank page for
 *  300-1500ms while Postgres holds. */
export default async function BoardPage() {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/board');

  return (
    <DashboardShell user={session.user} role={session.role}>
      {/* Top date row + search — no data dep, render in the first chunk */}
      <div className="bg-white border-b border-stone-100">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm text-stone-500">{todayThaiLong()}</div>
          </div>
          <SearchBox />
        </div>
      </div>
      <div className="px-4 sm:px-6 py-4 space-y-4">
        <Suspense fallback={<BoardSkeleton />}>
          <BoardDataDelta session={session} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Bootstrap data fetcher — awaits the initial snapshot via
 *  `loadBoardDelta(null)` (jobs + orders only, no 5-table over-fetch) and
 *  hands it to the client `<BoardClient>`, which then delta-polls.
 *
 *  On a Postgres error there is no client mount to retry, so the error
 *  surfaces as a panel; the user reloads. */
async function BoardDataDelta({ session }: { session: Session }) {
  let initial: BoardDelta | null = null;
  let errorMessage: string | null = null;
  try {
    initial = await loadBoardDelta(null);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (!initial) {
    return <ErrorPanel message={errorMessage || 'โหลด Kanban ไม่สำเร็จ'} />;
  }

  return (
    <BoardClient
      initialJobs={initial.jobs}
      initialOrders={initial.orders}
      initialServerTime={initial.serverTime}
      sessionRole={session.role}
      canCreate={session.role === 'admin' || session.role === 'sales'}
      isAdmin={session.role === 'admin'}
      defaultOrderer={session.user}
    />
  );
}

/** Layout-matched skeleton shown while BoardDataDelta awaits the bootstrap.
 *  Geometry is tuned to /board: 4 KPI chips + toolbar row + 3 dept sections
 *  × 3 staff columns × 4 card stubs. Animates with `animate-pulse`. */
function BoardSkeleton() {
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

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Kanban ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
