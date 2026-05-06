'use client';

import { useState } from 'react';
import { JobForm } from './job-form';

/** Toolbar shown in `/board` header. Owns add-job modal state. */
export function BoardToolbar({ canCreate }: { canCreate: boolean }) {
  const [open, setOpen] = useState(false);

  if (!canCreate) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
      >
        ➕ เพิ่มงาน
      </button>
      <JobForm open={open} onClose={() => setOpen(false)} />
    </>
  );
}
