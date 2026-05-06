import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDate } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconSearch, IconFileText } from '@/lib/icons';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'รายการใบสั่งงาน',
};

interface SearchParams {
  q?: string;
  status?: string;
}

const STATUS_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'sent', label: 'อยู่ระหว่างผลิต' },
  { key: 'shipped', label: 'จัดส่งแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
];

export default async function OrdersListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/orders');

  const query = (searchParams.q || '').trim().toLowerCase();
  const statusFilter = searchParams.status || '';

  let orders;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    // Newest first by id desc
    orders = [...data.orders].sort((a, b) => Number(b.id) - Number(a.id));
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const filtered = (orders || []).filter((o) => {
    const status = String(o.status || '').toLowerCase();
    if (statusFilter && status !== statusFilter) return false;
    if (query) {
      const haystack = `${o.name} ${o.customer} ${o.id} ${o.orderer || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3">
          <h1 className="text-xl font-bold text-stone-900">รายการใบสั่งงาน</h1>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        {/* Search + status filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <form action="/orders" className="relative w-full sm:w-80">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="ค้นชื่อ / ลูกค้า / id..."
              className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          </form>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((f) => {
              const active = statusFilter === f.key;
              const next = new URLSearchParams();
              if (query) next.set('q', query);
              if (f.key) next.set('status', f.key);
              const qs = next.toString();
              return (
                <Link
                  key={f.key || 'all'}
                  href={qs ? `/orders?${qs}` : '/orders'}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
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
        </div>

        {errorMessage ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
            <p className="text-sm text-amber-800 mt-2 font-mono">{errorMessage}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
            <div className="flex justify-center mb-2 text-stone-300">
              <IconFileText size={36} />
            </div>
            <p className="text-sm text-stone-500">
              {query || statusFilter ? 'ไม่พบใบสั่งงานตามเงื่อนไข' : 'ยังไม่มีใบสั่งงาน'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">#</th>
                  <th className="text-left px-4 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-4 py-2 font-medium hidden sm:table-cell">ลูกค้า</th>
                  <th className="text-right px-4 py-2 font-medium hidden md:table-cell">รับ</th>
                  <th className="text-right px-4 py-2 font-medium">กำหนดส่ง</th>
                  <th className="text-left px-4 py-2 font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, 200).map((o) => {
                  const status = String(o.status || '').toLowerCase();
                  const statusClass =
                    status === 'shipped'
                      ? 'bg-emerald-50 text-emerald-700'
                      : status === 'cancelled'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-sky-50 text-sky-700';
                  const statusLabel =
                    status === 'shipped' ? 'จัดส่งแล้ว' : status === 'cancelled' ? 'ยกเลิก' : 'อยู่ระหว่างผลิต';
                  return (
                    <tr key={o.id} className="hover:bg-stone-50">
                      <td className="px-4 py-2 tabular-nums text-stone-500">#{o.id}</td>
                      <td className="px-4 py-2 font-medium text-stone-900">{o.name}</td>
                      <td className="px-4 py-2 text-stone-600 hidden sm:table-cell">{o.customer}</td>
                      <td className="px-4 py-2 text-right text-stone-500 tabular-nums hidden md:table-cell">
                        {displayDate(o.dateIn)}
                      </td>
                      <td className="px-4 py-2 text-right text-stone-700 tabular-nums">
                        {displayDate(o.dateDue)}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง 200 รายการแรก จากทั้งหมด {filtered.length} รายการ — ใส่คำค้นเพื่อจำกัดให้แคบลง
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
