import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { COOKIE_NAME, verifySession, type Session } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { IconSearch } from '@/lib/icons';
import { OrdersListClient } from './orders-list-client';

export const metadata: Metadata = {
  title: 'รายการใบสั่งงาน',
};

interface SearchParams {
  q?: string;
  status?: string;
  from?: string;  // YYYY-MM-DD วันที่รับ from
  to?: string;    // YYYY-MM-DD วันที่รับ to
  per?: string;   // page size — 20 / 50 / 100 (default 20)
  page?: string;  // 1-based page index (default 1)
}

const STATUS_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'sent', label: 'สั่งแล้ว' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'shipped', label: 'จัดส่งแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
];

interface ChromeFilters {
  query: string;
  statusFilter: string;
  fromIso: string;
  toIso: string;
}

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/orders');
  // /orders list is admin + sales only — staff don't manage orders, they
  // only work jobs on the Kanban.
  if (session.role !== 'admin' && session.role !== 'sales') {
    redirect('/board?dept=post');
  }

  // Chrome filters (FilterForm defaults + StatusPills active state) come from
  // searchParams. Filtering itself happens client-side inside OrdersListClient
  // via useSearchParams — single source of truth, no server round-trip needed.
  const chrome: ChromeFilters = {
    query: (searchParams.q || '').trim().toLowerCase(),
    statusFilter: searchParams.status || '',
    fromIso: (searchParams.from || '').trim(),
    toIso: (searchParams.to || '').trim(),
  };

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="pl-4 pr-12 sm:pl-6 sm:pr-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">รายการใบสั่งงาน</h1>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto space-y-4">
        <FilterForm filters={chrome} />
        <StatusPills filters={chrome} />
        <Suspense fallback={<OrdersSkeleton />}>
          <OrdersDataDelta session={session} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Bootstrap data fetcher — awaits the initial snapshot via
 *  `loadBoardDelta(null, { lists: true })` (jobs + orders + shipped/cancelled
 *  orderId sets) and hands it to the client `<OrdersListClient>`, which then
 *  delta-polls and re-runs `computeOrdersList` locally. */
async function OrdersDataDelta({ session }: { session: Session }) {
  let initial: BoardDelta | null = null;
  let errorMessage: string | null = null;
  try {
    initial = await loadBoardDelta(null, { lists: true });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (!initial) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
        <p className="text-sm text-amber-800 mt-2 font-mono">
          {errorMessage || 'โหลดรายการใบสั่งงานไม่สำเร็จ'}
        </p>
      </div>
    );
  }

  return (
    <OrdersListClient
      initialJobs={initial.jobs}
      initialOrders={initial.orders}
      initialShippedOrderIds={initial.shippedOrderIds ?? []}
      initialCancelledOrderIds={initial.cancelledOrderIds ?? []}
      initialServerTime={initial.serverTime}
      role={session.role}
    />
  );
}

/** Filter form — searchParams-driven defaults, no data dep. Renders in
 *  the first server chunk. */
function FilterForm({ filters }: { filters: ChromeFilters }) {
  const { query, statusFilter, fromIso, toIso } = filters;
  return (
    <form action="/orders" className="flex flex-wrap items-end gap-2">
      <div className="relative w-full sm:w-72">
        <label className="block text-[11px] text-stone-500 mb-1">ค้นหา</label>
        <IconSearch size={16} className="absolute left-3 top-[34px] -translate-y-1/2 text-stone-400 pointer-events-none" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ค้นชื่องาน / ลูกค้า / id..."
          className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <div>
        <label className="block text-[11px] text-stone-500 mb-1">รับ จาก</label>
        <input
          type="date"
          name="from"
          defaultValue={fromIso}
          className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white tabular-nums focus:outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-[11px] text-stone-500 mb-1">ถึง</label>
        <input
          type="date"
          name="to"
          defaultValue={toIso}
          className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white tabular-nums focus:outline-none focus:border-accent"
        />
      </div>
      {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
      <button
        type="submit"
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-dark"
      >
        กรอง
      </button>
      {(query || fromIso || toIso || statusFilter) && (
        <a href="/orders" className="text-xs text-stone-500 hover:text-stone-700 underline">
          ล้างตัวกรอง
        </a>
      )}
    </form>
  );
}

function StatusPills({ filters }: { filters: ChromeFilters }) {
  const { query, statusFilter, fromIso, toIso } = filters;
  return (
    <div className="flex flex-wrap gap-2">
      {STATUS_FILTERS.map((f) => {
        const active = statusFilter === f.key;
        const next = new URLSearchParams();
        if (query) next.set('q', query);
        if (fromIso) next.set('from', fromIso);
        if (toIso) next.set('to', toIso);
        if (f.key) next.set('status', f.key);
        const qs = next.toString();
        return (
          <Link
            key={f.key || 'all'}
            href={qs ? `/orders?${qs}` : '/orders'}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
            }`}
          >
            {f.label}
          </Link>
        );
      })}
    </div>
  );
}

function OrdersSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
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
  );
}
