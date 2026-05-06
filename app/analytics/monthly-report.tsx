'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { MonthlyReport } from '@/lib/analytics';
import {
  IconFilePlus, IconCheck, IconXCircle, IconClock, IconTarget, IconZap,
  IconCalendar, IconUsers, IconUserPlus, IconRefreshCw, IconTrophy,
  IconClipboard, IconTruck,
} from '@/lib/icons';

interface EnrichedDept {
  count: number;
  staff: Array<{ id: string; name: string; count: number }>;
}

export interface EnrichedMonthlyReport extends Omit<MonthlyReport, 'perDept'> {
  perDept: { graphic: EnrichedDept; print: EnrichedDept; post: EnrichedDept };
}

/** Renders the WP-style รายงานประจำเดือน — three sections: Executive
 *  Summary, Customer Insights, Per-Dept Performance. Mirrors the WP
 *  renderReport() output (production-monitoring.js ~line 4584).
 *
 *  Month picker uses next/navigation router.replace inside startTransition
 *  so the page revalidates without a full document reload.
 */
export function MonthlyReportView({ report }: { report: EnrichedMonthlyReport }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value; // YYYY-MM
    startTransition(() => {
      router.replace(value ? `/analytics?m=${value}` : '/analytics');
    });
  };

  const currentMonthKey = `${report.year}-${String(report.month).padStart(2, '0')}`;

  return (
    <div className={`space-y-8 ${isPending ? 'opacity-60 transition-opacity' : ''}`}>
      {/* Month picker toolbar */}
      <div className="flex items-center justify-between gap-3 bg-stone-50/60 border border-stone-200 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-stone-700">เดือน:</label>
          <select
            value={currentMonthKey}
            onChange={onMonthChange}
            className="px-3 py-1.5 border border-stone-300 rounded-lg bg-white text-sm tabular-nums focus:outline-none focus:border-accent"
          >
            {report.availableMonths.length === 0 && (
              <option value={currentMonthKey}>{report.monthLabel}</option>
            )}
            {report.availableMonths.map((m) => {
              const [y, mo] = m.split('-').map(Number);
              const label = formatMonth(y, mo);
              return <option key={m} value={m}>{label}</option>;
            })}
          </select>
        </div>
        <span className="text-xs text-stone-500 hidden sm:inline">
          ข้อมูล {report.monthLabel}
        </span>
      </div>

      {/* Section 1: Executive Summary */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-sky-900 flex items-center gap-2">
          <IconFilePlus size={18} />
          ภาพรวม (Executive Summary)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <StatCard
            icon={<IconFilePlus size={14} />}
            label="ใบสั่งใหม่"
            value={`${report.summary.totalNew} ใบ`}
            delta={fmtDelta(report.summary.deltaNewPct)}
            deltaPositive={report.summary.deltaNewPct !== null && report.summary.deltaNewPct >= 0}
          />
          <StatCard
            icon={<IconCheck size={14} />}
            label="จัดส่งสำเร็จ"
            value={`${report.summary.totalShipped} งาน`}
            delta={fmtDelta(report.summary.deltaShippedPct)}
            deltaPositive={report.summary.deltaShippedPct !== null && report.summary.deltaShippedPct >= 0}
          />
          <StatCard
            icon={<IconXCircle size={14} />}
            label="ยกเลิก"
            value={`${report.summary.totalCancelled} งาน`}
            color="#dc2626"
          />
          <StatCard
            icon={<IconClock size={14} />}
            label="อยู่ในระบบ"
            value={`${report.summary.activeCount} งาน`}
            color="#64748b"
          />
          <StatCard
            icon={<IconTarget size={14} />}
            label="Success Rate"
            value={report.summary.successRate !== null ? `${report.summary.successRate}%` : '—'}
            color="#1e3a8a"
          />
          <StatCard
            icon={<IconZap size={14} />}
            label="เฉลี่ยรับ→ส่ง"
            value={report.summary.avgTurnaround !== null ? `${report.summary.avgTurnaround} วัน` : '—'}
            color="#1e3a8a"
          />
          <StatCard
            icon={<IconCalendar size={14} />}
            label="ส่งตรงเวลา"
            value={report.summary.onTimeRate !== null ? `${report.summary.onTimeRate}%` : '—'}
            color="#059669"
          />
        </div>
      </section>

      {/* Section 2: Customer Insights */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-sky-900 flex items-center gap-2">
          <IconUsers size={18} />
          ลูกค้า (Customer Insights)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard
            icon={<IconUsers size={14} />}
            label="ลูกค้าเดือนนี้"
            value={`${report.customers.unique} ราย`}
            color="#1e3a8a"
          />
          <StatCard
            icon={<IconUserPlus size={14} />}
            label="ลูกค้าใหม่"
            value={`${report.customers.new} ราย`}
            color="#059669"
          />
          <StatCard
            icon={<IconRefreshCw size={14} />}
            label="ลูกค้าเก่า"
            value={`${report.customers.returning} ราย`}
            color="#64748b"
          />
        </div>

        {report.customers.top10.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-sky-900 mt-4 mb-2 flex items-center gap-1.5">
              <IconTrophy size={16} /> Top 10 ลูกค้า
            </h3>
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                  <tr>
                    <th className="w-12 text-center px-3 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">ลูกค้า</th>
                    <th className="w-20 text-right px-3 py-2 font-medium">งาน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {report.customers.top10.map((c, i) => (
                    <tr key={c.name} className="hover:bg-sky-50/30">
                      <td className="text-center px-3 py-2 tabular-nums text-stone-500">{i + 1}</td>
                      <td className="px-3 py-2 text-stone-900">{c.name}</td>
                      <td className="text-right px-3 py-2 tabular-nums font-semibold text-sky-700">{c.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-center text-sm text-stone-400 py-4">ยังไม่มีข้อมูลลูกค้า</p>
        )}
      </section>

      {/* Section 3: Per-Dept Performance */}
      <section className="space-y-3">
        <h2 className="text-base font-bold text-sky-900 flex items-center gap-2">
          <IconTruck size={18} />
          Performance — งานที่ผ่านแต่ละแผนก
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DeptBlock label="กราฟฟิก" data={report.perDept.graphic} />
          <DeptBlock label="พิมพ์" data={report.perDept.print} />
          <DeptBlock label="หลังพิมพ์" data={report.perDept.post} />
        </div>
      </section>

      <p className="text-xs text-stone-400 text-right pt-4">
        cache 60s · server-rendered · {report.monthLabel}
        {' · '}
        <Link href="/analytics?view=range" className="hover:text-stone-600 underline">
          ดูภาพรวม 12 เดือน →
        </Link>
      </p>
    </div>
  );
}

// ─── Helpers ───

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

function formatMonth(year: number, month: number): string {
  return `${THAI_MONTHS_FULL[month - 1]} ${year + 543}`;
}

function fmtDelta(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  const sign = pct >= 0 ? '▲ +' : '▼ ';
  return `${sign}${pct}%`;
}

function StatCard({
  icon, label, value, delta, deltaPositive, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4 hover:border-stone-300 transition-colors">
      <div className="text-[11px] font-medium text-stone-500 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div
        className="mt-2 text-2xl font-bold tabular-nums"
        style={{ color: color || '#111827' }}
      >
        {value}
      </div>
      {delta && (
        <div
          className="text-[11px] font-medium mt-1"
          style={{ color: deltaPositive ? '#059669' : '#dc2626' }}
        >
          {delta} <span className="text-stone-400">vs เดือนก่อน</span>
        </div>
      )}
    </div>
  );
}

function DeptBlock({
  label,
  data,
}: {
  label: string;
  data: EnrichedDept;
}) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center justify-between bg-stone-50/60">
        <span className="font-semibold text-stone-900 flex items-center gap-1.5 text-sm">
          <IconClipboard size={14} />
          {label}
        </span>
        <div className="text-right">
          <span className="text-2xl font-bold text-sky-700 tabular-nums">{data.count}</span>
          <span className="text-xs text-stone-500 ml-1">งาน</span>
        </div>
      </div>
      {data.staff.length > 0 ? (
        <table className="w-full text-sm">
          <thead className="bg-stone-50/60 text-[11px] text-stone-500 uppercase">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium">ช่าง</th>
              <th className="w-16 text-right px-3 py-1.5 font-medium">งาน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.staff.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-1.5 text-stone-700">{s.name}</td>
                <td className="text-right px-3 py-1.5 tabular-nums font-semibold text-sky-700">
                  {s.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="px-4 py-6 text-sm text-stone-400 text-center">
          ไม่มีงานในเดือนนี้
        </div>
      )}
    </div>
  );
}
