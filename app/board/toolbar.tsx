'use client';

import { useState } from 'react';
import { JobForm } from './job-form';
import { OrderForm } from './order-form';
import type { BoardJob } from '@/lib/board';
import { IconFileText, IconPlus } from '@/lib/icons';

interface ToolbarProps {
  canCreate: boolean;
  isAdmin: boolean;
  /** Visible jobs after server-side filter — passed for future use, not currently consumed by toolbar. */
  jobs: BoardJob[];
  defaultOrderer: string;
}

/** Order/job creation buttons. Bulk-forward moved to the inline
 *  checkbox-mode flow (FilterChips toggle + BulkActionsBar) per user
 *  decision 2026-05-06 #5. */
export function BoardToolbar({ canCreate, isAdmin, jobs, defaultOrderer }: ToolbarProps) {
  void jobs;
  void isAdmin;
  const [orderOpen, setOrderOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);

  if (!canCreate) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOrderOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
      >
        <IconFileText size={13} />
        ใบสั่งใหม่
      </button>
      <button
        type="button"
        onClick={() => setAddJobOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 transition-colors"
        title="เพิ่ม job เดี่ยวๆ (ไม่มีใบสั่งงาน) — ใช้สำหรับ recover orphan"
      >
        <IconPlus size={13} />
        งานเดี่ยว
      </button>
      <OrderForm open={orderOpen} onClose={() => setOrderOpen(false)} defaultOrderer={defaultOrderer} />
      <JobForm open={addJobOpen} onClose={() => setAddJobOpen(false)} />
    </>
  );
}
