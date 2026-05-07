'use client';

/**
 * Lazy-loading wrappers around the four recharts-based components.
 *
 * Why: recharts ships ~110KB gzip into /analytics's First Load JS even
 * though the charts are below the fold. By splitting the import into a
 * client component with `ssr: false`, the chart code is fetched in a
 * separate chunk after page paint — analytics shell renders instantly
 * and charts fade in once recharts arrives.
 *
 * Trade: brief skeleton on first chart paint (~100-300ms after page loads).
 * Acceptable for admin-only page; not on the critical staff hot path.
 */

import dynamic from 'next/dynamic';

function ChartSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-4">
      <div className="text-xs font-medium text-stone-500 mb-3">{label}</div>
      <div className="h-[260px] rounded-lg bg-stone-100 animate-pulse" />
    </div>
  );
}

export const OrdersTrendChart = dynamic(
  () => import('./charts').then((m) => ({ default: m.OrdersTrendChart })),
  { ssr: false, loading: () => <ChartSkeleton label="ใบสั่งใหม่ vs จัดส่ง" /> },
);

export const TurnaroundChart = dynamic(
  () => import('./charts').then((m) => ({ default: m.TurnaroundChart })),
  { ssr: false, loading: () => <ChartSkeleton label="Turnaround time" /> },
);

export const TopCustomersChart = dynamic(
  () => import('./charts').then((m) => ({ default: m.TopCustomersChart })),
  { ssr: false, loading: () => <ChartSkeleton label="Top customers" /> },
);

export const DeptWorkloadChart = dynamic(
  () => import('./charts').then((m) => ({ default: m.DeptWorkloadChart })),
  { ssr: false, loading: () => <ChartSkeleton label="Dept workload" /> },
);
