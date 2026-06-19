import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { CancelledListClient } from './list-client';

export const metadata: Metadata = {
  title: 'รายการยกเลิก',
};

export default async function CancelledPage() {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') redirect('/board?dept=post');

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">รายการยกเลิก</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 hidden sm:inline">
            admin only
          </span>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        <Suspense fallback={<CancelledSkeleton />}>
          <CancelledData />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Bootstrap data fetcher — awaits the initial snapshot via
 *  `loadBoardDelta(null, { fullLists: true })` (full cancelled rows) and
 *  hands it to the client `<CancelledListClient>`, which then delta-polls
 *  and re-runs filter/paginate locally. */
async function CancelledData() {
  let initial: BoardDelta | null = null;
  let errorMessage: string | null = null;
  try {
    initial = await loadBoardDelta(null, { fullLists: true });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (!initial) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
        <p className="text-sm text-amber-800 mt-2 font-mono">
          {errorMessage || 'โหลดรายการยกเลิกไม่สำเร็จ'}
        </p>
      </div>
    );
  }

  return (
    <CancelledListClient
      initialCancelled={initial.cancelled ?? []}
      initialServerTime={initial.serverTime}
    />
  );
}

function CancelledSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 w-72 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-28 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-16 bg-stone-100 rounded-xl animate-pulse" />
      </div>
      <div className="h-3 w-24 bg-stone-100 rounded animate-pulse" />
      <div className="h-9 w-32 bg-stone-100 rounded-lg animate-pulse" />
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="border-b border-stone-100 p-3 flex gap-3 bg-stone-50">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-3 flex-1 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="border-b border-stone-50 p-3 flex gap-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
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
  );
}
