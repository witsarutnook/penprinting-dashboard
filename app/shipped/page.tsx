import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDate } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconTruck, IconSearch, IconFolder } from '@/lib/icons';
import { distinctYears, filterByYearMonth, dateMonthLabel, THAI_MONTHS_FULL } from '@/lib/list-helpers';
import { PageSizeBar } from '@/components/page-size-bar';
import { resolvePerPage } from '@/lib/page-size';
import Link from 'next/link';
import { ShippedClient } from './client';

export const metadata: Metadata = {
  title: 'จัดส่งแล้ว',
};

interface SearchParams {
  q?: string;
  year?: string;
  month?: string;
  per?: string;
}

export default async function ShippedPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/shipped');

  const query = (searchParams.q || '').trim().toLowerCase();
  const year = Number(searchParams.year) || 0;
  const month = Number(searchParams.month) || 0;
  const perPage = resolvePerPage(searchParams.per);

  let snap;
  let errorMessage: string | null = null;
  try {
    snap = await loadAll();
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const allShipped = snap ? [...snap.shipped].sort((a, b) => Number(b.id) - Number(a.id)) : [];
  // Resolve customer by orderId — orders[] doubles as the lookup index
  const customerByOrderId = new Map<number, string>();
  if (snap) {
    for (const o of snap.orders) {
      if (o.customer && o.customer !== '-') customerByOrderId.set(Number(o.id), o.customer);
    }
  }

  const enriched = allShipped.map((s) => ({
    ...s,
    customer: s.orderId ? customerByOrderId.get(Number(s.orderId)) || '' : '',
    monthLabel: dateMonthLabel(s.shippedDate),
  }));

  const years = distinctYears(allShipped, (s) => s.shippedDate);
  const filtered = filterByYearMonth(enriched, (s) => s.shippedDate, year, month).filter((s) => {
    if (!query) return true;
    const haystack = `${s.name} ${s.id} ${s.orderId || ''} ${s.customer}`.toLowerCase();
    return haystack.includes(query);
  });

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">จัดส่งแล้ว</h1>
          <span className="ml-auto text-xs text-stone-500 tabular-nums">
            {filtered.length}/{allShipped.length} รายการ
          </span>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        {/* Filters */}
        <form action="/shipped" className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="ค้นชื่องาน / ลูกค้า / id..."
              className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
          <select
            name="year"
            defaultValue={year || ''}
            className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white tabular-nums focus:outline-none focus:border-accent"
          >
            <option value="">ทุกปี</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y + 543}
              </option>
            ))}
          </select>
          <select
            name="month"
            defaultValue={month || ''}
            className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent"
          >
            <option value="">ทุกเดือน</option>
            {THAI_MONTHS_FULL.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-dark"
          >
            กรอง
          </button>
          {(query || year || month) && (
            <a href="/shipped" className="text-xs text-stone-500 hover:text-stone-700 underline">
              ล้างตัวกรอง
            </a>
          )}
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <ShippedClient rows={filtered} />
          <Link
            href="/archive"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
          >
            <IconFolder size={13} />
            ค้นหาในประวัติ
          </Link>
        </div>

        {errorMessage ? (
          <ErrorBox message={errorMessage} />
        ) : filtered.length === 0 ? (
          <EmptyState filtered={!!(query || year || month)} />
        ) : (
          <>
            <PageSizeBar total={filtered.length} perPage={perPage} shown={Math.min(filtered.length, perPage)} />
            <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-14">#</th>
                  <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-3 py-2 font-medium">ลูกค้า</th>
                  <th className="text-right px-3 py-2 font-medium whitespace-nowrap">วันที่จัดส่ง</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">เดือน</th>
                  <th className="text-left px-3 py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, perPage).map((s) => (
                  <tr key={s.id} className="hover:bg-emerald-50/30">
                    <td className="px-3 py-2 tabular-nums text-stone-500">#{s.id}</td>
                    <td className="px-3 py-2 font-medium text-stone-900">{s.name}</td>
                    <td className="px-3 py-2 text-stone-600">{s.customer || '—'}</td>
                    <td className="px-3 py-2 text-right text-stone-700 tabular-nums whitespace-nowrap">
                      {displayDate(s.shippedDate)}
                    </td>
                    <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{s.monthLabel}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        จัดส่งแล้ว
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > perPage && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง {perPage} จาก {filtered.length} — ปรับจำนวนข้างบนหรือใช้ตัวกรองเพื่อจำกัด
              </div>
            )}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconTruck size={36} />
      </div>
      <p className="text-sm text-stone-500">
        {filtered ? 'ไม่พบงานที่ตรงตามตัวกรอง' : 'ยังไม่มีงานที่จัดส่งแล้ว'}
      </p>
    </div>
  );
}
