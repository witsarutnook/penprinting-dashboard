import type { Job, Order, LoadAllResponse } from './types';
import { parseDateDMY } from './analytics';
import { computeUrgency, getBangkokToday, type Urgency, URGENCY_COLORS, URGENCY_LABELS, URGENCY_BADGE } from './calendar';

export { URGENCY_COLORS, URGENCY_LABELS, URGENCY_BADGE };
export type { Urgency };

/**
 * Kanban board — read-only display (Phase 3.5.1).
 *
 * STAFF data mirrors production-monitoring.js exactly so cards land in the
 * same columns as WP. v5.11.0 added `diecut_in` to post dept (between bind
 * and diecut_out).
 */

export type Dept = 'graphic' | 'print' | 'post';

export interface StaffDef {
  id: string;
  name: string;
  /** Vendor flag — marks restricted/external columns (purple style) */
  isVendor?: boolean;
  /** Role description (small text under name) */
  role: string;
}

export const DEPT_LABELS: Record<Dept, string> = {
  graphic: 'กราฟิก',
  print: 'พิมพ์',
  post: 'หลังพิมพ์/จัดส่ง',
};

/** Mirror of production-monitoring.js STAFF object. Keep in sync if WP changes. */
export const STAFF: Record<Dept, StaffDef[]> = {
  graphic: [
    { id: 'pook', name: 'ปุ๊ก', role: 'Graphic Designer' },
    { id: 'perl', name: 'เปิ้ล', role: 'Graphic Designer' },
    { id: 'aed', name: 'แอ๊ด', role: 'Graphic Designer' },
  ],
  print: [
    { id: 'sm74', name: 'SM74 (ต้อม)', role: 'Offset Press' },
    { id: 'mo5', name: 'MO 5สี (เกมส์)', role: 'Offset Press' },
    { id: 'mo', name: 'MO (วล)', role: 'Offset Press' },
    { id: 'hamada', name: 'Hamada (กุ้ง)', role: 'Offset Press' },
    { id: 'inkjet', name: 'Inkjet/Copyprint (แป๋)', role: 'Digital Press' },
    { id: 'outsource', name: 'Outsource', role: 'External Vendor', isVendor: true },
  ],
  post: [
    { id: 'cut', name: 'เครื่องตัด (หลง)', role: 'Cutting' },
    { id: 'bind', name: 'เข้าเล่ม', role: 'Binding' },
    { id: 'diecut_in', name: 'ไดคัท(ภายใน)', role: 'Internal Diecut' },
    { id: 'diecut_out', name: 'ไดคัท(นอก)', role: 'External Diecut', isVendor: true },
    { id: 'ship', name: 'รอจัดส่ง', role: 'Shipping' },
  ],
};

/** Compact summary of the parent order — denormalized into BoardJob so the
 *  detail modal has everything it needs without an extra fetch. Extended to
 *  match the full Order shape so the order edit form can prefill values
 *  without a second loadAll round-trip. */
export interface OrderSummary {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  price: string | number;
  /** Initial dept/staff assignment when the order was created. Edit form prefills with these. */
  assignDept: string;
  assignStaff: string;
  orderer: string;
  status: string;
  /** Whether the order has a non-empty spec — projected by the slim
   *  board-delta loader (PERF-H2/M2). Drives the card's "สเปคงาน" tab
   *  visibility without shipping the blob. */
  hasSpec?: boolean;
  /** Parsed details JSON (form fields). NULL on the slim board-delta path
   *  (PERF-H2/M2) — the detail modal + edit form lazy-fetch the full spec
   *  via /api/orders/raw/[id]. Populated only by server-side full loads. */
  details: Record<string, unknown> | null;
  /** Raw form snapshot — carries `orderType: 'photobook' | 'normal'`.
   *  NULL on the slim path (see `details`). */
  rawData: Record<string, unknown> | null;
}

