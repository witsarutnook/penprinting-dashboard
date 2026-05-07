'use client';

import { useMemo, useState } from 'react';
import { useBulkMode, BULK_MAX_SELECT } from './bulk-context';
import {
  computeFromType,
  getVisibleTargets,
  type ForwardTarget,
} from '@/lib/forward';
import { broadcastWrite } from '@/lib/auto-sync';
import { IconCornerUpRight, IconAlertCircle, IconX } from '@/lib/icons';
import { DEPT_LABELS, type BoardJob } from '@/lib/board';
import { useToast } from '@/components/toast-provider';
import { usePendingMutations } from './pending-mutations';

interface Props {
  jobs: BoardJob[];
  isAdmin: boolean;
}

/** Floating action bar shown when bulk-mode is on AND ≥1 card selected.
 *  Pinned bottom (above mobile bottom-nav). Picks common forward targets
 *  across selected jobs and submits via /api/jobs/bulk-forward. */
export function BulkActionsBar({ jobs, isAdmin }: Props) {
  const { mode, selected, clearSelection } = useBulkMode();
  const toast = useToast();
  const { hideJob, unhideJob, addPendingInsert, removePendingInsert, commit } = usePendingMutations();
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedJobs = useMemo(
    () => jobs.filter((j) => selected.has(j.id)),
    [jobs, selected],
  );

  const commonTargets = useMemo<ForwardTarget[]>(() => {
    if (selectedJobs.length === 0) return [];
    let intersection: ForwardTarget[] | null = null;
    for (const j of selectedJobs) {
      const ft = computeFromType(String(j.dept), String(j.staff));
      if (!ft) return [];
      const ts = getVisibleTargets(ft, isAdmin);
      if (intersection === null) {
        intersection = ts.slice();
        continue;
      }
      intersection = intersection.filter((it) =>
        ts.some((t) => t.dept === it.dept && t.value === it.value),
      );
      if (intersection.length === 0) return [];
    }
    return intersection || [];
  }, [selectedJobs, isAdmin]);

  if (!mode || selected.size === 0) return null;

  async function submit() {
    if (!target) {
      setError('กรุณาเลือกปลายทาง');
      return;
    }
    const [tDept, tStaff] = target.split(':');
    setError(null);
    const jobsById = new Map(selectedJobs.map((j) => [Number(j.id), j]));
    const items = Array.from(selected).map((id) => {
      const j = jobsById.get(Number(id));
      return {
        id,
        targetDept: tDept,
        targetStaff: tStaff,
        srcJob: j ? {
          name: j.name,
          dept: String(j.dept),
          staff: j.staff,
          date: j.dateRaw,
          dateIn: j.dateInRaw,
          orderId: j.orderId,
        } : undefined,
      };
    });
    // Optimistic: hide selected sources + inject phantoms in target column +
    // clear selection + toast.
    const hidIds = items.map((it) => Number(it.id));
    const phantomTempIds: number[] = [];
    items.forEach((it) => {
      const j = jobsById.get(Number(it.id));
      if (j) {
        phantomTempIds.push(addPendingInsert({
          job: { ...j, hasCowork: false, cowork: undefined },
          destDept: tDept,
          destStaff: tStaff,
        }));
      }
    });
    hidIds.forEach((id) => hideJob(id));
    clearSelection();
    setTarget('');
    toast.show(`กำลังส่ง ${hidIds.length} งาน → ${tDept}/${tStaff}...`);
    try {
      const res = await fetch('/api/jobs/bulk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        phantomTempIds.forEach((tid) => removePendingInsert(tid));
        hidIds.forEach((id) => unhideJob(id));
        toast.error(data?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/bulk-forward');
      const failed = data.failed?.length || 0;
      if (failed > 0) {
        const failedIds = new Set((data.failed as Array<{ oldId?: number }>).map((f) => Number(f.oldId)));
        items.forEach((it, idx) => {
          if (failedIds.has(Number(it.id))) {
            unhideJob(Number(it.id));
            if (phantomTempIds[idx] !== undefined) removePendingInsert(phantomTempIds[idx]);
          }
        });
        toast.error(`ส่งสำเร็จ ${data.processed || 0} จาก ${hidIds.length} — ล้มเหลว ${failed}`);
      } else {
        toast.success(`ส่งต่อ ${data.processed || hidIds.length} งาน → ${tDept}/${tStaff}`);
      }
      commit(() => {
        phantomTempIds.forEach((tid) => removePendingInsert(tid));
        hidIds.forEach((id) => unhideJob(id));
      });
    } catch (err) {
      phantomTempIds.forEach((tid) => removePendingInsert(tid));
      hidIds.forEach((id) => unhideJob(id));
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  return (
    <div
      className="fixed bottom-16 md:bottom-4 left-4 right-4 md:left-[calc(220px+1rem)] md:right-4 z-40 bg-white rounded-2xl border border-stone-200 shadow-xl px-4 py-3"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 0.75rem)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium text-stone-900">
          เลือก {selected.size}/{BULK_MAX_SELECT} งาน
        </span>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={commonTargets.length === 0}
          className="flex-grow min-w-[180px] px-3 py-1.5 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:bg-stone-50"
        >
          <option value="">
            {commonTargets.length === 0
              ? '— ไม่มีปลายทางที่ใช้ร่วมกันได้ —'
              : `— เลือกปลายทาง (${commonTargets.length}) —`}
          </option>
          {commonTargets.map((t) => (
            <option key={`${t.dept}:${t.value}`} value={`${t.dept}:${t.value}`}>
              {DEPT_LABELS[t.dept]} · {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={!target}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <IconCornerUpRight size={14} />
          ส่งต่อ {selected.size}
        </button>
        <button
          type="button"
          onClick={clearSelection}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100"
          aria-label="ล้างที่เลือก"
        >
          <IconX size={14} />
        </button>
      </div>
      {error && (
        <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
          <IconAlertCircle size={12} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
