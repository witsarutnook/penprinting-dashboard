'use client';

import { useState, type DragEvent } from 'react';
import { type BoardColumn, type Dept, DEPT_LABELS } from '@/lib/board';
import { getStaffTheme } from '@/lib/staff-icons';
import { broadcastWrite } from '@/lib/auto-sync';
import { computeFromType, getVisibleTargets } from '@/lib/forward';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';
import { usePendingMutations } from '@/components/board/pending-mutations';
import { Card } from './card';

const VENDOR_PURPLE = '#7c3aed';
const ANY_JOB_MIME = 'application/x-job-any';

/** MIME types broadcast on drag-start. We set TWO types:
 *  - `application/x-job-${dept}` — same-dept drops accept (reassign)
 *  - `application/x-job-any`     — cross-dept drops accept (forward) */
function jobMimeType(dept: string): string {
  return `application/x-job-${dept}`;
}

/** Per-staff column. WP-style icon-header card on top, then a vertical
 *  list of jobs underneath. Vendor staff (outsource / diecut_out) get a
 *  purple accent line + tinted bg.
 *
 *  v5.12: drop target — accepts cards dragged from other staff in the SAME
 *  dept and POSTs /api/jobs/reassign. Mirrors WP onJobDrop. */
export function Column({
  dept,
  column,
  sessionRole,
}: {
  dept: Dept;
  column: BoardColumn;
  sessionRole: string | null;
}) {
  const toast = useToast();
  const confirmDlg = useConfirm();
  const { hiddenIds, pendingInserts, hideJob, unhideJob, addPendingInsert, removePendingInsert, commit } = usePendingMutations();
  const isAdmin = sessionRole === 'admin';
  const isVendor = !!column.staff.isVendor;
  const theme = getStaffTheme(dept, column.staff.id);
  const [dragOver, setDragOver] = useState<null | 'reassign' | 'forward'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out cards that are mid-mutation — they've been added to
  // hiddenIds optimistically so the column reflects the user's action
  // before the Apps Script round-trip completes.
  const filteredJobs = column.jobs.filter((j) => !hiddenIds.has(Number(j.id)));
  // Inject any phantom cards routed to THIS staff/dept — these are the
  // "destination" cards for pending forwards/reassigns. Render at the bottom.
  const myPhantoms = pendingInserts
    .filter((p) => p.destDept === dept && p.destStaff === column.staff.id)
    .map((p) => p.job);
  const visibleJobs = [...filteredJobs, ...myPhantoms];

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    const types = e.dataTransfer.types;
    // Same-dept = reassign — always accept
    if (types.includes(jobMimeType(dept))) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragOver !== 'reassign') setDragOver('reassign');
      return;
    }
    // Cross-dept = forward — accept only if THIS column's staff is a valid
    // forward target from any dept. Detect via the generic any-job marker.
    if (types.includes(ANY_JOB_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'link';
      if (dragOver !== 'forward') setDragOver('forward');
      return;
    }
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setDragOver(null);
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const dropType = dragOver;
    setDragOver(null);
    const idStr = e.dataTransfer.getData('text/plain');
    const sourceDept = e.dataTransfer.getData('application/x-job-source-dept') || '';
    const sourceStaff = e.dataTransfer.getData('application/x-job-source-staff') || '';
    const snapshotStr = e.dataTransfer.getData('application/x-job-snapshot') || '';
    const id = Number(idStr);
    if (!id || !Number.isFinite(id)) return;
    const targetStaff = column.staff.id;

    // Parse the source snapshot the card carried in dataTransfer — used to
    // skip the server's loadAllFresh round-trip. Falls back to dept/staff
    // only if the snapshot is missing (older drag from a stale tab).
    let srcJob: {
      name?: string;
      dept?: string;
      staff?: string;
      date?: string;
      dateIn?: string;
      status?: string;
      orderId?: number | string | null;
      cowork?: unknown;
    } = { dept: sourceDept, staff: sourceStaff };
    if (snapshotStr) {
      try { srcJob = { ...srcJob, ...JSON.parse(snapshotStr) }; } catch { /* keep fallback */ }
    }

    // Best-effort source label for the toast — we don't have the actual
    // source staff at drop time, so the dept name is the cleanest fallback.
    const sourceStaffLabel = DEPT_LABELS[sourceDept as Dept] || sourceDept;
    const targetStaffLabel = column.staff.name;

    setError(null);
    setBusy(true);
    try {
      // Same-dept → reassign
      if (dropType === 'reassign') {
        // Optimistic: hide source + inject phantom in destination so the
        // user sees instant "card move" instead of a 2-3s gap waiting for
        // router.refresh.
        const sourceJob = column.jobs.find((j) => Number(j.id) === id);
        // Find phantom source — could be from another column in this dept.
        const phantomSrcBoardJob = sourceJob || (srcJob.name ? {
          // Synthesize minimal BoardJob from drag snapshot — Card renders
          // with the same dept/dates/name; cowork stays.
          id, name: srcJob.name, customer: null,
          staff: srcJob.staff || sourceStaff, dept: dept,
          dateRaw: srcJob.date || '', dueIso: null,
          urgency: 'normal' as const, daysUntilDue: null,
          orderId: srcJob.orderId ? Number(srcJob.orderId) : null,
          hasCowork: !!srcJob.cowork,
          cowork: srcJob.cowork,
          order: null, status: srcJob.status || 'pending',
          dateInRaw: srcJob.dateIn || '',
        } : null);
        let phantomTempId: number | null = null;
        if (phantomSrcBoardJob) {
          phantomTempId = addPendingInsert({
            job: phantomSrcBoardJob,
            destDept: dept,
            destStaff: targetStaff,
          });
        }
        hideJob(id);
        toast.show(`กำลังย้าย #${id}: ${sourceStaffLabel} → ${targetStaffLabel}`);
        const res = await fetch('/api/jobs/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, targetStaff, srcJob }),
        });
        if (!res.ok) {
          if (phantomTempId !== null) removePendingInsert(phantomTempId);
          unhideJob(id);
          const data = await res.json().catch(() => ({}));
          const msg = data?.error || `HTTP ${res.status}`;
          setError(msg);
          toast.error(msg);
          setTimeout(() => setError(null), 3000);
          return;
        }
        broadcastWrite('/api/jobs/reassign');
        toast.success(`ย้ายงาน #${id} → ${targetStaffLabel}`);
        // commit() refreshes inside a transition + queues cleanup that
        // fires AFTER the new SSR data lands — no source-bounceback.
        commit(() => {
          if (phantomTempId !== null) removePendingInsert(phantomTempId);
          unhideJob(id);
        });
        return;
      }

      // Cross-dept → forward. Validate target is reachable from source dept.
      if (dropType === 'forward') {
        // Pass actual source staff so post:cut → post:bind, print:outsource →
        // post:cut, etc. resolve to the right FW_TARGETS bucket. Empty staff
        // would force fromType='any' and reject everything but ship.
        const fromType = computeFromType(sourceDept, sourceStaff);
        if (!fromType) {
          const msg = `ส่งต่อจาก ${sourceDept} ไม่ได้`;
          setError(msg);
          toast.error(msg);
          setTimeout(() => setError(null), 3000);
          return;
        }
        const targets = getVisibleTargets(fromType, isAdmin);
        const match = targets.find(
          (t) => t.value === targetStaff && t.dept === dept,
        );
        if (!match) {
          const msg = `ไม่สามารถส่งต่อ ${sourceDept} → ${dept}/${targetStaff}`;
          setError(msg);
          toast.error(msg);
          setTimeout(() => setError(null), 3000);
          return;
        }
        const ok = await confirmDlg.confirm({
          title: `ส่งต่องาน #${id} → ${match.label}?`,
          message: 'การส่งต่อข้ามแผนกจะสร้าง Job ใหม่ในปลายทาง — งานเก่าจะถูกลบ',
          okLabel: 'ส่งต่อ',
          variant: 'default',
        });
        if (!ok) return;
        // Optimistic: hide source + inject phantom in destination column
        // (different dept) so user sees the card "move" instantly.
        const sourceJob = column.jobs.find((j) => Number(j.id) === id);
        const phantomSrcBoardJob = sourceJob || (srcJob.name ? {
          id, name: srcJob.name, customer: null,
          staff: srcJob.staff || sourceStaff, dept: srcJob.dept || sourceDept,
          dateRaw: srcJob.date || '', dueIso: null,
          urgency: 'normal' as const, daysUntilDue: null,
          orderId: srcJob.orderId ? Number(srcJob.orderId) : null,
          hasCowork: false, cowork: undefined,  // forward clears cowork
          order: null, status: 'pending',
          dateInRaw: srcJob.dateIn || '',
        } : null);
        let phantomTempId: number | null = null;
        if (phantomSrcBoardJob) {
          phantomTempId = addPendingInsert({
            job: { ...phantomSrcBoardJob, hasCowork: false, cowork: undefined },
            destDept: dept,
            destStaff: targetStaff,
          });
        }
        hideJob(id);
        toast.show(`กำลังส่งต่อ #${id} → ${match.label}...`);
        const res = await fetch('/api/jobs/forward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, targetDept: dept, targetStaff, srcJob }),
        });
        if (!res.ok) {
          if (phantomTempId !== null) removePendingInsert(phantomTempId);
          unhideJob(id);
          const data = await res.json().catch(() => ({}));
          const msg = data?.error || `HTTP ${res.status}`;
          setError(msg);
          toast.error(msg);
          setTimeout(() => setError(null), 3000);
          return;
        }
        broadcastWrite('/api/jobs/forward');
        toast.success(`ส่งต่อ #${id} → ${match.label}`);
        commit(() => {
          if (phantomTempId !== null) removePendingInsert(phantomTempId);
          unhideJob(id);
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col rounded-2xl border bg-white"
      style={{
        borderColor: isVendor ? `${VENDOR_PURPLE}30` : '#e7e5e4',
        borderBottomColor: isVendor ? VENDOR_PURPLE : undefined,
        borderBottomWidth: isVendor ? 2 : 1,
      }}
    >
      {/* Icon header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b border-stone-100 rounded-t-2xl ${
          isVendor ? 'bg-violet-50/40' : ''
        }`}
      >
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${theme.bgClass}`}
        >
          <theme.Icon size={22} className={theme.iconClass} />
        </div>
        <div className="min-w-0 flex-grow">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: isVendor ? VENDOR_PURPLE : '#1c1917' }}
          >
            {column.staff.name}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 truncate">
            {column.staff.role}
          </div>
        </div>
        <span
          className="text-sm font-semibold tabular-nums px-2 py-0.5 rounded-md flex-shrink-0"
          style={{
            background: isVendor ? `${VENDOR_PURPLE}15` : '#f5f5f4',
            color: isVendor ? VENDOR_PURPLE : '#57534e',
          }}
        >
          {visibleJobs.length}
        </span>
      </div>

      {/* Job list — also the drop zone */}
      <div
        className={`flex-grow p-2.5 space-y-2 min-h-[80px] overflow-y-auto rounded-b-2xl transition-colors ${
          dragOver === 'reassign' ? 'bg-sky-50 ring-2 ring-sky-400 ring-inset' : ''
        } ${
          dragOver === 'forward' ? 'bg-emerald-50 ring-2 ring-emerald-400 ring-inset' : ''
        } ${busy ? 'opacity-60 pointer-events-none' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {error && (
          <div className="text-[11px] bg-red-50 border border-red-200 text-red-700 rounded px-2 py-1">
            {error}
          </div>
        )}
        {visibleJobs.length === 0 ? (
          <div className="text-center text-stone-300 text-xs py-8">
            {dragOver === 'reassign' && 'วางที่นี่เพื่อย้ายงาน'}
            {dragOver === 'forward' && 'วางที่นี่เพื่อส่งต่อ'}
            {!dragOver && 'ไม่มีงานค้าง'}
          </div>
        ) : (
          visibleJobs.map((job) => (
            <Card
              key={`${job.id}-${job.isGuest ? 'g' : 'h'}`}
              job={job}
              dept={dept}
              isVendorCol={isVendor}
              sessionRole={sessionRole}
            />
          ))
        )}
      </div>
    </div>
  );
}
