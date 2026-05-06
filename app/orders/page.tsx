import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession, type Session } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { AutoSync } from '@/lib/auto-sync';
import { IconSearch, IconFileText, IconPlus, IconAlertCircle } from '@/lib/icons';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, URGENCY_LABELS } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';
import { OrdersClient } from './client';
import { OrdersTable, type OrderRow } from './orders-table';
import { resolvePerPage } from '@/lib/page-size';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'รายการใบสั่งงาน',
};

interface SearchParams {
  q?: string;
  status?: string;
  from?: string;  // YYYY-MM-DD วันที่รับ from
  to?: string;    // YYYY-MM-DD วันที่รับ to
  per?: string;   // page size — 20 / 50 / 100 (default 20)
}

const STATUS_FILTERS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'sent', label: 'สั่งแล้ว' },
  { key: 'draft', label: 'ร่าง' },
  { key: 'shipped', label: 'จัดส่งแล้ว' },
  { key: 'cancelled', label: 'ยกเลิก' },
];

interface ResolvedFilters {
  query: string;
  statusFilter: string;
  fromIso: string;
  toIso: string;
  perPage: number;
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

  const filters: ResolvedFilters = {
    query: (searchParams.q || '').trim().toLowerCase(),
    statusFilter: searchParams.status || '',
    fromIso: (searchParams.from || '').trim(),
    toIso: (searchParams.to || '').trim(),
    perPage: resolvePerPage(searchParams.per),
  };

  // Suspense key — re-renders body when filters change without holding the
  // prior result on screen.
  const dataKey = `${filters.query}|${filters.statusFilter}|${filters.fromIso}|${filters.toIso}|${filters.perPage}`;

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">รายการใบสั่งงาน</h1>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto space-y-4">
        {/* Filter form — no data dependency, render in the first chunk */}
        <FilterForm filters={filters} />
        <StatusPills filters={filters} />

        <Suspense key={dataKey} fallback={<OrdersSkeleton />}>
          <OrdersData filters={filters} session={session} />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

async function OrdersData({
  filters,
  session,
}: {
  filters: ResolvedFilters;
  session: Session;
}) {
  let snap;
  let errorMessage: string | null = null;
  try {
    snap = await loadAll();
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

  const today = getBangkokToday();
  const allOrders = snap ? [...snap.orders].sort((a, b) => Number(b.id) - Number(a.id)) : [];

  // Index jobs / shipped / cancelled by orderId. Jobs is one-to-many because
  // an order can have multiple active jobs during recovery scenarios — keep
  // ALL of them and surface a "+N" badge when the count > 1 (auditor
  // M-jobByOrderId-last-write-wins). Picking the lowest job id makes the
  // primary "ขั้นตอนปัจจุบัน" stable across renders.
  const jobsByOrderId = new Map<number, Array<{ id: number; dept: string; staff: string; date: string }>>();
  const shippedByOrderId = new Set<number>();
  const cancelledByOrderId = new Set<number>();
  if (snap) {
    for (const j of snap.jobs) {
      if (!j.orderId) continue;
      const key = Number(j.orderId);
      const arr = jobsByOrderId.get(key) || [];
      arr.push({ id: Number(j.id), dept: j.dept, staff: j.staff, date: j.date });
      jobsByOrderId.set(key, arr);
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
    const orderJobs = jobsByOrderId.get(Number(o.id));
    const job = orderJobs && orderJobs.length > 0
      ? orderJobs.reduce((a, b) => (a.id <= b.id ? a : b))
      : undefined;
    const extraJobCount = orderJobs ? Math.max(0, orderJobs.length - 1) : 0;

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
      if (extraJobCount > 0) step += ` (+${extraJobCount})`;
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

    // Pull PIN from order rawData (if present) — surfaced in detail modal
    const rawData = (o.rawData && typeof o.rawData === 'object'
      ? o.rawData as Record<string, unknown>
      : {});
    const detailsRecord = (o.details && typeof o.details === 'object'
      ? o.details as Record<string, unknown>
      : {});
    const pin = String(rawData.pin || detailsRecord.pin || '');

    return {
      id: Number(o.id),
      name: String(o.name || ''),
      customer: String(o.customer || ''),
      dateIn: String(o.dateIn || ''),
      dateDue: String(o.dateDue || ''),
      orderer: String(o.orderer || ''),
      pin,
      orderStatus: normalised,
      orderStatusLabel,
      orderStatusClass,
      step,
      jobUrgency,
      jobUrgencyLabel,
      isOrphan,
    };
  });

  // Compare dates as `YYYY-MM-DD` strings in Bangkok time. The previous
  // shape compared Date objects across mixed time zones — `parseDateDMY`
  // returns a UTC midnight while `new Date('YYYY-MM-DDT00:00:00')` is in
  // server-local time. On Vercel (UTC server) with Bangkok-origin Sheet
  // dates, comparisons drifted by a day at boundaries (auditor
  // M-orders-date-range-tz). Lexical YYYY-MM-DD compare is timezone-free.
  const bangkokIsoFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateInIso = (raw: string): string | null => {
    const d = parseDateDMY(raw);
    if (!d) return null;
    return bangkokIsoFmt.format(d); // 'YYYY-MM-DD'
  };

  const filtered = enriched.filter((o) => {
    if (filters.statusFilter && o.orderStatus !== filters.statusFilter) return false;
    if (filters.fromIso || filters.toIso) {
      const iso = dateInIso(o.dateIn);
      if (!iso) return false;
      if (filters.fromIso && iso < filters.fromIso) return false;
      if (filters.toIso && iso > filters.toIso) return false;
    }
    if (filters.query) {
      const haystack = `${o.name} ${o.customer} ${o.id}`.toLowerCase();
      if (!haystack.includes(filters.query)) return false;
    }
    return true;
  });

  const orphanCount = enriched.filter((o) => o.isOrphan).length;

  return (
    <>
      {/* Toolbar — Export CSV + ตรวจสอบข้อมูล + count + + สั่งงานใหม่ */}
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
        <span className="text-xs text-stone-500 tabular-nums">
          {filtered.length}/{enriched.length} ใบ
        </span>
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
            {filters.query || filters.statusFilter || filters.fromIso || filters.toIso
              ? 'ไม่พบใบสั่งงานตามเงื่อนไข'
              : 'ยังไม่มีใบสั่งงาน'}
          </p>
        </div>
      ) : (
        <OrdersTable rows={filtered} role={session.role} perPage={filters.perPage} />
      )}
    </>
  );
}

/** Filter form — searchParams-driven defaults, no data dep. Renders in
 *  the first server chunk. */
function FilterForm({ filters }: { filters: ResolvedFilters }) {
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

function StatusPills({ filters }: { filters: ResolvedFilters }) {
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
