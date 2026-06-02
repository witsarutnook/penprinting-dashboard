import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { getBangkokToday } from '@/lib/calendar';
import { CalendarClient } from './calendar-client';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { IconArrowLeft, IconArrowRight } from '@/lib/icons';
import { DashboardShell } from '@/components/dashboard-shell';

export const metadata: Metadata = {
  title: 'Calendar',
};

interface SearchParams {
  m?: string;       // YYYY-MM
  dept?: string;
  urgency?: string;
  customer?: string;
}

interface ChromeFilters {
  dept: string;
  urgency: string;
  customer: string;
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
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') {
    redirect('/analytics');
  }

  const { year, month } = parseMonth(searchParams.m);
  // Chrome filters (FilterBar defaults + nav-link preservation) come from
  // searchParams. The calendar grid itself filters client-side inside
  // CalendarClient via useSearchParams.
  const chrome: ChromeFilters = {
    dept: searchParams.dept || '',
    urgency: searchParams.urgency || '',
    customer: searchParams.customer || '',
  };

  // Prev/next month query strings (preserving filters) — computed from
  // searchParams alone, so they render in the first chunk.
  const prev = (() => {
    const d = new Date(year, month - 1, 1);
    return makeQuery(d.getFullYear(), d.getMonth(), chrome);
  })();
  const next = (() => {
    const d = new Date(year, month + 1, 1);
    return makeQuery(d.getFullYear(), d.getMonth(), chrome);
  })();
  const todayHref = makeQuery(undefined, undefined, chrome);

  const monthLabelFromInput = (() => {
    const fmt = new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: 'long',
    });
    return fmt.format(new Date(year, month, 1));
  })();

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3">
          <h1 className="text-lg sm:text-xl font-bold text-stone-900">ปฏิทิน</h1>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto">
        <NavBar
          monthLabel={monthLabelFromInput}
          prevHref={prev}
          nextHref={next}
          todayHref={todayHref}
        />
        <FilterBar current={chrome} year={year} month={month} />
        <Suspense fallback={<CalendarSkeleton />}>
          <CalendarDataDelta />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

/** Bootstrap data fetcher — awaits the initial snapshot via
 *  `loadBoardDelta(null)` (jobs + orders, which is everything
 *  `computeCalendar` reads) and hands it to the client `<CalendarClient>`,
 *  which then delta-polls and re-runs `computeCalendar` locally. */
async function CalendarDataDelta() {
  let initial: BoardDelta | null = null;
  let errorMessage: string | null = null;
  try {
    initial = await loadBoardDelta(null);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }
  if (!initial) {
    return <ErrorPanel message={errorMessage || 'โหลด Calendar ไม่สำเร็จ'} />;
  }
  return (
    <CalendarClient
      initialJobs={initial.jobs}
      initialOrders={initial.orders}
      initialServerTime={initial.serverTime}
    />
  );
}

function CalendarSkeleton() {
  return (
    <div aria-hidden="true">
      {/* Summary pill row */}
      <div className="bg-white rounded-xl border border-stone-200 p-3 mb-3 flex gap-3 items-center">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-5 w-20 bg-stone-100 rounded-full animate-pulse" />
        ))}
      </div>
      {/* Month grid — 6 weeks × 7 cols */}
      <div className="bg-white rounded-xl border border-stone-200 p-2 mt-4">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 42 }).map((_, i) => (
            <div
              key={i}
              className="h-20 sm:h-24 bg-stone-50 border border-stone-100 rounded animate-pulse"
              style={{ animationDelay: `${i * 30}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
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
  current: ChromeFilters;
  year: number;
  month: number;
}) {
  return (
    <form
      action="/calendar"
      method="GET"
      className="bg-white rounded-xl border border-stone-200 p-3 mb-3 flex flex-wrap gap-2 items-center text-sm"
    >
      <input type="hidden" name="m" value={formatMonth(year, month)} />
      <select
        name="dept"
        defaultValue={current.dept}
        className="px-2 py-1.5 border border-stone-200 rounded-md bg-white"
      >
        <option value="">— ทุกแผนก —</option>
        <option value="graphic">กราฟิก</option>
        <option value="print">พิมพ์</option>
        <option value="post">หลังพิมพ์/จัดส่ง</option>
      </select>
      <select
        name="urgency"
        defaultValue={current.urgency}
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
        defaultValue={current.customer}
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

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Calendar ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
