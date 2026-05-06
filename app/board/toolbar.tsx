'use client';

import { useState } from 'react';
import { JobForm } from './job-form';
import { OrderForm } from './order-form';
import { BulkForwardModal } from './bulk-forward-modal';
import type { BoardJob } from '@/lib/board';

interface ToolbarProps {
  canCreate: boolean;
  isAdmin: boolean;
  /** Active jobs (post-computeBoard) — needed for bulk forward picker. */
  jobs: BoardJob[];
  /** Default orderer for new orders — usually the logged-in user's display name. */
  defaultOrderer: string;
}

/** Toolbar shown in `/board` header. Owns order/job/bulk-forward modal state. */
export function BoardToolbar({ canCreate, isAdmin, jobs, defaultOrderer }: ToolbarProps) {
  const [orderOpen, setOrderOpen] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  return (
    <>
      {jobs.length > 0 && (
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-sky-100 text-sky-800 text-xs font-medium hover:bg-sky-200 transition-colors"
        >
          ↪ ส่งต่อหลายงาน
        </button>
      )}
      {canCreate && (
        <>
          <button
            type="button"
            onClick={() => setOrderOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
          >
            📝 ใบสั่งใหม่
          </button>
          <button
            type="button"
            onClick={() => setAddJobOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 transition-colors"
            title="เพิ่ม job เดี่ยวๆ (ไม่มีใบสั่งงาน) — ใช้สำหรับ recover orphan"
          >
            + งานเดี่ยว
          </button>
        </>
      )}
      <OrderForm open={orderOpen} onClose={() => setOrderOpen(false)} defaultOrderer={defaultOrderer} />
      <JobForm open={addJobOpen} onClose={() => setAddJobOpen(false)} />
      <BulkForwardModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        jobs={jobs}
        isAdmin={isAdmin}
      />
    </>
  );
}
