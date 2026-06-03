import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadAllWithAudit, AppsScriptError } from '@/lib/api';
import { computeAnalytics, computeMonthlyReport } from '@/lib/analytics';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import {
  OrdersTrendChart,
  TurnaroundChart,
  TopCustomersChart,
  DeptWorkloadChart,
} from './charts-lazy';
import { MonthlyReportView } from './monthly-report';
import { DashboardShell } from '@/components/dashboard-shell';
import { redirect } from 'next/navigation';
import { getBangkokToday } from '@/lib/calendar';
import { STAFF, type Dept } from '@/lib/board';

export const metadata: Metadata = {
  title: 'Analytics',
};

const VALID_RANGES = [3, 6, 12] as const;
type Range = (typeof VALID_RANGES)[number];

type View = 'monthly' | 'range';

interface SearchParams {
  view?: string;
  months?: string;
  m?: string; // YYYY-MM
}

function parseRange(input: string | undefined): Range {
  const n = parseInt(input || '12', 10);
  return (VALID_RANGES as readonly number[]).includes(n) ? (n as Range) : 12;
}

function parseView(input: string | undefined): View {
  return input === 'range' ? 'range' : 'monthly';
}

function parseMonth(input: string | undefined): { year: number; month: number } {
  const fallback = (() => {
    const t = getBangkokToday();
    return { year: t.getFullYear(), month: t.getMonth() + 1 };
  })();
  if (!input) return fallback;
  const m = input.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  if (isNaN(y) || isNaN(mo) || mo < 1 || mo > 12) return fallback;
  return { year: y, month: mo };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/analytics');
  // Admin only — sales + staff get bounced to the Kanban (matches WP
  // ROLE_REQUIREMENTS where Analytics dashboard is admin-only).
  if (session.role !== 'admin') redirect('/board?dept=post');

  const view = parseView(searchParams.view);
  const months = parseRange(searchParams.months);
  const { year, month } = parseMonth(searchParams.m);

  return (
    <DashboardShell user={session.user} role={session.role}>
      {/* /analytics caches at 60s ISR — fresh aggregate report on each
       *  revalidation tick is enough; no need for the auto-sync poll. */}
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl font-bold text-stone-900">รายงาน</h1>
          {view === 'range' && <RangeSelector current={months} />}
        </div>
      </header>

      <SubTabBar view={view} />

      <div className="px-4 sm:px-6 py-6 max-w-6xl mx-auto">
        {view === 'monthly' ? (
          <Suspense key={`monthly-${year}-${month}`} fallback={<MonthlySkeleton />}>
            <MonthlyData year={year} month={month} />
          </Suspense>
        ) : (
          <Suspense key={`range-${months}`} fallback={<AnalyticsSkeleton />}>
            <AnalyticsData months={months} />
          </Suspense>
        )}
      </div>
    </DashboardShell>
  );
}

// ─── Sub-tab bar (matches WP report-subtabs row) ───

function SubTabBar({ view }: { view: View }) {
  return (
    <div className="border-b border-stone-100 bg-white">
      <div className="px-4 sm:px-6 flex items-center gap-2">
        <SubTab href="/analytics" label="รายงานประจำเดือน" active={view === 'monthly'} />
        <SubTab href="/analytics?view=range" label="Analytics 12 เดือน" active={view === 'range'} />
      </div>
    </div>
  );
}

function SubTab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`py-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'text-sky-700 border-sky-500'
          : 'text-stone-500 border-transparent hover:text-stone-700 hover:border-stone-200'
      }`}
    >
      {label}
    </Link>
  );
}

// ─── Monthly report data + skeleton ───

