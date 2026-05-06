import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDate } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconAlertCircle, IconSearch } from '@/lib/icons';
import { DEPT_LABELS, type Dept } from '@/lib/board';

export const metadata: Metadata = {
  title: 'รายการยกเลิก',
};

interface SearchParams {
  q?: string;
}

export default async function CancelledPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') redirect('/board?dept=post');

  const query = (searchParams.q || '').trim().toLowerCase();

  let cancelled;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    cancelled = [...data.cancelled].sort((a, b) => Number(b.id) - Number(a.id));
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const filtered = (cancelled || []).filter((c) => {
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
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto space-y-4">
        <form action="/cancelled" className="relative w-full sm:w-80">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นชื่องาน / ผู้ยกเลิก / เหตุผล..."
            className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </form>
        {errorMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <p className="text-sm text-amber-800 font-mono">{errorMessage}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
            <div className="flex justify-center mb-2 text-stone-300">
              <IconAlertCircle size={36} />
            </div>
            <p className="text-sm text-stone-500">ไม่มีรายการยกเลิก</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">แผนก</th>
                  <th className="text-left px-4 py-2 font-medium">เหตุผล</th>
                  <th className="text-right px-4 py-2 font-medium hidden md:table-cell">ยกเลิกเมื่อ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, 200).map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2 tabular-nums text-stone-500">#{c.id}</td>
                    <td className="px-4 py-2 font-medium text-stone-900">{c.name}</td>
                    <td className="px-4 py-2 text-stone-600 hidden sm:table-cell">
                      {DEPT_LABELS[c.dept as Dept] || c.dept}
                    </td>
                    <td className="px-4 py-2 text-stone-600 max-w-xs truncate" title={c.reason}>
                      {c.reason}
                    </td>
                    <td className="px-4 py-2 text-right text-stone-500 tabular-nums hidden md:table-cell">
                      {displayDate(c.cancelledAt)}
                      <span className="text-stone-400 ml-2 hidden lg:inline">โดย {c.cancelledBy}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง 200 รายการแรก จาก {filtered.length}
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
