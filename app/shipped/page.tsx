import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDate } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconTruck, IconSearch } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'จัดส่งแล้ว',
};

interface SearchParams {
  q?: string;
}

export default async function ShippedPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/shipped');

  const query = (searchParams.q || '').trim().toLowerCase();

  let shipped;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    // Newest first
    shipped = [...data.shipped].sort((a, b) => Number(b.id) - Number(a.id));
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const filtered = (shipped || []).filter((s) => {
    if (!query) return true;
    const haystack = `${s.name} ${s.id} ${s.orderId || ''}`.toLowerCase();
    return haystack.includes(query);
  });

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3">
          <h1 className="text-xl font-bold text-stone-900">จัดส่งแล้ว</h1>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto space-y-4">
        <form action="/shipped" className="relative w-full sm:w-80">
          <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ค้นชื่องาน / id..."
            className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </form>
        {errorMessage ? (
          <ErrorBox message={errorMessage} />
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">Order</th>
                  <th className="text-right px-4 py-2 font-medium">วันที่จัดส่ง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, 200).map((s) => (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-4 py-2 tabular-nums text-stone-500">#{s.id}</td>
                    <td className="px-4 py-2 font-medium text-stone-900">{s.name}</td>
                    <td className="px-4 py-2 text-stone-500 tabular-nums hidden sm:table-cell">
                      {s.orderId ? `#${s.orderId}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-stone-700 tabular-nums">
                      {displayDate(s.shippedDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง 200 รายการแรก จาก {filtered.length} — ใส่คำค้นเพื่อจำกัด
              </div>
            )}
          </div>
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

function EmptyState() {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconTruck size={36} />
      </div>
      <p className="text-sm text-stone-500">ยังไม่มีงานที่จัดส่งแล้ว</p>
    </div>
  );
}
