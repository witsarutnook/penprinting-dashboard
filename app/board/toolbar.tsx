'use client';

import { useState } from 'react';
import { JobForm } from './job-form';
import { BulkForwardModal } from './bulk-forward-modal';
import type { BoardJob } from '@/lib/board';

interface ToolbarProps {
  canCreate: boolean;
  isAdmin: boolean;
  /** Active jobs (post-computeBoard) — needed for bulk forward picker. */
  jobs: BoardJob[];
}

/** Toolbar shown in `/board` header. Owns add-job + bulk-forward modal state. */
export function BoardToolbar({ canCreate, isAdmin, jobs }: ToolbarProps) {
  const [addOpen, setAddOpen] = useState(false);
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
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
        >
          ➕ เพิ่มงาน
        </button>
      )}
      <JobForm open={addOpen} onClose={() => setAddOpen(false)} />
      <BulkForwardModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        jobs={jobs}
        isAdmin={isAdmin}
      />
    </>
  );
}
