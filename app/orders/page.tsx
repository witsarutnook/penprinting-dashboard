import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { displayDate } from '@/lib/jobs';
import { AutoSync } from '@/lib/auto-sync';
import { IconSearch, IconFileText, IconPlus, IconAlertCircle, IconPrinter } from '@/lib/icons';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, URGENCY_COLORS, URGENCY_LABELS } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';
import { OrdersClient } from './client';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'รายการใบสั่งงาน',
};

interface SearchParams {
  q?: string;
  status?: string;
  from?: string;  // YYYY-MM-DD วันที่รับ from
  to?: string;    // YYYY-MM-DD วันที่รับ to
}

const STATUS_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'sent', label: 'สั่งแล้ว' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'shipped', label: 'จัดส่งแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
];

interface OrderRow {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  orderStatus: string;        // sent / draft / shipped / cancelled
  orderStatusLabel: string;
  orderStatusClass: string;
  step: string;               // "กราฟิก → ปุ๊ก" / "จัดส่งแล้ว" / "ยกเลิก" / "—"
  jobUrgency: string;         // urgency key for badge color
  jobUrgencyLabel: string;
  isOrphan: boolean;          // active order with no job
}

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
  const fromIso = (searchParams.from || '').trim();
  const toIso = (searchParams.to || '').trim();
  const fromDate = fromIso ? new Date(`${fromIso}T00:00:00`) : null;
  const toDate = toIso ? new Date(`${toIso}T23:59:59`) : null;

  let snap;
  let errorMessage: string | null = null;
  try {
    snap = await loadAll();
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const today = getBangkokToday();
  const allOrders = snap ? [...snap.orders].sort((a, b) => Number(b.id) - Number(a.id)) : [];

  // Index jobs / shipped / cancelled by orderId for O(1) step lookup
  const jobByOrderId = new Map<number, { dept: string; staff: string; date: string }>();
  const shippedByOrderId = new Set<number>();
  const cancelledByOrderId = new Set<number>();
  if (snap) {
    for (const j of snap.jobs) {
      if (j.orderId) jobByOrderId.set(Number(j.orderId), { dept: j.dept, staff: j.staff, date: j.date });
    }
    for (const s of snap.shipped) {
      if (s.orderId) shippedByOrderId.add(Number(s.orderId));
    }
    for (const c of snap.cancelled) {
      if (c.orderId) cancelledByOrderId.add(Number(c.orderId));
    }
  }

  const enriched: OrderRow[] = allOrders.map((o) => {
    const status = String(o.status || '').toLowerCase();
    const isShipped = status === 'shipped' || shippedByOrderId.has(Number(o.id));
    const isCancelled = status === 'cancelled' || cancelledByOrderId.has(Number(o.id));
    const job = jobByOrderId.get(Number(o.id));

    let step = '—';
    let jobUrgency: 'overdue' | 'dday' | 'urgent' | 'normal' = 'normal';
    let jobUrgencyLabel = '';
    let isOrphan = false;

    if (isCancelled) {
      step = 'ยกเลิก';
      jobUrgencyLabel = 'ยกเลิก';
    } else if (isShipped) {
      step = 'จัดส่งแล้ว';
      jobUrgencyLabel = 'จัดส่งแล้ว';
    } else if (job) {
      const deptLabel = DEPT_LABELS[job.dept as Dept] || job.dept;
      const staffName = STAFF[job.dept as Dept]?.find((s) => s.id === job.staff)?.name || job.staff;
      step = `${deptLabel} → ${staffName}`;
      const due = parseDateDMY(job.date);
      jobUrgency = computeUrgency(due, today);
      jobUrgencyLabel = URGENCY_LABELS[jobUrgency];
    } else if (status !== 'draft') {
      // Active order with no matching job — orphan
      step = 'ไม่พบงาน';
      jobUrgencyLabel = 'orphan';
      isOrphan = true;
    } else {
      step = 'ร่าง';
      jobUrgencyLabel = 'ร่าง';
    }

    let orderStatusLabel: string, orderStatusClass: string, normalised: string;
    if (isCancelled) {
      orderStatusLabel = 'ยกเลิก'; orderStatusClass = 'bg-red-50 text-red-700'; normalised = 'cancelled';
    } else if (isShipped) {
      orderStatusLabel = 'จัดส่งแล้ว'; orderStatusClass = 'bg-emerald-50 text-emerald-700'; normalised = 'shipped';
    } else if (status === 'draft') {
      orderStatusLabel = 'ร่าง'; orderStatusClass = 'bg-amber-50 text-amber-700'; normalised = 'draft';
    } else {
      orderStatusLabel = 'สั่งแล้ว'; orderStatusClass = 'bg-sky-50 text-sky-700'; normalised = 'sent';
    }

    return {
      id: Number(o.id),
      name: String(o.name || ''),
      customer: String(o.customer || ''),
      dateIn: String(o.dateIn || ''),
      dateDue: String(o.dateDue || ''),
      orderStatus: normalised,
      orderStatusLabel,
      orderStatusClass,
      step,
      jobUrgency,
      jobUrgencyLabel,
      isOrphan,
    };
  });

  const filtered = enriched.filter((o) => {
    if (statusFilter && o.orderStatus !== statusFilter) return false;
    if (fromDate || toDate) {
      const d = parseDateDMY(o.dateIn);
      if (!d) return false;
      if (fromDate && d < fromDate) return false;
      if (toDate && d > toDate) return false;
    }
    if (query) {
      const haystack = `${o.name} ${o.customer} ${o.id}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const orphanCount = enriched.filter((o) => o.isOrphan).length;

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">รายการใบสั่งงาน</h1>
          <span className="ml-auto text-xs text-stone-500 tabular-nums">
            {filtered.length}/{enriched.length} ใบ
          </span>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto space-y-4">
        {/* Filters */}
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

        {/* Status pills */}
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

        {/* Toolbar — Export CSV + ตรวจสอบข้อมูล + + สั่งงานใหม่ */}
        <div className="flex flex-wrap items-center gap-2">
          <OrdersClient rows={filtered} />
          <Link
            href={orphanCount > 0 ? '/orders?status=sent' : '/orders'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
              orphanCount > 0
                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
            }`}
            title="ใบสั่งที่ยังไม่ได้สร้าง Job (ไม่นับ ร่าง / จัดส่งแล้ว / ยกเลิก)"
          >
            <IconAlertCircle size={13} />
            ตรวจสอบข้อมูล {orphanCount > 0 && `(${orphanCount})`}
          </Link>
          {(session.role === 'admin' || session.role === 'sales') && (
            <Link
              href="/orders/new"
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark"
            >
              <IconPlus size={13} />
              สั่งงานใหม่
            </Link>
          )}
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
              {query || statusFilter || fromIso || toIso
                ? 'ไม่พบใบสั่งงานตามเงื่อนไข'
                : 'ยังไม่มีใบสั่งงาน'}
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[1024px]">
              <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                <tr>
                  <th className="text-left px-3 py-2 font-medium w-12">#</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">เลขที่ใบสั่ง</th>
                  <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                  <th className="text-left px-3 py-2 font-medium">ลูกค้า</th>
                  <th className="text-right px-3 py-2 font-medium whitespace-nowrap">วันที่รับ</th>
                  <th className="text-right px-3 py-2 font-medium whitespace-nowrap">กำหนดส่ง</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะใบสั่ง</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ขั้นตอนปัจจุบัน</th>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะงาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filtered.slice(0, 500).map((o, idx) => {
                  const urgencyColor = o.jobUrgency in URGENCY_COLORS ? URGENCY_COLORS[o.jobUrgency as 'normal'] : '#9ca3af';
                  const showUrgencyBadge = o.step !== 'จัดส่งแล้ว' && o.step !== 'ยกเลิก' && o.step !== 'ร่าง' && o.step !== 'ไม่พบงาน';
                  const canEdit = (session.role === 'admin' || session.role === 'sales')
                    && o.orderStatus !== 'shipped' && o.orderStatus !== 'cancelled';
                  return (
                    <tr key={o.id} className={`hover:bg-stone-50 ${o.isOrphan ? 'bg-red-50/30' : ''}`}>
                      <td className="px-3 py-2 tabular-nums text-stone-400">{idx + 1}</td>
                      <td className="px-3 py-2 tabular-nums text-stone-700 font-medium whitespace-nowrap">
                        {canEdit ? (
                          <Link href={`/orders/${o.id}/edit`} className="text-sky-700 hover:underline">
                            #{o.id}
                          </Link>
                        ) : (
                          <>#{o.id}</>
                        )}
                        <Link
                          href={`/orders/${o.id}/print`}
                          target="_blank"
                          className="ml-1.5 text-stone-400 hover:text-sky-700"
                          title="พิมพ์ใบสั่งงาน"
                          aria-label="พิมพ์"
                        >
                          <IconPrinter size={12} className="inline-block" />
                        </Link>
                      </td>
                      <td className="px-3 py-2 font-medium text-stone-900 max-w-[14rem] truncate" title={o.name}>{o.name}</td>
                      <td className="px-3 py-2 text-stone-600 max-w-[12rem] truncate" title={o.customer}>{o.customer || '—'}</td>
                      <td className="px-3 py-2 text-right text-stone-500 tabular-nums whitespace-nowrap">{displayDate(o.dateIn)}</td>
                      <td className="px-3 py-2 text-right text-stone-700 tabular-nums whitespace-nowrap">{displayDate(o.dateDue)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${o.orderStatusClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            o.orderStatus === 'cancelled' ? 'bg-red-500'
                              : o.orderStatus === 'shipped' ? 'bg-emerald-500'
                                : o.orderStatus === 'draft' ? 'bg-amber-500'
                                  : 'bg-sky-500'
                          }`} />
                          {o.orderStatusLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{o.step}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {showUrgencyBadge ? (
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tabular-nums"
                            style={{ background: urgencyColor + '20', color: urgencyColor }}
                          >
                            {o.jobUrgencyLabel}
                          </span>
                        ) : (
                          <span className="text-stone-400 text-xs">{o.jobUrgencyLabel}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
                แสดง 500 รายการแรก จากทั้งหมด {filtered.length} — ใช้ตัวกรองเพื่อจำกัดให้แคบลง
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