export interface BoardJob {
  id: number;
  name: string;
  /** Display label for the customer (resolved via orderId → orders) */
  customer: string | null;
  staff: string;
  dept: Dept | string;
  /** Due date string DD/MM/YYYY */
  dateRaw: string;
  /** Parsed due date (server side, ISO string for client-safe transport) */
  dueIso: string | null;
  urgency: Urgency;
  /** Days until due (negative = overdue, 0 = D-day) — only valid if dueDate present */
  daysUntilDue: number | null;
  orderId: number | null;
  hasCowork: boolean;
  /** Co-work staff ids (print dept only) — string[] in WP format */
  cowork: unknown;
  /** Full order summary for detail modal — null if job has no orderId */
  order: OrderSummary | null;
  /** Where in workflow: dept-level status (e.g., 'in_progress', 'done') */
  status: string;
  /** Date job was started (DD/MM/YYYY) */
  dateInRaw: string;
  /** True when this card is a co-work guest copy (rendered in another print
   *  staff's column because they were added as a co-worker). */
  isGuest?: boolean;
  /** Guest column's staff id — set only on guest copies. The "เสร็จงาน
   *  Co-work" button removes THIS id from the host's cowork list. Distinct
   *  from `staff`, which on a guest still points at the host. */
  guestStaff?: string;
}

/** Parse cowork field — accepts WP format (`string[]` of print staff ids) AND
 *  legacy v2 format (`{dept,staff}[]`). Returns the print-dept staff id list. */
export function coworkPrintStaffIds(cowork: unknown): string[] {
  if (!Array.isArray(cowork)) return [];
  const ids: string[] = [];
  for (const c of cowork) {
    if (typeof c === 'string' && c.trim()) {
      ids.push(c.trim());
    } else if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      const dept = String(obj.dept || '').trim();
      const staff = String(obj.staff || '').trim();
      // Only print dept fans out (matches WP behavior)
      if ((dept === 'print' || dept === '') && staff) ids.push(staff);
    }
  }
  // Dedupe + filter to known print staff
  const valid = new Set(STAFF.print.map((s) => s.id));
  return Array.from(new Set(ids)).filter((id) => valid.has(id));
}

export interface BoardColumn {
  staff: StaffDef;
  jobs: BoardJob[];
}

export interface BoardDept {
  dept: Dept;
  label: string;
  columns: BoardColumn[];
}

export interface BoardSnapshot {
  depts: BoardDept[];
  totalJobs: number;
  totalsByUrgency: Record<Urgency, number>;
  /** Every BoardJob in the snapshot — pre-filter, no cowork fan-out duplicates.
   *  KPI detail modal uses this so the list matches the totals badge even
   *  when the board has a URL filter active (?u=, ?dept=, ?q=). */
  allJobs: BoardJob[];
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, dday: 1, urgent: 2, normal: 3 };

export interface BoardFilters {
  /** Filter by dept — sidebar deep-links use this. */
  dept?: Dept | '';
  /** Filter by urgency bucket — KPI cards / filter chips use this. */
  urgency?: Urgency | '';
  /** Free-text search across job name + customer + orderId. */
  query?: string;
}

/** Build the kanban view from a snapshot. Sort: urgency severity → due date asc → name.
 *  Optional `filters` apply so the rendered output reflects URL state immediately.
 *
 *  Input is narrowed to `jobs` + `orders` (the only fields read) so both the
 *  server `loadAll()` snapshot AND the client delta-fetch state ({ jobs,
 *  orders } held in BoardClient) satisfy it — see lib/delta-sync.tsx. */
