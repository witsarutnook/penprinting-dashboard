import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { computeAnalytics } from '@/lib/analytics';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import {
  OrdersTrendChart,
  TurnaroundChart,
  TopCustomersChart,
  DeptWorkloadChart,
} from './charts';
import { LogoutButton } from './logout-button';
import { AutoSync } from '@/lib/auto-sync';

export const metadata: Metadata = {
  title: 'Analytics',
};

const VALID_RANGES = [3, 6, 12] as const;
type Range = (typeof VALID_RANGES)[number];

interface SearchParams {
  months?: string;
}

function parseRange(input: string | undefined): Range {
  const n = parseInt(input || '12', 10);
  return (VALID_RANGES as readonly number[]).includes(n) ? (n as Range) : 12;
}

// Server Component — fetches Apps Script + computes everything server-side
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const months = parseRange(searchParams.months);
  // Middleware guarantees a valid session here, but read it for the header UI
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);

  let result;
  let errorMessage: string | null = null;

  try {
    const data = await loadAll();
    result = computeAnalytics(data, months);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <AutoSync />
      <header className="border-b border-stone-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-stone-500 hover:text-stone-700 text-sm">
              ←
            </Link>
            <h1 className="text-xl font-bold text-stone-900">Analytics</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <RangeSelector current={months} />
            {session && (
              <div className="flex items-center gap-2 text-xs text-stone-500 border-l border-stone-200 pl-3">
                <span>
                  {session.user} <span className="text-stone-400">({session.role})</span>
                </span>
                <LogoutButton />
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : result ? (
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
        ) : null}
      </div>
    </main>
  );
}

// ─── Components ───────────────────────────────────────────────

function RangeSelector({ current }: { current: Range }) {
  return (
    <div className="inline-flex rounded-lg bg-stone-100 p-1 text-sm">
      {VALID_RANGES.map((n) => {
        const active = n === current;
        return (
          <Link
            key={n}
            href={n === 12 ? '/analytics' : `/analytics?months=${n}`}
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
