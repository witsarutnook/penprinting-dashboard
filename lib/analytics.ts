import type { Order, Job, Shipped, LoadAllResponse } from './types';

/**
 * Pure analytics computation — port of renderAnalytics() in
 * production-monitoring/assets/production-monitoring.js (lines ~3978+).
 *
 * Goal: same numbers as the legacy WP dashboard, computed server-side
 * so the page is mostly static HTML (no Chart.js bundle to ship yet).
 */

// ─── Date parsing — sheet has DD/MM/YYYY (user-entered) + ISO-ish strings (Date.toString()) ───

const DMY_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

export function parseDateDMY(input: string | null | undefined): Date | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;
  const m = s.match(DMY_RE);
  if (m) {
    const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Month buckets — last N months from today, oldest first ───

export interface MonthBucket {
  /** First-of-month Date for sorting/comparison */
  start: Date;
  /** Display label e.g. "พ.ค. 26" */
  label: string;
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export function buildMonthBuckets(nMonths: number): MonthBucket[] {
  const now = new Date();
  const buckets: MonthBucket[] = [];
  for (let i = nMonths - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearShort = String(d.getFullYear() + 543).substring(2);  // BE → 2 digits
    buckets.push({ start: d, label: `${THAI_MONTHS[d.getMonth()]} ${yearShort}` });
  }
  return buckets;
}

function bucketIndexFor(date: Date | null, buckets: MonthBucket[]): number {
  if (!date) return -1;
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (date >= buckets[i].start) return i;
  }
  return -1;
}

// ─── KPIs ───

export interface AnalyticsKPIs {
  totalNew: number;          // ใบสั่งใหม่รวม
  totalShipped: number;      // จัดส่งสำเร็จ
  monthlyAvg: string;        // เฉลี่ย/เดือน (formatted to 1 decimal)
  avgTurnaround: string;     // เฉลี่ยรับ→ส่ง วัน (formatted, or '—' if no data)
  activeNow: number;         // งานในระบบตอนนี้
  rangeMonths: number;       // ช่วงที่ใช้คำนวณ
}

export interface AnalyticsTrendPoint {
  label: string;
  newOrders: number;
  shipped: number;
  /** avg turnaround days for jobs shipped this month, null if no data */
  turnaround: number | null;
}

export interface TopCustomer {
  name: string;
  count: number;
}

export interface DeptWorkload {
  graphic: number;
  print: number;
  post: number;
}

export interface AnalyticsResult {
  kpis: AnalyticsKPIs;
  trend: AnalyticsTrendPoint[];
  topCustomers: TopCustomer[];
  deptWorkload: DeptWorkload;
}

export function computeAnalytics(data: LoadAllResponse, nMonths: number = 12): AnalyticsResult {
  const buckets = buildMonthBuckets(nMonths);
  const newPerMonth = new Array(buckets.length).fill(0);
  const shippedPerMonth = new Array(buckets.length).fill(0);
  const turnSums = new Array(buckets.length).fill(0);
  const turnCounts = new Array(buckets.length).fill(0);

  // New orders per month (by dateIn)
  data.orders.forEach((o: Order) => {
    const i = bucketIndexFor(parseDateDMY(o.dateIn), buckets);
    if (i >= 0) newPerMonth[i]++;
  });

  // Shipped per month + turnaround calc
  const ordersById = new Map<number, Order>();
  data.orders.forEach(o => ordersById.set(Number(o.id), o));

  data.shipped.forEach((sj: Shipped) => {
    const dShip = parseDateDMY(sj.shippedDate);
    const i = bucketIndexFor(dShip, buckets);
    if (i < 0) return;
    shippedPerMonth[i]++;
    if (!sj.orderId) return;
    const ord = ordersById.get(Number(sj.orderId));
    if (!ord) return;
    const dIn = parseDateDMY(ord.dateIn);
    if (!dIn || !dShip) return;
    const days = (dShip.getTime() - dIn.getTime()) / 86400000;
    if (days < 0 || days > 365) return;
    turnSums[i] += days;
    turnCounts[i]++;
  });

  const turnPerMonth = turnSums.map((s, i) =>
    turnCounts[i] > 0 ? +(s / turnCounts[i]).toFixed(1) : null,
  );

  const totalNew = newPerMonth.reduce((a, b) => a + b, 0);
  const totalShipped = shippedPerMonth.reduce((a, b) => a + b, 0);
  const validTurns = turnPerMonth.filter((v): v is number => v !== null);
  const avgTurnaround = validTurns.length > 0
    ? (validTurns.reduce((a, b) => a + b, 0) / validTurns.length).toFixed(1)
    : '—';
  const monthlyAvg = (totalNew / Math.max(buckets.length, 1)).toFixed(1);

  // Active jobs = current jobs sheet length (not bucket-dependent)
  const activeNow = (data.jobs as Job[]).length;

  // Top 10 customers (by # of orders in range)
  const custCounts: Record<string, number> = {};
  data.orders.forEach((o: Order) => {
    const i = bucketIndexFor(parseDateDMY(o.dateIn), buckets);
    if (i < 0) return;
    const c = (o.customer || '-').trim() || '-';
    if (c === '-') return;
    custCounts[c] = (custCounts[c] || 0) + 1;
  });
  const topCustomers: TopCustomer[] = Object.entries(custCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Dept workload — current active jobs by dept (not bucket-dependent)
  const deptWorkload: DeptWorkload = { graphic: 0, print: 0, post: 0 };
  (data.jobs as Job[]).forEach(j => {
    if (j.dept === 'graphic' || j.dept === 'print' || j.dept === 'post') {
      deptWorkload[j.dept]++;
    }
  });

  return {
    kpis: {
      totalNew,
      totalShipped,
      monthlyAvg,
      avgTurnaround,
      activeNow,
      rangeMonths: nMonths,
    },
    trend: buckets.map((b, i) => ({
      label: b.label,
      newOrders: newPerMonth[i],
      shipped: shippedPerMonth[i],
      turnaround: turnPerMonth[i],
    })),
    topCustomers,
    deptWorkload,
  };
}

// ─── Monthly Report — single-month deep dive (port of WP renderReport) ───

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

export interface MonthlyReportSummary {
  totalNew: number;
  totalShipped: number;
  totalCancelled: number;
  activeCount: number;
  /** ratio out of (shipped + cancelled), null when both are 0 */
  successRate: number | null;
  /** average dateIn → shippedDate in days, null when no shipped */
  avgTurnaround: number | null;
  /** % shipped within dateDue, null when no order had a due date */
  onTimeRate: number | null;
  /** % change vs previous month — null when prev month had 0 baseline */
  deltaNewPct: number | null;
  deltaShippedPct: number | null;
}

export interface MonthlyReportCustomers {
  unique: number;
  new: number;
  returning: number;
  top10: Array<{ name: string; count: number }>;
}

export interface MonthlyReportDept {
  count: number;
  staff: Array<{ id: string; count: number }>;
}

export interface MonthlyReport {
  year: number;
  month: number; // 1-12
  monthLabel: string; // "พฤษภาคม 2569"
  summary: MonthlyReportSummary;
  customers: MonthlyReportCustomers;
  perDept: { graphic: MonthlyReportDept; print: MonthlyReportDept; post: MonthlyReportDept };
  /** YYYY-MM strings for every month that has at least one order — for the picker */
  availableMonths: string[];
}

/** Compute single-month deep-dive report. Mirrors `renderReport()` in WP
 *  (production-monitoring.js ~line 4584) section by section. */
export function computeMonthlyReport(
  data: LoadAllResponse,
  year: number,
  month: number, // 1-12
): MonthlyReport {
  const inMonth = (d: Date | null) => !!d && d.getFullYear() === year && d.getMonth() === month - 1;

  const prevMonthDate = new Date(year, month - 2, 1);
  const prevYr = prevMonthDate.getFullYear();
  const prevMo = prevMonthDate.getMonth();
  const inPrevMonth = (d: Date | null) =>
    !!d && d.getFullYear() === prevYr && d.getMonth() === prevMo;

  const monthlyOrders = data.orders.filter((o) => inMonth(parseDateDMY(o.dateIn)));
  const monthlyShipped = data.shipped.filter((s) => inMonth(parseDateDMY(s.shippedDate)));
  const monthlyCancelled = data.cancelled.filter((c) => {
    // cancelledAt is "DD/MM/YYYY HH:MM" — just take the date part
    const datePart = (c.cancelledAt || '').split(' ')[0];
    return inMonth(parseDateDMY(datePart));
  });

  // ─── Summary ───
  const totalNew = monthlyOrders.length;
  const totalShipped = monthlyShipped.length;
  const totalCancelled = monthlyCancelled.length;
  const finished = totalShipped + totalCancelled;
  const successRate = finished > 0 ? Math.round((totalShipped / finished) * 1000) / 10 : null;

  // Active = jobs whose linked order's dateIn falls in this month
  const orderById = new Map<number, Order>();
  data.orders.forEach((o) => orderById.set(Number(o.id), o));
  const activeCount = data.jobs.filter((j) => {
    if (!j.orderId) return false;
    const o = orderById.get(Number(j.orderId));
    return o ? inMonth(parseDateDMY(o.dateIn)) : false;
  }).length;

  // Turnaround + on-time: only meaningful for shipped jobs that had a dueDate
  const turnaroundDays: number[] = [];
  let onTime = 0;
  let dueTotal = 0;
  monthlyShipped.forEach((s) => {
    if (!s.orderId) return;
    const ord = orderById.get(Number(s.orderId));
    if (!ord) return;
    const dIn = parseDateDMY(ord.dateIn);
    const dShip = parseDateDMY(s.shippedDate);
    const dDue = parseDateDMY(ord.dateDue);
    if (dIn && dShip) {
      const days = (dShip.getTime() - dIn.getTime()) / 86400000;
      if (days >= 0 && days < 365) turnaroundDays.push(days);
    }
    if (dDue && dShip) {
      dueTotal++;
      if (dShip.getTime() <= dDue.getTime()) onTime++;
    }
  });
  const avgTurnaround = turnaroundDays.length > 0
    ? Math.round((turnaroundDays.reduce((a, b) => a + b, 0) / turnaroundDays.length) * 10) / 10
    : null;
  const onTimeRate = dueTotal > 0 ? Math.round((onTime / dueTotal) * 100) : null;

  const prevOrders = data.orders.filter((o) => inPrevMonth(parseDateDMY(o.dateIn))).length;
  const prevShipped = data.shipped.filter((s) => inPrevMonth(parseDateDMY(s.shippedDate))).length;
  const pct = (curr: number, prev: number): number | null =>
    prev === 0 ? null : Math.round(((curr - prev) / prev) * 100);

  const summary: MonthlyReportSummary = {
    totalNew,
    totalShipped,
    totalCancelled,
    activeCount,
    successRate,
    avgTurnaround,
    onTimeRate,
    deltaNewPct: pct(totalNew, prevOrders),
    deltaShippedPct: pct(totalShipped, prevShipped),
  };

  // ─── Customers ───
  const customerCounts = new Map<string, number>();
  monthlyOrders.forEach((o) => {
    const c = (o.customer || '-').trim() || '-';
    if (c === '-') return;
    customerCounts.set(c, (customerCounts.get(c) || 0) + 1);
  });

  // Customers seen before this month (for new vs returning split)
  const earlierCustomers = new Set<string>();
  data.orders.forEach((o) => {
    const d = parseDateDMY(o.dateIn);
    if (!d) return;
    if (d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() < month - 1)) {
      const c = (o.customer || '-').trim();
      if (c && c !== '-') earlierCustomers.add(c);
    }
  });
  let newCustomers = 0;
  customerCounts.forEach((_, name) => {
    if (!earlierCustomers.has(name)) newCustomers++;
  });

  const top10 = Array.from(customerCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const customers: MonthlyReportCustomers = {
    unique: customerCounts.size,
    new: newCustomers,
    returning: customerCounts.size - newCustomers,
    top10,
  };

  // ─── Per-dept performance ───
  // Strategy: count distinct orderIds per dept. Source 1: audit_log addJob/updateJob
  // events in this month → map to orderId. Source 2 (fallback): orders with
  // assignDept set + dateIn in this month — catches orders whose audit entries
  // were archived or whose addJob failed silently. Sets dedupe naturally.
  const jobToOrder = new Map<string, string>();
  data.jobs.forEach((j) => { if (j.orderId) jobToOrder.set(String(j.id), String(j.orderId)); });
  data.shipped.forEach((s) => { if (s.orderId) jobToOrder.set(String(s.id), String(s.orderId)); });
  data.cancelled.forEach((c) => { if (c.orderId) jobToOrder.set(String(c.id), String(c.orderId)); });

  const deptOrderIds = {
    graphic: new Set<string>(),
    print: new Set<string>(),
    post: new Set<string>(),
  };
  const deptStaffOrderIds: Record<'graphic' | 'print' | 'post', Map<string, Set<string>>> = {
    graphic: new Map(),
    print: new Map(),
    post: new Map(),
  };

  const parseAuditDate = (ts: string): Date | null => {
    if (!ts) return null;
    // audit_log timestamp: ISO or "DD/MM/YYYY HH:MM:SS" — try both
    const direct = new Date(ts);
    if (!isNaN(direct.getTime())) return direct;
    const datePart = ts.split(' ')[0];
    return parseDateDMY(datePart);
  };

  const parseDeptFromSummary = (sum: string): 'graphic' | 'print' | 'post' | null => {
    // Summary shape: "เพิ่มงาน \"name\" → dept/staff" — pluck dept after the arrow
    const m = sum.match(/→\s*(graphic|print|post)\b/);
    return m ? (m[1] as 'graphic' | 'print' | 'post') : null;
  };

  data.audit.forEach((a) => {
    if (a.action !== 'addJob' && a.action !== 'updateJob') return;
    if (!inMonth(parseAuditDate(a.timestamp))) return;
    const dept = parseDeptFromSummary(a.summary);
    if (!dept) return;

    const jobId = String(a.targetId);
    let orderId = jobToOrder.get(jobId);
    if (!orderId) {
      // Fallback: match by job name in summary
      const nameMatch = a.summary.match(/"([^"]+)"/);
      if (nameMatch) {
        const found = data.orders.find((o) => o.name === nameMatch[1]);
        if (found) orderId = String(found.id);
      }
    }
    if (!orderId) return;

    deptOrderIds[dept].add(orderId);
    const staffMatch = a.summary.match(/→\s*\w+\/(\S+)/);
    const staffId = (staffMatch ? staffMatch[1] : '').trim() || '-';
    if (!deptStaffOrderIds[dept].has(staffId)) deptStaffOrderIds[dept].set(staffId, new Set());
    deptStaffOrderIds[dept].get(staffId)!.add(orderId);
  });

  // Source 2: orders.assignDept fallback
  data.orders.forEach((o) => {
    if (o.status === 'draft') return;
    const dept = o.assignDept;
    if (dept !== 'graphic' && dept !== 'print' && dept !== 'post') return;
    if (!inMonth(parseDateDMY(o.dateIn))) return;
    const oid = String(o.id);
    deptOrderIds[dept].add(oid);
    const staffId = (o.assignStaff || '').trim() || '-';
    if (!deptStaffOrderIds[dept].has(staffId)) deptStaffOrderIds[dept].set(staffId, new Set());
    deptStaffOrderIds[dept].get(staffId)!.add(oid);
  });

  const buildDept = (dk: 'graphic' | 'print' | 'post'): MonthlyReportDept => {
    const staffArr = Array.from(deptStaffOrderIds[dk].entries())
      .map(([id, ids]) => ({ id, count: ids.size }))
      .sort((a, b) => b.count - a.count);
    return { count: deptOrderIds[dk].size, staff: staffArr };
  };

  const perDept = {
    graphic: buildDept('graphic'),
    print: buildDept('print'),
    post: buildDept('post'),
  };

  // ─── Available months — every distinct YYYY-MM with at least one order ───
  const monthSet = new Set<string>();
  data.orders.forEach((o) => {
    const d = parseDateDMY(o.dateIn);
    if (!d) return;
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthSet.add(yyyymm);
  });
  const availableMonths = Array.from(monthSet).sort().reverse();

  return {
    year,
    month,
    monthLabel: `${THAI_MONTHS_FULL[month - 1]} ${year + 543}`,
    summary,
    customers,
    perDept,
    availableMonths,
  };
}