export function computeBoard(
  data: Pick<LoadAllResponse, 'jobs' | 'orders'>,
  filters: BoardFilters = {},
): BoardSnapshot {
  const today = getBangkokToday();
  const ordersById = new Map<number, Order>();
  data.orders.forEach((o) => ordersById.set(Number(o.id), o));
  const queryLower = (filters.query || '').trim().toLowerCase();

  // Index jobs by dept+staff
  const byKey = new Map<string, BoardJob[]>();
  const totals: Record<Urgency, number> = { overdue: 0, dday: 0, urgent: 0, normal: 0 };
  const allJobs: BoardJob[] = [];

  data.jobs.forEach((j: Job) => {
    const due = parseDateDMY(j.date);
    const urgency = computeUrgency(due, today);
    const order = j.orderId ? ordersById.get(Number(j.orderId)) : null;
    const customer = order ? order.customer : null;
    const daysUntilDue = due
      ? Math.floor((due.getTime() - today.getTime()) / 86400000)
      : null;
    const orderSummary: OrderSummary | null = order
      ? {
          id: Number(order.id),
          name: String(order.name || ''),
          customer: String(order.customer || ''),
          dateIn: String(order.dateIn || ''),
          dateDue: String(order.dateDue || ''),
          price: order.price,
          assignDept: String(order.assignDept || ''),
          assignStaff: String(order.assignStaff || ''),
          orderer: String(order.orderer || ''),
          status: String(order.status || ''),
          hasSpec: !!order.hasSpec,
          details: (order.details && typeof order.details === 'object')
            ? (order.details as Record<string, unknown>)
            : null,
          rawData: (order.rawData && typeof order.rawData === 'object')
            ? (order.rawData as Record<string, unknown>)
            : null,
        }
      : null;
    const job: BoardJob = {
      id: Number(j.id),
      name: String(j.name || ''),
      customer,
      staff: String(j.staff || ''),
      dept: j.dept,
      dateRaw: String(j.date || ''),
      dueIso: due ? due.toISOString() : null,
      urgency,
      daysUntilDue,
      orderId: j.orderId ? Number(j.orderId) : null,
      hasCowork: Array.isArray(j.cowork) && j.cowork.length > 0,
      cowork: j.cowork ?? null,
      order: orderSummary,
      status: String(j.status || ''),
      dateInRaw: String(j.dateIn || ''),
    };
    // Always count totals + collect for KPI list (both ignore URL filters)
    totals[urgency]++;
    allJobs.push(job);

    // Apply per-job filters before bucketing into columns
    if (filters.dept && j.dept !== filters.dept) return;
    if (filters.urgency && urgency !== filters.urgency) return;
    if (queryLower) {
      const haystack = `${job.name} ${job.customer || ''} ${job.orderId || ''}`.toLowerCase();
      if (!haystack.includes(queryLower)) return;
    }

    const key = `${j.dept}:${j.staff}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(job);

    // Fan out: when a print-dept job has cowork members, also place a guest
    // copy in each cowork member's column (matches WP renderJobCard behavior).
    if (j.dept === 'print') {
      const coworkIds = coworkPrintStaffIds(j.cowork);
      for (const coStaff of coworkIds) {
        if (coStaff === j.staff) continue; // never duplicate to host's own column
        const guestKey = `print:${coStaff}`;
        if (!byKey.has(guestKey)) byKey.set(guestKey, []);
        byKey.get(guestKey)!.push({ ...job, isGuest: true, guestStaff: coStaff });
      }
    }
  });

  // Sort each bucket
  const sortJobs = (jobs: BoardJob[]) => {
    jobs.sort((a, b) => {
      const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (r !== 0) return r;
      const aDue = a.dueIso ? new Date(a.dueIso).getTime() : Infinity;
      const bDue = b.dueIso ? new Date(b.dueIso).getTime() : Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.name.localeCompare(b.name, 'th');
    });
  };

  const visibleDepts: Dept[] = filters.dept
    ? [filters.dept as Dept]
    : (['graphic', 'print', 'post'] as Dept[]);

  const depts: BoardDept[] = visibleDepts.map((dept) => {
    const columns: BoardColumn[] = STAFF[dept].map((staff) => {
      const jobs = byKey.get(`${dept}:${staff.id}`) || [];
      sortJobs(jobs);
      return { staff, jobs };
    });
    return { dept, label: DEPT_LABELS[dept], columns };
  });

  const totalJobs = totals.overdue + totals.dday + totals.urgent + totals.normal;

  return {
    depts,
    totalJobs,
    totalsByUrgency: totals,
    allJobs,
  };
}
