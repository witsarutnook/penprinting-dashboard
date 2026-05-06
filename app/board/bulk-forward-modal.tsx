'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type BoardJob,
  type Dept,
  DEPT_LABELS,
  STAFF,
  URGENCY_COLORS,
  URGENCY_LABELS,
} from '@/lib/board';
import {
  computeFromType,
  getVisibleTargets,
  type ForwardTarget,
} from '@/lib/forward';
import { broadcastWrite } from '@/lib/auto-sync';

const MAX_BATCH = 25;
const DEPT_ORDER: Dept[] = ['graphic', 'print', 'post'];

interface BulkForwardModalProps {
  open: boolean;
  onClose: () => void;
  jobs: BoardJob[];
  isAdmin: boolean;
}

/** Intersection of FW_TARGETS across selected jobs — only targets reachable from
 *  every selected source. Empty selection → empty list. */
function computeCommonTargets(jobs: BoardJob[], isAdmin: boolean): ForwardTarget[] {
  if (jobs.length === 0) return [];
  let intersection: ForwardTarget[] | null = null;
  for (const j of jobs) {
    const fromType = computeFromType(String(j.dept), String(j.staff));
    if (!fromType) return []; // ship column or unknown — can't forward
    const targets = getVisibleTargets(fromType, isAdmin);
    if (intersection === null) {
      intersection = targets.slice();
      continue;
    }
    intersection = intersection.filter((it) =>
      targets.some((t) => t.dept === it.dept && t.value === it.value),
    );
    if (intersection.length === 0) return [];
  }
  return intersection || [];
}

