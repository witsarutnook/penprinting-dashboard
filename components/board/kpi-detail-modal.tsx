'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  STAFF, DEPT_LABELS, type BoardJob, type Dept,
} from '@/lib/board';
import type { Urgency } from '@/lib/calendar';
import { displayDate } from '@/lib/jobs';
import {
  IconX, IconCalendar, IconClock, IconBolt, IconAlertTriangle,
} from '@/lib/icons';

const URGENCY_META: Record<Urgency, {
  label: string; icon: React.ComponentType<{ size?: number; className?: string }>;
  bgClass: string; iconClass: string; numClass: string;
}> = {
  normal: { label: 'รอดำเนินการ', icon: IconCalendar, bgClass: 'bg-amber-100', iconClass: 'text-amber-700', numClass: 'text-amber-700' },
  urgent: { label: 'ด่วน ≤3 วัน', icon: IconClock, bgClass: 'bg-orange-100', iconClass: 'text-orange-700', numClass: 'text-orange-700' },
  dday: { label: 'D-Day (วันนี้)', icon: IconBolt, bgClass: 'bg-violet-100', iconClass: 'text-violet-700', numClass: 'text-violet-700' },
  overdue: { label: 'เลยกำหนด', icon: IconAlertTriangle, bgClass: 'bg-red-100', iconClass: 'text-red-700', numClass: 'text-red-700' },
};

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, dday: 1, urgent: 2, normal: 3 };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which urgency bucket to show. Caller is expected to mount the modal
   *  conditionally (`{bucket !== null && <KPIDetailModal urgency={bucket} ...>}`)
   *  so this prop can be a tight non-null Urgency. */
  urgency: Urgency;
  /** All visible jobs (post-filter). KPI counts are computed from the
   *  un-filtered totals upstream, but this modal lists what's currently
   *  visible — keeps modal in sync with the board view. */
  jobs: BoardJob[];
}

/** WP-style KPI detail modal — clicking a KPI card opens this with:
 *  per-dept mini-stats on top + a flat job table below. Mirrors the
 *  reference screenshot exactly. */
export function KPIDetailModal({ open, onClose, urgency, jobs }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) { e.preventDefault(); onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  // Filter jobs to selected urgency, sorted by severity → due → name
  const filtered = jobs
    .filter((j) => j.urgency === urgency)
    .sort((a, b) => {
      const r = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (r !== 0) return r;
      const ad = a.dueIso ? new Date(a.dueIso).getTime() : Infinity;
      const bd = b.dueIso ? new Date(b.dueIso).getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name, 'th');
    });

  // Per-dept counts (within bucket)
  const deptCounts: Record<Dept, number> = { graphic: 0, print: 0, post: 0 };
  filtered.forEach((j) => {
    if (j.dept === 'graphic' || j.dept === 'print' || j.dept === 'post') {
      deptCounts[j.dept]++;
    }
  });

  const meta = URGENCY_META[urgency];

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-5xl w-[96vw]"
    >
      <div className="flex flex-col max-h-[92vh]">
        <header className="px-5 py-3 border-b border-stone-100 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
            <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${meta.bgClass}`}>
              <meta.icon size={16} className={meta.iconClass} />
            </span>
            <span>{meta.label}</span>
            <span className="text-stone-400 font-normal text-sm">({filtered.length} งาน)</span>
          </h2>
          <button type="button" onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100"
            aria-label="ปิด">
            <IconX size={20} />
          </button>
        </header>

        {/* Per-dept mini KPIs */}
        <div className="px-5 pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 flex-shrink-0">
          {(['graphic', 'print', 'post'] as Dept[]).map((d) => (
            <div key={d} className="rounded-2xl border border-stone-100 bg-white px-4 py-3">
              <div className="text-xs text-stone-600">{DEPT_LABELS[d]}</div>
              <div className={`text-3xl font-bold tabular-nums leading-none mt-1 ${meta.numClass}`}>
                {deptCounts[d]}
              </div>
            </div>
          ))}
        </div>

        {/* Job table */}
        <div className="flex-grow overflow-y-auto px-5 py-4">
          {filtered.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-12">
              ไม่มีงานในกลุ่ม &ldquo;{meta.label}&rdquo;
            </p>
          ) : (
            <div className="rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 text-xs text-stone-500">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-10">#</th>
                    <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">ลูกค้า</th>
                    <th className="text-left px-3 py-2 font-medium">แผนก / ช่าง</th>
                    <th className="text-right px-3 py-2 font-medium hidden md:table-cell">กำหนดส่ง</th>
                    <th className="text-right px-3 py-2 font-medium">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {filtered.map((j, i) => {
                    const dept = j.dept as Dept;
                    const staffName =
                      STAFF[dept]?.find((s) => s.id === j.staff)?.name || j.staff;
                    return (
                      <tr
                        key={j.id}
                        onClick={() => {
                          // Jump to /board filtered to this dept + staff,
                          // pre-search by job name so the card is easy to spot.
                          const params = new URLSearchParams();
                          params.set('dept', String(j.dept));
                          if (j.name) params.set('q', j.name);
                          onClose();
                          router.push(`/board?${params.toString()}`);
                        }}
                        className="cursor-pointer hover:bg-sky-50/50 transition-colors"
                        title="กดเพื่อเปิด Kanban เห็นการ์ดนี้"
                      >
                        <td className="px-3 py-2 tabular-nums text-stone-400">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-stone-900 hover:text-sky-700">{j.name}</td>
                        <td className="px-3 py-2 text-stone-600 hidden sm:table-cell">{j.customer || '—'}</td>
                        <td className="px-3 py-2 text-stone-700">
                          <span className="font-medium">{DEPT_LABELS[dept] || dept}</span>
                          <span className="text-stone-400 mx-1">/</span>
                          <span className="text-sky-700">{staffName}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-stone-600 tabular-nums hidden md:table-cell">
                          {displayDate(j.dateRaw)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-semibold ${meta.numClass}`}>
                            {daysLabel(urgency, j.daysUntilDue)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function daysLabel(urgency: Urgency, days: number | null): string {
  if (days === null) return '—';
  if (urgency === 'overdue') return `เลย ${Math.abs(days)} วัน`;
  if (urgency === 'dday' || days === 0) return 'วันนี้!';
  return `อีก ${days} วัน`;
}
