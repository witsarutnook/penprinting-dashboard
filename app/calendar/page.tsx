import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import {
  computeCalendar,
  getBangkokToday,
  type Dept,
  type Urgency,
} from '@/lib/calendar';
import { CalendarGrid } from './grid';
import { LogoutButton } from '../analytics/logout-button';
import { AutoSync } from '@/lib/auto-sync';
import { IconArrowLeft, IconArrowRight } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'Calendar',
};

interface SearchParams {
  m?: string;       // YYYY-MM
  dept?: string;
  urgency?: string;
  customer?: string;
}

function parseMonth(input: string | undefined): { year: number; month: number } {
  const fallback = (() => {
    const t = getBangkokToday();
    return { year: t.getFullYear(), month: t.getMonth() };
  })();
  if (!input) return fallback;
  const m = input.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return fallback;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  if (isNaN(y) || isNaN(mo) || mo < 0 || mo > 11) return fallback;
  return { year: y, month: mo };
}

function formatMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  // Admin-only (defense in depth — middleware blocks anonymous already)
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') {
    redirect('/analytics');  // or could 403, but redirect is friendlier
  }

  const { year, month } = parseMonth(searchParams.m);
  const filters = {
    dept: (searchParams.dept || '') as Dept | '',
    urgency: (searchParams.urgency || '') as Urgency | '',
    customer: searchParams.customer || '',
  };

  let calendar;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    calendar = computeCalendar(data, year, month, filters);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  // Prev/next month query strings (preserving filters)
  const prev = (() => {
    const d = new Date(year, month - 1, 1);
    return makeQuery(d.getFullYear(), d.getMonth(), filters);
  })();
  const next = (() => {
    const d = new Date(year, month + 1, 1);
    return makeQuery(d.getFullYear(), d.getMonth(), filters);
  })();
  const todayHref = makeQuery(undefined, undefined, filters);

  return (
    <main className="min-h-screen bg-stone-50">
      <AutoSync />
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-stone-500 hover:text-stone-700 inline-flex items-center"
              aria-label="กลับหน้าหลัก"
            >
              <IconArrowLeft size={18} />
            </Link>
            <h1 className="text-lg sm:text-xl font-bold text-stone-900">Calendar</h1>
          </div>
          {session && (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <span>
                {session.user} <span className="text-stone-400">({session.role})</span>
              </span>
              <LogoutButton />
            </div>
          )}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : calendar ? (
          <>
            <NavBar
              monthLabel={calendar.monthLabel}
              prevHref={prev}
              nextHref={next}
              todayHref={todayHref}
            />
            <FilterBar current={filters} year={year} month={month} />
            <Summary totals={calendar.totalsByUrgency} totalJobs={calendar.totalJobs} />
            <div className="mt-4">
              <CalendarGrid days={calendar.days} todayKey={calendar.todayKey} />
            </div>
            <p className="text-xs text-stone-400 mt-4 text-right">
              cache 60s · server-rendered · Asia/Bangkok TZ
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}

// ─── Components ────────────────────────────────────────────

function makeQuery(
  year: number | undefined,
  month: number | undefined,
  filters: { dept?: string; urgency?: string; customer?: string },
): string {
  const params = new URLSearchParams();
  if (year !== undefined && month !== undefined) {
    params.set('m', formatMonth(year, month));
  }
  if (filters.dept) params.set('dept', filters.dept);
  if (filters.urgency) params.set('urgency', filters.urgency);
  if (filters.customer) params.set('customer', filters.customer);
  const qs = params.toString();
  return qs ? `/calendar?${qs}` : '/calendar';
}

function NavBar({ monthLabel, prevHref, nextHref, todayHref }: {
  monthLabel: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="flex items-center gap-2">
        <Link
          href={prevHref}
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-stone-300"
          aria-label="เดือนก่อน"
        >
          <IconArrowLeft size={16} />
        </Link>
        <h2 className="text-lg font-semibold text-stone-900 px-2 min-w-[140px] text-center tabular-nums">
          {monthLabel}
        </h2>
        <Link
          href={nextHref}
          className="w-9 h-9 inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-600 hover:border-stone-300"
          aria-label="เดือนถัดไป"
        >
          <IconArrowRight size={16} />
        </Link>
      </div>
      <Link
        href={todayHref}
        className="text-xs px-3 py-1.5 rounded-lg bg-white border border-stone-200 text-stone-600 hover:border-stone-300"
      >
        วันนี้
      </Link>
    </div>
  );
}

function FilterBar({
  current,
  year,
  month,
}: {
  current: { dept?: string; urgency?: string; customer?: string };
  year: number;
  month: number;
}) {
  // Submit GET form to refresh with new filters (server-side)
  return (
    <form
      action="/calendar"
      method="GET"
      className="bg-white rounded-xl border border-stone-200 p-3 mb-3 flex flex-wrap gap-2 items-center text-sm"
    >
      <input type="hidden" name="m" value={formatMonth(year, month)} />
      <select
        name="dept"
        defaultValue={current.dept || ''}
        className="px-2 py-1.5 border border-stone-200 rounded-md bg-white"
      >
        <option value="">— ทุกแผนก —</option>
        <option value="graphic">กราฟิก</option>
        <option value="print">พิมพ์</option>
        <option value="post">หลังพิมพ์/จัดส่ง</option>
      </select>
      <select
        name="urgency"
        defaultValue={current.urgency || ''}
        className="px-2 py-1.5 border border-stone-200 rounded-md bg-white"
      >
        <option value="">— ทุกความเร่งด่วน —</option>
        <option value="overdue">เลยกำหนด</option>
        <option value="dday">วันนี้!</option>
        <option value="urgent">ด่วน (≤3 วัน)</option>
        <option value="normal">ปกติ</option>
      </select>
      <input
        name="customer"
        defaultValue={current.customer || ''}
        placeholder="ค้นชื่อลูกค้า"
        className="px-3 py-1.5 border border-stone-200 rounded-md bg-white flex-grow min-w-[140px]"
      />
      <button
        type="submit"
        className="px-3 py-1.5 rounded-md bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        กรอง
      </button>
    </form>
  );
}

function Summary({
  totals,
  totalJobs,
}: {
  totals: Record<Urgency, number>;
  totalJobs: number;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 mb-3 flex flex-wrap gap-3 items-center text-sm">
      <span className="text-stone-500">งานในเดือนนี้:</span>
      <span className="font-medium text-stone-900">{totalJobs} รายการ</span>
      <Pill color="#ef4444" label="เลยกำหนด" count={totals.overdue} />
      <Pill color="#7c3aed" label="วันนี้" count={totals.dday} />
      <Pill color="#ea580c" label="ด่วน" count={totals.urgent} />
      <Pill color="#3b82f6" label="ปกติ" count={totals.normal} />
    </div>
  );
}

function Pill({ color, label, count }: { color: string; label: string; count: number }) {
  if (count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: color + '20', color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label} {count}
    </span>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Calendar ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