export function BulkForwardModal({ open, onClose, jobs, isAdmin }: BulkForwardModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState(''); // "dept:staffId" composite key
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // Filter out terminal (ship) — can't bulk forward from ship column.
  const eligibleJobs = useMemo(
    () => jobs.filter((j) => computeFromType(String(j.dept), String(j.staff)) !== null),
    [jobs],
  );

  const selectedJobs = useMemo(
    () => eligibleJobs.filter((j) => selected.has(j.id)),
    [eligibleJobs, selected],
  );

  const commonTargets = useMemo(
    () => computeCommonTargets(selectedJobs, isAdmin),
    [selectedJobs, isAdmin],
  );

  // If current target becomes invalid after selection change, clear it.
  useEffect(() => {
    if (!target) return;
    const stillValid = commonTargets.some((t) => `${t.dept}:${t.value}` === target);
    if (!stillValid) setTarget('');
  }, [commonTargets, target]);

  // Reset on every open.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setTarget('');
    setError(null);
    setProgress(null);
    setBusy(false);
  }, [open]);

  // Sync native dialog open/close.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  // Backdrop + ESC close.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) {
      e.preventDefault();
      onClose();
    }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  function toggleJob(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= MAX_BATCH) return prev; // cap at 25
        next.add(id);
      }
      return next;
    });
  }

  function selectAllInDept(dept: Dept) {
    setSelected((prev) => {
      const next = new Set(prev);
      const inDept = eligibleJobs.filter((j) => j.dept === dept);
      // If all already selected → unselect all in dept; else add all (up to cap).
      const allSelected = inDept.every((j) => next.has(j.id));
      if (allSelected) {
        inDept.forEach((j) => next.delete(j.id));
      } else {
        for (const j of inDept) {
          if (next.size >= MAX_BATCH) break;
          next.add(j.id);
        }
      }
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) {
      setError('กรุณาเลือกงานอย่างน้อย 1 งาน');
      return;
    }
    if (!target) {
      setError('กรุณาเลือกปลายทาง');
      return;
    }
    const [tDept, tStaff] = target.split(':');
    setError(null);
    setBusy(true);
    setProgress(`กำลังส่ง ${selected.size} งาน...`);

    const items = Array.from(selected).map((id) => ({
      id,
      targetDept: tDept,
      targetStaff: tStaff,
    }));

    try {
      const res = await fetch('/api/jobs/bulk-forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data: {
        ok?: boolean;
        processed?: number;
        failed?: Array<{ oldId?: number; name?: string; error?: string }>;
        error?: string;
      } = await res.json().catch(() => ({}));
      setBusy(false);
      setProgress(null);
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/bulk-forward');
      const failed = data.failed || [];
      if (failed.length > 0) {
        setError(
          `ส่งต่อสำเร็จ ${data.processed || 0} จาก ${selected.size} งาน — ` +
            `failed: ${failed
              .map((f) => `id=${f.oldId} ${f.error || ''}`.trim())
              .slice(0, 3)
              .join('; ')}${failed.length > 3 ? '...' : ''}`,
        );
        router.refresh();
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setBusy(false);
      setProgress(null);
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-3xl w-[94vw]"
    >
      <div className="flex flex-col max-h-[90vh]">
        <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-bold text-stone-900">
            ↪ ส่งต่อหลายงาน
            <span className="ml-2 text-xs font-normal text-stone-400">
              ({selected.size}/{MAX_BATCH})
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-stone-400 hover:text-stone-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100 disabled:opacity-50"
            aria-label="ปิด"
          >
            ×
          </button>
        </header>

        <div className="flex-grow overflow-y-auto px-5 py-4 space-y-4">
          {/* Target picker */}
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1.5">
              ↪ ส่งต่อไปที่
              {selectedJobs.length > 0 && (
                <span className="ml-2 text-stone-400 font-normal">
                  ({commonTargets.length} ปลายทางที่ใช้ร่วมกันได้)
                </span>
              )}
            </label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={selectedJobs.length === 0 || commonTargets.length === 0}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:bg-stone-50"
            >
              <option value="">
                {selectedJobs.length === 0
                  ? '— เลือกงานก่อน —'
                  : commonTargets.length === 0
                    ? '— ไม่มีปลายทางที่ใช้ร่วมกันได้ —'
                    : '— เลือกปลายทาง —'}
              </option>
              {commonTargets.map((t) => (
                <option key={`${t.dept}:${t.value}`} value={`${t.dept}:${t.value}`}>
                  {DEPT_LABELS[t.dept]} · {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Job list grouped by dept */}
          <div className="space-y-3">
            <div className="text-xs font-medium text-stone-700">
              เลือกงาน (active เท่านั้น — ตัดคอลัมน์ &quot;รอจัดส่ง&quot; ออก)
            </div>
            {DEPT_ORDER.map((dept) => {
              const jobsInDept = eligibleJobs.filter((j) => j.dept === dept);
              if (jobsInDept.length === 0) return null;
              const allInDeptSelected = jobsInDept.every((j) => selected.has(j.id));
              return (
                <div key={dept} className="border border-stone-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-700">
                      {DEPT_LABELS[dept]}
                      <span className="ml-2 text-xs font-normal text-stone-400">
                        ({jobsInDept.length})
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => selectAllInDept(dept)}
                      disabled={busy}
                      className="text-[11px] text-accent hover:text-accent-dark font-medium disabled:opacity-50"
                    >
                      {allInDeptSelected ? 'ยกเลิกเลือกทั้งหมด' : 'เลือกทั้งหมด'}
                    </button>
                  </div>
                  <ul className="divide-y divide-stone-100 max-h-72 overflow-y-auto">
                    {jobsInDept.map((j) => (
                      <li key={j.id}>
                        <label className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-stone-50 transition-colors">
                          <input
                            type="checkbox"
                            checked={selected.has(j.id)}
                            onChange={() => toggleJob(j.id)}
                            disabled={busy || (!selected.has(j.id) && selected.size >= MAX_BATCH)}
                            className="mt-1 accent-accent"
                          />
                          <div className="flex-grow min-w-0 text-sm">
                            <div className="font-medium text-stone-900 truncate">
                              {j.name || <span className="text-stone-400">(ไม่มีชื่อ)</span>}
                            </div>
                            <div className="text-[11px] text-stone-500 mt-0.5 flex flex-wrap items-center gap-2">
                              <span>{getStaffLabel(j.dept as Dept, j.staff)}</span>
                              {j.customer && <span>· {j.customer}</span>}
                              <span className="text-stone-400 tabular-nums">{j.dateRaw}</span>
                              <span
                                className="px-1.5 py-0.5 rounded font-medium tabular-nums text-[10px]"
                                style={{
                                  background: URGENCY_COLORS[j.urgency] + '20',
                                  color: URGENCY_COLORS[j.urgency],
                                }}
                              >
                                {URGENCY_LABELS[j.urgency]}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] text-stone-300 tabular-nums whitespace-nowrap">
                            #{j.id}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              ❌ {error}
            </div>
          )}
          {progress && !error && (
            <div className="text-sm text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2">
              {progress}
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-3 flex-shrink-0">
          <p className="text-[11px] text-stone-400">
            ส่งทั้งหมด ใน 1 lock เดียว (atomic) — ส่งสูงสุด {MAX_BATCH} งาน/ครั้ง
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy || selected.size === 0 || !target}
              className="px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? 'กำลังส่งต่อ...' : `ส่งต่อ ${selected.size || ''} งาน`}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function getStaffLabel(dept: Dept, staffId: string): string {
  const s = STAFF[dept]?.find((x) => x.id === staffId);
  return s ? `${DEPT_LABELS[dept]}/${s.name}` : `${dept}/${staffId}`;
}
