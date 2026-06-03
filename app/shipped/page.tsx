import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { IconFolder } from '@/lib/icons';
import { ShippedListClient } from './list-client';

export const metadata: Metadata = {
  title: 'จัดส่งแล้ว',
};

export default async function ShippedPage() {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/shipped');

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">จัดส่งแล้ว</h1>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/archive"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
          >
            <IconFolder size={13} />
            ค้นหาในประวัติ
          </Link>
        </div>
        <Suspense fallback={<ShippedSkeleton />}>
          <ShippedData />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Bootstrap data fetcher — awaits the initial snapshot via
 *  `loadBoardDelta(null, { fullLists: true })` (full shipped rows + orders
 *  for customer lookup) and hands it to the client `<ShippedListClient>`. */
async function ShippedData() {
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
          {errorMessage || 'โหลดรายการจัดส่งไม่สำเร็จ'}
        </p>
      </div>
    );
  }

  return (
    <ShippedListClient
      initialOrders={initial.orders}
      initialShipped={initial.shipped ?? []}
      initialServerTime={initial.serverTime}
    />
  );
}

function ShippedSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <div className="flex flex-wrap items-center gap-2">
        <div className="h-9 w-72 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-28 bg-stone-100 rounded-xl animate-pulse" />
        <div className="h-9 w-16 bg-stone-100 rounded-xl animate-pulse" />
      </div>
      <div className="h-3 w-24 bg-stone-100 rounded animate-pulse" />
      <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
        <div className="border-b border-stone-100 p-3 flex gap-3 bg-stone-50">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-3 flex-1 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
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
  );
}
