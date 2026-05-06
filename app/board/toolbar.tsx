'use client';

import Link from 'next/link';
import type { BoardJob } from '@/lib/board';
import { IconFileText } from '@/lib/icons';

interface ToolbarProps {
  canCreate: boolean;
  isAdmin: boolean;
  jobs: BoardJob[];
  defaultOrderer: string;
}

/** Quick-actions row above the Kanban. The "+ งานเดี่ยว" button (a
 *  standalone-job creator for orphan recovery) was removed per user
 *  feedback — every new job comes through `/orders/new` now, and
 *  recovery is handled via the order-detail "สร้างงานใหม่" flow.
 *  JobForm is still used for inline edit on the card itself
 *  (board/card.tsx → editOpen). */
export function BoardToolbar({ canCreate, isAdmin, jobs, defaultOrderer }: ToolbarProps) {
  void jobs;
  void isAdmin;
  void defaultOrderer;
  if (!canCreate) return null;
  return (
    <Link
      href="/orders/new"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark transition-colors"
    >
      <IconFileText size={13} />
      สั่งงานใหม่
    </Link>
  );
}
