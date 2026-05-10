'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  IconCalendar, IconClock, IconBolt, IconAlertTriangle,
} from '@/lib/icons';
import type { Urgency } from '@/lib/calendar';
import type { BoardJob } from '@/lib/board';

// Lazy-load — modal only opens when a user clicks a KPI bucket. Skipping
// it from the /board page bundle saves ~3KB compressed for users who
// never drill in (most of them).
const KPIDetailModal = dynamic(
  () => import('./kpi-detail-modal').then((m) => ({ default: m.KPIDetailModal })),
  { ssr: false },
);

interface Bucket {
  key: Urgency;
  label: string;
  count: number;
  bgClass: string;
  iconClass: string;
  numClass: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  totals: Record<Urgency, number>;
  /** Visible jobs (post server filter) — passed to detail modal so the job
   *  list there matches what's on the board. */
  jobs: BoardJob[];
}

/** WP-style KPI bar — 4 disjoint urgency buckets matching the screenshot.
 *  Click a card → opens KPI detail modal with per-dept breakdown + flat
 *  job list (matches reference WP screenshot). */
export function KPIBar({ totals, jobs }: Props) {
  const [activeBucket, setActiveBucket] = useState<Urgency | null>(null);

  const buckets: Bucket[] = [
    {
      key: 'normal', label: 'รอดำเนินการ', count: totals.normal,
      bgClass: 'bg-amber-100', iconClass: 'text-amber-700', numClass: 'text-amber-700',
      Icon: IconCalendar,
    },
    {
      key: 'urgent', label: 'ด่วน ≤3 วัน', count: totals.urgent,
      bgClass: 'bg-orange-100', iconClass: 'text-orange-700', numClass: 'text-orange-700',
      Icon: IconClock,
    },
    {
      key: 'dday', label: 'D-Day (วันนี้)', count: totals.dday,
      bgClass: 'bg-violet-100', iconClass: 'text-violet-700', numClass: 'text-violet-700',
      Icon: IconBolt,
    },
    {
      key: 'overdue', label: 'เลยกำหนด', count: totals.overdue,
      bgClass: 'bg-red-100', iconClass: 'text-red-700', numClass: 'text-red-700',
      Icon: IconAlertTriangle,
    },
  ];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => setActiveBucket(b.key)}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-stone-100 bg-white hover:border-stone-200 hover:shadow-sm transition-all text-left"
          >
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${b.bgClass}`}
            >
              <b.Icon size={22} className={b.iconClass} />
            </div>
            <div className="min-w-0 flex-grow">
              <div className="text-xs font-medium text-stone-600 truncate">{b.label}</div>
              <div className={`text-3xl font-bold tabular-nums leading-none mt-1 ${b.numClass}`}>
                {b.count}
              </div>
            </div>
          </button>
        ))}
      </div>
      {activeBucket !== null && (
        <KPIDetailModal
          open={true}
          onClose={() => setActiveBucket(null)}
          urgency={activeBucket}
          jobs={jobs}
        />
      )}
    </>
  );
}
