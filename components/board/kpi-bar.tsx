'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  IconCalendar,
  IconClock,
  IconBolt,
  IconAlertTriangle,
} from '@/lib/icons';
import type { Urgency } from '@/lib/calendar';

interface Bucket {
  key: '' | Urgency;       // '' = "all" / รอดำเนินการ-bucket label (matches user decision 2A: disjoint)
  label: string;
  count: number;
  bgClass: string;
  iconClass: string;
  numClass: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

interface Props {
  totals: Record<Urgency, number>;
}

/** WP-style KPI bar — 4 disjoint urgency buckets matching the screenshot.
 *  Click a card → filters the board to that urgency via URL param. */
export function KPIBar({ totals }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const currentU = params.get('u') as Urgency | null;

  const buckets: Bucket[] = [
    {
      key: 'normal',
      label: 'รอดำเนินการ',
      count: totals.normal,
      bgClass: 'bg-amber-100',
      iconClass: 'text-amber-700',
      numClass: 'text-amber-700',
      Icon: IconCalendar,
    },
    {
      key: 'urgent',
      label: 'ด่วน ≤3 วัน',
      count: totals.urgent,
      bgClass: 'bg-orange-100',
      iconClass: 'text-orange-700',
      numClass: 'text-orange-700',
      Icon: IconClock,
    },
    {
      key: 'dday',
      label: 'D-Day (วันนี้)',
      count: totals.dday,
      bgClass: 'bg-violet-100',
      iconClass: 'text-violet-700',
      numClass: 'text-violet-700',
      Icon: IconBolt,
    },
    {
      key: 'overdue',
      label: 'เลยกำหนด',
      count: totals.overdue,
      bgClass: 'bg-red-100',
      iconClass: 'text-red-700',
      numClass: 'text-red-700',
      Icon: IconAlertTriangle,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {buckets.map((b) => {
        const isActive = currentU === b.key;
        const next = new URLSearchParams(params.toString());
        if (isActive) next.delete('u');
        else next.set('u', b.key);
        const qs = next.toString();
        const href = qs ? `${pathname}?${qs}` : pathname;
        return (
          <Link
            key={b.key}
            href={href}
            scroll={false}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border bg-white transition-all ${
              isActive
                ? 'border-sky-300 ring-2 ring-sky-100'
                : 'border-stone-100 hover:border-stone-200 hover:shadow-sm'
            }`}
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
          </Link>
        );
      })}
    </div>
  );
}
