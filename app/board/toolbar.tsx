'use client';

import Link from 'next/link';
import { useState } from 'react';
import { JobForm } from './job-form';
import type { BoardJob } from '@/lib/board';
import { IconFileText, IconPlus } from '@/lib/icons';

interface ToolbarProps {
  canCreate: boolean;
  isAdmin: boolean;
  jobs: BoardJob[];
  defaultOrderer: string;
}

/** Quick-actions row above the Kanban. Order entry moved to the
 *  dedicated /orders/new page per user feedback 2026-05-06 — only the
 *  "+ งานเดี่ยว" button (for orphan recovery) and "สั่งงานใหม่" link
 *  stay here as quick-access. */
export function BoardToolbar({ canCreate, isAdmin, jobs, defaultOrderer }: ToolbarProps) {
  void jobs;
  void isAdmin;
  void defaultOrderer;
  const [addJobOpen, setAddJobOpen] = useState(false);

  if (!canCreate) return null;
  return (
    <>
      <Link
        href="/orders/new"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
      >
        <IconFileText size={13} />
        สั่งงานใหม่
      </Link>
      <button
        type="button"
        onClick={() => setAddJobOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 transition-colors"
        title="เพิ่ม job เดี่ยวๆ (ไม่มีใบสั่งงาน) — ใช้สำหรับ recover orphan"
      >
        <IconPlus size={13} />
        งานเดี่ยว
      </button>
      <JobForm open={addJobOpen} onClose={() => setAddJobOpen(false)} />
    </>
  );
}
