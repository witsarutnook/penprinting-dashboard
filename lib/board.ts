import type { Job, Order, LoadAllResponse } from './types';
import { parseDateDMY } from './analytics';
import { computeUrgency, getBangkokToday, type Urgency, URGENCY_COLORS, URGENCY_LABELS } from './calendar';

export { URGENCY_COLORS, URGENCY_LABELS };
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

export interface BoardJob {
  id: number;
  name: string;
  /** Display label for the customer (resolved via orderId → orders) */
  customer: string | null;
  staff: string;
  dept: Dept | string;
  /** Due date string DD/MM/YYYY */
  dateRaw: string;
  /** Parsed due date (server side) */
  dueDate: Date | null;
  urgency: Urgency;
  /** Days until due (negative = overdue, 0 = D-day) — only valid if dueDate present */
  daysUntilDue: number | null;
  orderId: number | null;
  hasCowork: boolean;
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
  generatedAt: string;
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, dday: 1, urgent: 2, normal: 3 };

/** Build the kanban view from loadAll snapshot. Sort: urgency severity → due date asc → name. */
export function computeBoard(data: LoadAllResponse): BoardSnapshot {
  const today = getBangkokToday();
  const ordersById = new Map<number, Order>();
  data.orders.forEach((o) => ordersById.set(Number(o.id), o));

  // Index jobs by dept+staff
  const byKey = new Map<string, BoardJob[]>();
  const totals: Record<Urgency, number> = { overdue: 0, dday: 0, urgent: 0, normal: 0 };

  data.jobs.forEach((j: Job) => {
    const due = parseDateDMY(j.date);
    const urgency = computeUrgency(due, today);
    const order = j.orderId ? ordersById.get(Number(j.orderId)) : null;
    const customer = order ? order.customer : null;
    const daysUntilDue = due
      ? Math.floor((due.getTime() - today.getTime()) / 86400000)
      : null;
    const job: BoardJob = {
      id: Number(j.id),
      name: String(j.name || ''),
      customer,
      staff: String(j.staff || ''),
      dept: j.dept,
      dateRaw: String(j.date || ''),
      dueDate: due,
      urgency,
      daysUntilDue,
      orderId: j.orderId ? Number(j.orderId) : null,
      hasCowork: Array.isArray(j.cowork) && j.cowork.length > 0,
    };
    const key = `${j.dept}:${j.staff}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(job);
    totals[urgency]++;
  });

  // Sort each bucket
  const sortJobs = (jobs: BoardJob[]) => {
    jobs.sort((a, b) => {
      const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (r !== 0) return r;
      const aDue = a.dueDate?.getTime() ?? Infinity;
      const bDue = b.dueDate?.getTime() ?? Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return a.name.localeCompare(b.name, 'th');
    });
  };

  const depts: BoardDept[] = (['graphic', 'print', 'post'] as Dept[]).map((dept) => {
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
    generatedAt: new Date().toISOString(),
  };
}
