import type { Job, Order, LoadAllResponse } from './types';
import { parseDateDMY } from './analytics';

/**
 * Calendar computation — port of renderCalendar() in production-monitoring.js
 *
 * Server-rendered with Asia/Bangkok timezone for "today" (Vercel runs in UTC,
 * so without TZ conversion the highlighted day would be wrong around midnight).
 */

export type Urgency = 'overdue' | 'dday' | 'urgent' | 'normal';
export type Dept = 'graphic' | 'print' | 'post';

export const URGENCY_LABELS: Record<Urgency, string> = {
  overdue: 'เลยกำหนด',
  dday: 'วันนี้!',
  urgent: 'ด่วน',
  normal: 'รอดำเนินการ',
};

export const URGENCY_COLORS: Record<Urgency, string> = {
  overdue: '#ef4444', // red
  dday:    '#7c3aed', // purple
  urgent:  '#ea580c', // orange
  normal:  '#3b82f6', // blue
};

/** WCAG-AA-compliant badge palette per urgency (Tailwind {bg-100, text-800}
 *  pairs). Use this instead of `URGENCY_COLORS[u] + '20'` for any element
 *  that needs to meet 4.5:1 contrast — the alpha-suffix pattern produced
 *  ~3.0-3.4:1 (failing AA) for the same hue. URGENCY_COLORS itself is
 *  retained for non-text accents (dots, borders, vendor cards).
 *  (Auditor A11Y-P1 finding, 2026-05-12.) */
export const URGENCY_BADGE: Record<Urgency, { bg: string; fg: string }> = {
  overdue: { bg: '#fee2e2', fg: '#991b1b' }, // red-100 / red-800     ~8.6:1
  dday:    { bg: '#ede9fe', fg: '#5b21b6' }, // violet-100 / violet-800 ~8.4:1
  urgent:  { bg: '#ffedd5', fg: '#9a3412' }, // orange-100 / orange-800 ~7.8:1
  normal:  { bg: '#dbeafe', fg: '#1e40af' }, // blue-100 / blue-800   ~8.5:1
};

export const DEPT_LABELS: Record<Dept, string> = {
  graphic: 'กราฟิก',
  print:   'พิมพ์',
  post:    'หลังพิมพ์/จัดส่ง',
};

/** Get today's date in Asia/Bangkok TZ as Date at local midnight (UTC+7).
 *  Server-side so consistent across all viewers. */
export function getBangkokToday(): Date {
  // Build a Date for "today in Bangkok" — use Intl with TZ to avoid offset bugs
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(new Date()).split('-').map(Number);
  // Construct as local Date for downstream comparisons (fine because we only
  // compare year/month/day fields, not timestamps)
  return new Date(y, m - 1, d);
}

/** Compute urgency relative to a "today" reference. */
export function computeUrgency(due: Date | null, today: Date): Urgency {
  if (!due) return 'normal';
  const dueMid = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.floor((dueMid.getTime() - todayMid.getTime()) / 86400000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'dday';
  if (days <= 3) return 'urgent';
  return 'normal';
}

export interface CalendarJob {
  id: number;
  name: string;
  dept: Dept | string;
  staff: string;
  customer: string | null;
  urgency: Urgency;
}

export interface CalendarDay {
  /** YYYY-MM-DD key */
  key: string;
  /** Day-of-month (1-31) */
  dayNum: number;
  /** Day of week 0=Sun..6=Sat */
  weekday: number;
  /** Date object (local midnight of that day) */
  date: Date;
  /** Whether this day is in the cursor month (false if padding) */
  inMonth: boolean;
  /** Whether this day is "today" (Bangkok TZ) */
  isToday: boolean;
  /** Whether this day is Sat/Sun */
  isWeekend: boolean;
  /** Jobs due that day (already sorted by urgency severity) */
  jobs: CalendarJob[];
  /** Urgency counts for badges */
  counts: Record<Urgency, number>;
}

/** Build the month grid (always pads to multiple of 7 starting Sunday). */
export function buildMonthGrid(year: number, month: number /* 0-11 */): Date[] {
  const days: Date[] = [];
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay();
  // Pad with previous month
  for (let i = startWeekday - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(new Date(year, month, d));
  }
  // Pad to fill the last week
  while (days.length % 7 !== 0) {
    const last = days[days.length - 1];
    days.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
  }
  return days;
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, dday: 1, urgent: 2, normal: 3 };

export interface CalendarFilters {
  dept?: Dept | '';
  urgency?: Urgency | '';
  customer?: string;
}

export interface CalendarMonth {
  year: number;
  month: number; // 0-11
  monthLabel: string;
  todayKey: string;
  days: CalendarDay[];
  totalJobs: number;
  totalsByUrgency: Record<Urgency, number>;
}

const TH_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function dateKey(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Main entry: build the calendar grid + per-day jobs for the cursor month. */
export function computeCalendar(
  data: Pick<LoadAllResponse, 'jobs' | 'orders'>,
  cursorYear: number,
  cursorMonth: number /* 0-11 */,
  filters: CalendarFilters = {},
): CalendarMonth {
  const today = getBangkokToday();
  const todayKey = dateKey(today);

  // Look up customer per job via order
  const ordersById = new Map<number, Order>();
  data.orders.forEach((o) => ordersById.set(Number(o.id), o));

  // Group jobs by day key + apply filters
  const dayMap = new Map<string, CalendarJob[]>();
  const totals: Record<Urgency, number> = { overdue: 0, dday: 0, urgent: 0, normal: 0 };
  const customerLower = (filters.customer || '').trim().toLowerCase();

  data.jobs.forEach((j: Job) => {
    const due = parseDateDMY(j.date);
    if (!due) return;
    if (filters.dept && j.dept !== filters.dept) return;
    const urgency = computeUrgency(due, today);
    if (filters.urgency && urgency !== filters.urgency) return;
    const order = j.orderId ? ordersById.get(Number(j.orderId)) : null;
    const customer = order ? order.customer : null;
    if (customerLower && (!customer || !customer.toLowerCase().includes(customerLower))) return;
    const key = dateKey(due);
    const calJob: CalendarJob = {
      id: Number(j.id),
      name: String(j.name || ''),
      dept: j.dept,
      staff: String(j.staff || ''),
      customer,
      urgency,
    };
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(calJob);
    totals[urgency]++;
  });

  // Sort each day's jobs by urgency severity then name
  dayMap.forEach((arr) => {
    arr.sort((a, b) => {
      const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      return r !== 0 ? r : a.name.localeCompare(b.name, 'th');
    });
  });

  // Build grid
  const gridDates = buildMonthGrid(cursorYear, cursorMonth);
  const days: CalendarDay[] = gridDates.map((d) => {
    const k = dateKey(d);
    const jobs = dayMap.get(k) || [];
    const counts: Record<Urgency, number> = { overdue: 0, dday: 0, urgent: 0, normal: 0 };
    jobs.forEach((j) => counts[j.urgency]++);
    return {
      key: k,
      dayNum: d.getDate(),
      weekday: d.getDay(),
      date: d,
      inMonth: d.getMonth() === cursorMonth,
      isToday: k === todayKey,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
      jobs,
      counts,
    };
  });

  const totalJobs = totals.overdue + totals.dday + totals.urgent + totals.normal;

  return {
    year: cursorYear,
    month: cursorMonth,
    monthLabel: `${TH_MONTHS[cursorMonth]} ${cursorYear + 543}`,
    todayKey,
    days,
    totalJobs,
    totalsByUrgency: totals,
  };
}
