import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDateTime } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconAlertCircle, IconSearch } from '@/lib/icons';
import { DEPT_LABELS, type Dept } from '@/lib/board';
import { distinctYears, filterByYearMonth, THAI_MONTHS_FULL } from '@/lib/list-helpers';
import { PageSizeBar, resolvePerPage } from '@/components/page-size-bar';
import { CancelledClient, RestoreButton } from './client';

export const metadata: Metadata = {
  title: 'รายการยกเลิก',
};

interface SearchParams {
  q?: string;
  year?: string;
  month?: string;
  per?: string;
}

export default async function CancelledPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') redirect('/board?dept=post');

  const query = (searchParams.q || '').trim().toLowerCase();
  const year = Number(searchParams.year) || 0;
  const month = Number(searchParams.month) || 0;
  const perPage = resolvePerPage(searchParams.per);

  let cancelled;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    cancelled = [...data.cancelled].sort((a, b) => Number(b.id) - Number(a.id));
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const allCancelled = cancelled || [];
  const years = distinctYears(allCancelled, (c) => c.cancelledAt);
  const filtered = filterByYearMonth(allCancelled, (c) => c.cancelledAt, year, month).filter((c) => {
    if (!query) return true;
    const haystack = `${c.name} ${c.id} ${c.cancelledBy} ${c.reason}`.toLowerCase();
    return haystack.includes(query);
  });

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">รายการยกเลิก</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 hidden sm:inline">
            admin only
          </span>
          <span className="ml-auto text-xs text-stone-500 tabular-nums">
            {filtered.length}/{allCancelled.length} รายการ
          </span>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        {/* Filters */}
        <form action="/cancelled" className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="ค้นชื่องาน / ผู้ยกเลิก / เหตุผล..."
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
            <a href="/cancelled" className="text-xs text-stone-500 hover:text-stone-700 underline">
              ล้างตัวกรอง
            </a>
          )}
        </form>

        {/* Client toolbar — Export CSV */}
        <CancelledClient rows={filtered} />

        {errorMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-amber-800 font-mono">{errorMessage}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
            <div className="flex justify-center mb-2 text-stone-300">
              <IconAlertCircle size={36} />
            </div>
            <p className="text-sm text-stone-500">
              {query || year || month ? 'ไม่พบรายการที่ตรงตามตัวกรอง' : 'ไม่มีรายการยกเลิก'}
            </p>
          </div>
        ) : (
          <>
            <PageSizeBar total={filtered.length} perPage={perPage} shown={Math.min(filtered.length, perPage)} />
            <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-14">#</th>
                  <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-3 py-2 font-medium">แผนก</th>
                  <th className="text-left px-3 py-2 font-medium">ยกเลิกโดย</th>
                  <th className="text-right px-3 py-2 font-medium">วันที่ยกเลิก</th>
                  <th className="text-left px-3 py-2 font-medium">เหตุผล</th>
                  <th className="text-right px-3 py-2 font-medium w-24">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, perPage).map((c) => (
                  <tr key={c.id} className="hover:bg-red-50/30">
                    <td className="px-3 py-2 tabular-nums text-stone-500">#{c.id}</td>
                    <td className="px-3 py-2 font-medium text-red-700 line-through decoration-red-300">
                      {c.name}
                    </td>
                    <td className="px-3 py-2 text-stone-600">
                      {DEPT_LABELS[c.dept as Dept] || c.dept || '—'}
                    </td>
                    <td className="px-3 py-2 text-stone-600">{c.cancelledBy || '—'}</td>
                    <td className="px-3 py-2 text-right text-stone-500 tabular-nums whitespace-nowrap">
                      {displayDateTime(c.cancelledAt)}
                    </td>
                    <td className="px-3 py-2 text-stone-600 max-w-[18rem] truncate" title={c.reason}>
                      {c.reason || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RestoreButton id={c.id} name={c.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > perPage && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง {perPage} จาก {filtered.length} — ปรับจำนวนข้างบนหรือใช้ตัวกรองเพื่อจำกัดให้แคบลง
              </div>
            )}
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}

