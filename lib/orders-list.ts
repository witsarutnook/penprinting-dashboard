import type { Job, Order } from '@/lib/types';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, URGENCY_LABELS } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';
import type { OrderRow } from '@/app/orders/orders-table';
import type { OrphanOrder, DuplicateGroup } from '@/app/orders/data-audit-modal';

/**
 * Pure /orders list computation — enrich orders into table rows, apply the
 * filter pipeline, and build the data-audit (orphans + duplicates) sets.
 *
 * Extracted from the server `OrdersData` so the delta-fetch client
 * (`OrdersListClient`) and the server-rendered path share ONE source of
 * truth. Pure — no DB, no fetch, no React — safe on both server and client.
 */

export interface OrdersListFilters {
  /** Lowercased free-text query (name / customer / id). */
  query: string;
  /** '' | 'sent' | 'draft' | 'shipped' | 'cancelled' */
  statusFilter: string;
  /** YYYY-MM-DD — dateIn range bounds; '' = unbounded. */
  fromIso: string;
  toIso: string;
}

export interface OrdersListInput {
  orders: Order[];
  jobs: Job[];
  /** Distinct orderIds present in the shipped / cancelled tables. */
  shippedOrderIds: number[];
  cancelledOrderIds: number[];
}

export interface OrdersListResult {
  /** Enriched rows passing the filter pipeline — fed to OrdersTable. */
  rows: OrderRow[];
  /** Enriched row count BEFORE filtering — the "X/Y ใบ" denominator. */
  totalCount: number;
  orphans: OrphanOrder[];
  duplicates: DuplicateGroup[];
}

export function computeOrdersList(
  input: OrdersListInput,
  filters: OrdersListFilters,
): OrdersListResult {
  const today = getBangkokToday();
  const allOrders = [...input.orders].sort((a, b) => Number(b.id) - Number(a.id));

  // Index jobs / shipped / cancelled by orderId. Jobs is one-to-many because
  // an order can have multiple active jobs during recovery scenarios — keep
  // ALL of them and surface a "+N" badge when the count > 1. Picking the
  // lowest job id makes the primary "ขั้นตอนปัจจุบัน" stable across renders.
  const jobsByOrderId = new Map<number, Array<{ id: number; dept: string; staff: string; date: string }>>();
  for (const j of input.jobs) {
    if (!j.orderId) continue;
    const key = Number(j.orderId);
    const arr = jobsByOrderId.get(key) || [];
    arr.push({ id: Number(j.id), dept: j.dept, staff: j.staff, date: j.date });
    jobsByOrderId.set(key, arr);
  }
  const shippedByOrderId = new Set<number>(input.shippedOrderIds.map(Number));
  const cancelledByOrderId = new Set<number>(input.cancelledOrderIds.map(Number));

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

    // PERF-H2/M2: orders arrive SLIM (no rawData/details blob). `pin` is
    // projected to the top level by the board-delta loader; fall back to the
    // spec blobs only if a full order is ever passed (server-only callers).
    const pin = String(
      o.pin
      ?? (o.rawData && typeof o.rawData === 'object' ? (o.rawData as Record<string, unknown>).pin : undefined)
      ?? (o.details && typeof o.details === 'object' ? (o.details as Record<string, unknown>).pin : undefined)
      ?? '',
    );

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
      // Never inline the spec into the list row (PERF-H2/M2) — the detail
      // modal lazy-fetches it via /api/orders/raw/[id] on open.
      rawData: null,
    };
  });

  // Compare dates as YYYY-MM-DD strings in Bangkok time — timezone-free
  // lexical compare (the Date-object compare drifted a day at boundaries
  // on the UTC Vercel server, auditor M-orders-date-range-tz).
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

  // Orphans = orders.status='sent' with no matching job/shipped/cancelled
  // (already flagged in `enriched.isOrphan`); pull assignDept/Staff from the
  // original order for the recovery preselect.
  const ordersById = new Map<number, Order>();
  for (const o of allOrders) ordersById.set(Number(o.id), o);
  const orphans: OrphanOrder[] = enriched
    .filter((o) => o.isOrphan)
    .map((o) => {
      const src = ordersById.get(o.id);
      return {
        id: o.id,
        name: o.name,
        customer: o.customer,
        dateIn: o.dateIn,
        dateDue: o.dateDue,
        assignDept: String(src?.assignDept || ''),
        assignStaff: String(src?.assignStaff || ''),
      };
    });

  // Duplicates = jobs grouped by orderId+name with >1 row. Caused by
  // partial-failure forwards before bulkForward atomic landed.
  const groups = new Map<string, Array<{ id: number; dept: string; staff: string }>>();
  for (const j of input.jobs) {
    if (!j.orderId) continue;
    const key = `${j.orderId}|${j.name || ''}`;
    const arr = groups.get(key) || [];
    arr.push({ id: Number(j.id), dept: String(j.dept || ''), staff: String(j.staff || '') });
    groups.set(key, arr);
  }
  const duplicates: DuplicateGroup[] = [];
  groups.forEach((rows, key) => {
    if (rows.length > 1) {
      const sorted = [...rows].sort((a, b) => b.id - a.id); // newest first
      const [, name = ''] = key.split('|');
      duplicates.push({ orderId: Number(key.split('|')[0]), name, rows: sorted });
    }
  });

  return { rows: filtered, totalCount: enriched.length, orphans, duplicates };
}
