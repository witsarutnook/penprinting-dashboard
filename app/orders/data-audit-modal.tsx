'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { IconAlertCircle } from '@/lib/icons';

// Heavy modal — only loads when admin actually clicks "ตรวจสอบข้อมูล".
// The button itself stays inline so the badge counter renders without
// pulling the modal chunk into /orders page-load bundle.
const DataAuditModalLazy = dynamic(
  () => import('./data-audit-modal-impl').then(m => ({ default: m.DataAuditModalImpl })),
  { ssr: false },
);

export interface OrphanOrder {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  assignDept: string;
  assignStaff: string;
}

export interface DuplicateRow {
  id: number;
  dept: string;
  staff: string;
}

export interface DuplicateGroup {
  orderId: number;
  name: string;
  rows: DuplicateRow[];
}

/**
 * Data integrity audit button — admin only. Mirrors WP `openDataAuditModal()`
 * (production-monitoring.js:5480-5550). Two sections in the modal:
 *
 *  1. **Orphan orders** — order.status='sent' but no matching job/shipped/
 *     cancelled row. Admin picks dept/staff and recovers via `addJob`.
 *  2. **Duplicate jobs** — same orderId+name appears in multiple jobs rows
 *     (caused by partial-failure forwards before bulkForward atomic).
 *     Admin can remove the older rows; newest is kept.
 *
 * Both lists are computed server-side from the same loadAll snapshot the
 * /orders page already fetched, so opening the modal is free (no extra
 * Apps Script round-trip).
 */
export function DataAuditButton({
  orphans,
  duplicates,
  isAdmin,
}: {
  orphans: OrphanOrder[];
  duplicates: DuplicateGroup[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const totalIssues = orphans.length + duplicates.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${
          totalIssues > 0
            ? 'bg-red-50 text-red-700 hover:bg-red-100'
            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
        }`}
        title="ตรวจ orphan orders + duplicate jobs"
      >
        <IconAlertCircle size={13} />
        ตรวจสอบข้อมูล {totalIssues > 0 && `(${totalIssues})`}
      </button>
      {open && (
        <DataAuditModalLazy
          orphans={orphans}
          duplicates={duplicates}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
