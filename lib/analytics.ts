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

export interface AnalyticsResult {
  kpis: AnalyticsKPIs;
  trend: AnalyticsTrendPoint[];
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
  };
}
