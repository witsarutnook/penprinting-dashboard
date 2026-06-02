'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Job, Order } from '@/lib/types';
import { computeBoard, type BoardFilters, type Dept } from '@/lib/board';
import type { Urgency } from '@/lib/calendar';
import { useDeltaSync } from '@/lib/delta-sync';
import { Column } from './column';
import { BoardToolbar } from './toolbar';
import { KPIBar } from '@/components/board/kpi-bar';
import { FilterChips } from '@/components/board/filter-chips';
import { BulkModeProvider } from '@/components/board/bulk-context';
import { BulkActionsBar } from '@/components/board/bulk-actions-bar';
import { UndoProvider } from '@/components/board/undo-context';
import { PendingMutationsProvider } from '@/components/board/pending-mutations';

const VALID_DEPTS: Dept[] = ['graphic', 'print', 'post'];
const VALID_URGENCY: Urgency[] = ['overdue', 'dday', 'urgent', 'normal'];

const DEPT_ENGLISH: Record<Dept, string> = {
  graphic: 'GRAPHICS',
  print: 'PRINTING',
  post: 'POST-PRESS & SHIPPING',
};

/**
 * Client-side `/board` body. Holds jobs + orders in local state via
 * `useDeltaSync`, which polls `/api/board/delta` and merges only changed
 * rows — no per-tick `router.refresh()` / full board re-render. Filtering
 * (`?dept=` `?u=` `?q=`) runs client-side off `useSearchParams`, so
 * changing a filter re-buckets instantly with no server round-trip or
 * skeleton flash.
 *
 * Audit closures:
 *  - PA-H2 — initial fetch is `loadBoardDelta(null)` (jobs + orders only),
 *            not `loadAll()`'s 5-table over-fetch.
 *  - PA-M2 — `mergeDelta` returns the same state ref on a no-op poll, so an
 *            idle tick never re-renders KPIBar / toolbar.
 */
export function BoardClient({
  initialJobs,
  initialOrders,
  initialServerTime,
  sessionRole,
  canCreate,
  isAdmin,
  defaultOrderer,
}: {
  initialJobs: Job[];
  initialOrders: Order[];
  initialServerTime: string;
  sessionRole: string | null;
  canCreate: boolean;
  isAdmin: boolean;
  defaultOrderer: string;
}) {
  const { jobs, orders, pollNow } = useDeltaSync({
    jobs: initialJobs,
    orders: initialOrders,
    serverTime: initialServerTime,
  });

  const searchParams = useSearchParams();
  const filters: BoardFilters = useMemo(() => {
    const dept = searchParams.get('dept') || '';
    const u = searchParams.get('u') || '';
    return {
      dept: VALID_DEPTS.includes(dept as Dept) ? (dept as Dept) : '',
      urgency: VALID_URGENCY.includes(u as Urgency) ? (u as Urgency) : '',
      query: (searchParams.get('q') || '').trim(),
    };
  }, [searchParams]);

  const board = useMemo(
    () => computeBoard({ jobs, orders }, filters),
    [jobs, orders, filters],
  );

  // Flat list of currently-visible jobs — fed to the bulk-actions bar so
  // selection-only ops work against the same filtered view.
  const visibleJobs = useMemo(
    () => board.depts.flatMap((d) => d.columns.flatMap((c) => c.jobs)),
    [board],
  );

  return (
    <UndoProvider>
      <PendingMutationsProvider pollNow={pollNow}>
        <BulkModeProvider>
          <KPIBar totals={board.totalsByUrgency} jobs={board.allJobs} />

          {/* Tool row: create-order, etc. */}
          <div className="flex flex-wrap items-center gap-2">
            <BoardToolbar
              canCreate={canCreate}
              isAdmin={isAdmin}
              jobs={visibleJobs}
              defaultOrderer={defaultOrderer}
            />
          </div>

          {board.depts.map((dept) => (
            <section key={dept.dept} className="space-y-2">
              <DeptSectionHeader
                dept={dept.dept}
                label={dept.label}
                count={dept.columns.reduce((sum, c) => sum + c.jobs.length, 0)}
              />
              {/* Filter chips below the first dept heading only */}
              {dept.dept === board.depts[0].dept && <FilterChips />}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {dept.columns.map((col) => (
                  <Column
                    key={col.staff.id}
                    dept={dept.dept}
                    column={col}
                    sessionRole={sessionRole}
                  />
                ))}
              </div>
            </section>
          ))}

          <BulkActionsBar jobs={visibleJobs} isAdmin={isAdmin} />
        </BulkModeProvider>
      </PendingMutationsProvider>
    </UndoProvider>
  );
}

function DeptSectionHeader({
  dept,
  label,
  count,
}: {
  dept: Dept;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-baseline gap-3 px-1 pt-2">
      <h2 className="text-sm font-semibold text-stone-700">{label}</h2>
      <span className="text-[11px] uppercase tracking-wider text-stone-400">
        — {DEPT_ENGLISH[dept]}
      </span>
      <span className="text-xs text-stone-400 tabular-nums ml-auto">
        {count} งาน
      </span>
    </div>
  );
}
