'use client';

import { useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type BoardColumn, type Dept } from '@/lib/board';
import { getStaffTheme } from '@/lib/staff-icons';
import { broadcastWrite } from '@/lib/auto-sync';
import { computeFromType, getVisibleTargets } from '@/lib/forward';
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
  const router = useRouter();
  const isAdmin = sessionRole === 'admin';
  const isVendor = !!column.staff.isVendor;
  const theme = getStaffTheme(dept, column.staff.id);
  const [dragOver, setDragOver] = useState<null | 'reassign' | 'forward'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const id = Number(idStr);
    if (!id || !Number.isFinite(id)) return;
    const targetStaff = column.staff.id;

    setError(null);
    setBusy(true);
    try {
      // Same-dept → reassign
      if (dropType === 'reassign') {
        const res = await fetch('/api/jobs/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, targetStaff }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error || `HTTP ${res.status}`);
          setTimeout(() => setError(null), 3000);
          return;
        }
        broadcastWrite('/api/jobs/reassign');
        router.refresh();
        return;
      }

      // Cross-dept → forward. Validate target is reachable from source dept.
      if (dropType === 'forward') {
        const fromType = computeFromType(sourceDept, '');
        if (!fromType) {
          setError(`ส่งต่อจาก ${sourceDept} ไม่ได้`);
          setTimeout(() => setError(null), 3000);
          return;
        }
        const targets = getVisibleTargets(fromType, isAdmin);
        const match = targets.find(
          (t) => t.value === targetStaff && t.dept === dept,
        );
        if (!match) {
          setError(`ไม่สามารถส่งต่อ ${sourceDept} → ${dept}/${targetStaff}`);
          setTimeout(() => setError(null), 3000);
          return;
        }
        if (!confirm(
          `ส่งต่องาน #${id} → ${match.label} ?\n\n` +
          `(การส่งต่อข้ามแผนกจะสร้าง Job ใหม่ในปลายทาง — งานเก่าจะถูกลบ)`,
        )) {
          return;
        }
        const res = await fetch('/api/jobs/forward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, targetDept: dept, targetStaff }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error || `HTTP ${res.status}`);
          setTimeout(() => setError(null), 3000);
          return;
        }
        broadcastWrite('/api/jobs/forward');
        router.refresh();
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
          {column.jobs.length}
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
        {column.jobs.length === 0 ? (
          <div className="text-center text-stone-300 text-xs py-8">
            {dragOver === 'reassign' && 'วางที่นี่เพื่อย้ายงาน'}
            {dragOver === 'forward' && 'วางที่นี่เพื่อส่งต่อ'}
            {!dragOver && 'ไม่มีงานค้าง'}
          </div>
        ) : (
          column.jobs.map((job) => (
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
