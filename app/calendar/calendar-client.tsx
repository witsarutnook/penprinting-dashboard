'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Job, Order } from '@/lib/types';
import {
  computeCalendar,
  getBangkokToday,
  type Dept,
  type Urgency,
  URGENCY_BADGE,
  URGENCY_COLORS,
} from '@/lib/calendar';
import { useDeltaSync } from '@/lib/delta-sync';
import { CalendarGrid } from './grid';

/**
 * Client-side `/calendar` body. `computeCalendar` reads only jobs + orders,
 * so this reuses the board delta endpoint (`/api/board/delta`) +
 * `useDeltaSync` verbatim — no shipped / cancelled needed. Month nav +
 * filters stay URL-driven; changing them re-runs `computeCalendar`
 * client-side off `useSearchParams`, with no server round-trip and no
 * per-tick `router.refresh()` full re-render.
 */
function parseMonth(input: string | null): { year: number; month: number } {
  if (input) {
    const m = input.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      if (!isNaN(y) && !isNaN(mo) && mo >= 0 && mo <= 11) return { year: y, month: mo };
    }
  }
  const t = getBangkokToday();
  return { year: t.getFullYear(), month: t.getMonth() };
}

export function CalendarClient({
  initialJobs,
  initialOrders,
  initialServerTime,
}: {
  initialJobs: Job[];
  initialOrders: Order[];
  initialServerTime: string;
}) {
  const { jobs, orders } = useDeltaSync({
    jobs: initialJobs,
    orders: initialOrders,
    serverTime: initialServerTime,
  });

  const searchParams = useSearchParams();
  const calendar = useMemo(() => {
    const { year, month } = parseMonth(searchParams.get('m'));
    return computeCalendar({ jobs, orders }, year, month, {
      dept: (searchParams.get('dept') || '') as Dept | '',
      urgency: (searchParams.get('urgency') || '') as Urgency | '',
      customer: searchParams.get('customer') || '',
    });
  }, [jobs, orders, searchParams]);

  return (
    <>
      <Summary totals={calendar.totalsByUrgency} totalJobs={calendar.totalJobs} />
      <div className="mt-4">
        <CalendarGrid days={calendar.days} todayKey={calendar.todayKey} />
      </div>
    </>
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
      <Pill urgency="overdue" label="เลยกำหนด" count={totals.overdue} />
      <Pill urgency="dday" label="วันนี้" count={totals.dday} />
      <Pill urgency="urgent" label="ด่วน" count={totals.urgent} />
      <Pill urgency="normal" label="ปกติ" count={totals.normal} />
    </div>
  );
}

function Pill({ urgency, label, count }: { urgency: Urgency; label: string; count: number }) {
  if (count === 0) return null;
  const badge = URGENCY_BADGE[urgency];
  const dotColor = URGENCY_COLORS[urgency];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: badge.bg, color: badge.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
      {label} {count}
    </span>
  );
}
