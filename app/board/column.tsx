'use client';

import { useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import { type BoardColumn, type Dept } from '@/lib/board';
import { getStaffTheme } from '@/lib/staff-icons';
import { broadcastWrite } from '@/lib/auto-sync';
import { Card } from './card';

const VENDOR_PURPLE = '#7c3aed';

/** MIME type used to encode the source dept of a dragged job — read in
 *  onDragOver to allow/disallow drop without leaking the job id (browsers
 *  hide setData values until drop). Format: `application/x-job-${dept}`. */
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
  const isVendor = !!column.staff.isVendor;
  const theme = getStaffTheme(dept, column.staff.id);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    // Allow drop only if a card from THIS dept is being dragged
    if (!e.dataTransfer.types.includes(jobMimeType(dept))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragOver) setDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only clear when truly leaving the drop zone (not crossing into a child)
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setDragOver(false);
  }

  async function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const idStr = e.dataTransfer.getData('text/plain');
    const id = Number(idStr);
    if (!id || !Number.isFinite(id)) return;
    // Find the source job within this column's column.jobs is wrong (dropping
    // is on this column, source is elsewhere). We just trust the type-gate
    // (same-dept) and let server validate same-staff = no-op.
    const targetStaff = column.staff.id;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/jobs/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, targetStaff }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `HTTP ${res.status}`);
        // Auto-clear after 3s
        setTimeout(() => setError(null), 3000);
        return;
      }
      broadcastWrite('/api/jobs/reassign');
      router.refresh();
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
          dragOver ? 'bg-sky-50 ring-2 ring-sky-400 ring-inset' : ''
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
            {dragOver ? 'วางที่นี่เพื่อย้ายงาน' : 'ไม่มีงานค้าง'}
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