async function MonthlyData({ year, month }: { year: number; month: number }) {
  let report;
  let errorMessage: string | null = null;

  try {
    const data = await loadAllWithAudit();
    report = computeMonthlyReport(data, year, month);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  if (errorMessage) return <ErrorPanel message={errorMessage} />;
  if (!report) return null;

  // Resolve staff display names from STAFF map (lib/board) so the report
  // shows "เจ้" instead of "joy" etc. Done server-side so the client
  // doesn't ship the STAFF map for this page.
  const resolveName = (dept: Dept, id: string): string => {
    if (id === '-' || !id) return '— ไม่ระบุ';
    return STAFF[dept]?.find((s) => s.id === id)?.name || id;
  };

  const enrichDept = (dept: 'graphic' | 'print' | 'post') => {
    const d = report.perDept[dept];
    const groups = d.staff.map((s: { id: string; count: number }) => ({
      staffId: s.id,
      staffName: resolveName(dept, s.id),
      count: s.count,
      rows: d.rowsByStaff[s.id] || [],
    }));
    return {
      count: d.count,
      staff: d.staff.map((s: { id: string; count: number }) => ({
        ...s,
        name: resolveName(dept, s.id),
      })),
      rows: d.rows,
      groups,
    };
  };

  const enriched = {
    ...report,
    perDept: {
      graphic: enrichDept('graphic'),
      print: enrichDept('print'),
      post: enrichDept('post'),
    },
  };

  return <MonthlyReportView report={enriched} />;
}

function MonthlySkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-48 bg-stone-100 rounded-lg animate-pulse" />
      </div>
      {/* Summary stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-stone-200 p-4 space-y-2"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
            <div className="h-7 w-14 bg-stone-200 rounded animate-pulse" />
            <div className="h-2 w-12 bg-stone-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      {/* Customers section */}
      <div className="bg-white rounded-xl border border-stone-200 p-5 space-y-3">
        <div className="h-4 w-40 bg-stone-100 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-stone-50 rounded animate-pulse" />
          ))}
        </div>
      </div>
      {/* Per-dept */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 bg-white rounded-xl border border-stone-200 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ─── Analytics 12-month range (existing) ───

async function AnalyticsData({ months }: { months: Range }) {
  let result;
  let errorMessage: string | null = null;

  try {
    const data = await loadAllWithAudit();
    result = computeAnalytics(data, months);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  if (errorMessage) return <ErrorPanel message={errorMessage} />;
  if (!result) return null;

  return (
    <>
      <KPIGrid kpis={result.kpis} />
      <section className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OrdersTrendChart trend={result.trend} />
        <TurnaroundChart trend={result.trend} />
        <TopCustomersChart data={result.topCustomers} />
        <DeptWorkloadChart data={result.deptWorkload} />
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
          Trend รายเดือน — ตัวเลขละเอียด
        </h2>
        <TrendTable trend={result.trend} />
      </section>
      <p className="text-xs text-stone-400 mt-6 text-right">
        cache 60s · server-rendered · {months} เดือนล่าสุด
      </p>
    </>
  );
}

function AnalyticsSkeleton() {
  return (
    <div aria-hidden="true">
      {/* 5-card KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-stone-200 p-5 space-y-3"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
            <div className="h-8 w-24 bg-stone-200 rounded animate-pulse" />
            <div className="h-2 w-16 bg-stone-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
      {/* 4 chart cards */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-white rounded-xl border border-stone-200 p-5 h-72 animate-pulse"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
      {/* trend table */}
      <div className="mt-8 space-y-2">
        <div className="h-3 w-40 bg-stone-100 rounded animate-pulse" />
        <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
          <div className="bg-stone-50 p-3 flex gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-3 flex-1 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="border-t border-stone-100 p-2.5 flex gap-3">
              {[0, 1, 2, 3].map((i) => (
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
    </div>
  );
}

// ─── Range view components (unchanged) ───

function RangeSelector({ current }: { current: Range }) {
  return (
    <div className="inline-flex rounded-lg bg-stone-100 p-1 text-sm">
      {VALID_RANGES.map((n) => {
        const active = n === current;
        return (
          <Link
            key={n}
            href={n === 12 ? '/analytics?view=range' : `/analytics?view=range&months=${n}`}
            className={`px-4 py-1.5 rounded-md transition-colors ${
              active
                ? 'bg-white text-stone-900 shadow-sm font-medium'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            {n} เดือน
          </Link>
        );
      })}
    </div>
  );
}

function KPIGrid({ kpis }: { kpis: ReturnType<typeof computeAnalytics>['kpis'] }) {
  const cards = [
    { label: 'ใบสั่งใหม่รวม', value: kpis.totalNew, unit: 'ใบ', sub: `${kpis.rangeMonths} เดือน` },
    { label: 'จัดส่งสำเร็จ', value: kpis.totalShipped, unit: 'งาน', sub: `${kpis.rangeMonths} เดือน` },
    { label: 'เฉลี่ย/เดือน', value: kpis.monthlyAvg, unit: 'ใบ', sub: 'ใบสั่งใหม่' },
    { label: 'เฉลี่ยรับ→ส่ง', value: kpis.avgTurnaround, unit: 'วัน', sub: 'ตลอดช่วง' },
    { label: 'งานในระบบ', value: kpis.activeNow, unit: 'งาน', sub: 'ตอนนี้' },
  ];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div
          key={c.label}
          className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-300 transition-colors"
        >
          <div className="text-xs font-medium text-stone-500 uppercase tracking-wide">
            {c.label}
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-stone-900 tabular-nums">{c.value}</span>
            <span className="text-sm text-stone-500">{c.unit}</span>
          </div>
          <div className="text-xs text-stone-400 mt-1">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function TrendTable({ trend }: { trend: ReturnType<typeof computeAnalytics>['trend'] }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-stone-500 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-3 font-medium">เดือน</th>
            <th className="text-right px-4 py-3 font-medium">ใบสั่งใหม่</th>
            <th className="text-right px-4 py-3 font-medium">จัดส่ง</th>
            <th className="text-right px-4 py-3 font-medium">เฉลี่ยรับ→ส่ง</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((row) => (
            <tr key={row.label} className="border-t border-stone-100">
              <td className="px-4 py-2.5 text-stone-700">{row.label}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-stone-900">{row.newOrders}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-stone-900">{row.shipped}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-stone-500">
                {row.turnaround !== null ? `${row.turnaround} วัน` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Analytics ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
      <p className="text-xs text-amber-700 mt-4">
        ตรวจ env vars <code className="bg-amber-100 px-1">APPS_SCRIPT_URL</code> +{' '}
        <code className="bg-amber-100 px-1">APPS_SCRIPT_TOKEN</code> ใน Vercel — ครบ 3 environments หรือยัง?
      </p>
    </div>
  );
}
