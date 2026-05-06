import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import {
  computeBoard,
  DEPT_LABELS,
  type BoardFilters,
  type Dept,
} from '@/lib/board';
import type { Urgency } from '@/lib/calendar';
import { Column } from './column';
import { BoardToolbar } from './toolbar';
import { AutoSync } from '@/lib/auto-sync';
import { DashboardShell } from '@/components/dashboard-shell';
import { KPIBar } from '@/components/board/kpi-bar';
import { FilterChips } from '@/components/board/filter-chips';
import { SearchBox } from '@/components/board/search-box';
import { BulkModeProvider } from '@/components/board/bulk-context';
import { BulkActionsBar } from '@/components/board/bulk-actions-bar';
import { UndoProvider } from '@/components/board/undo-context';

export const metadata: Metadata = {
  title: 'Kanban Board',
};

const VALID_DEPTS: Dept[] = ['graphic', 'print', 'post'];
const VALID_URGENCY: Urgency[] = ['overdue', 'dday', 'urgent', 'normal'];

const DEPT_ENGLISH: Record<Dept, string> = {
  graphic: 'GRAPHICS',
  print: 'PRINTING',
  post: 'POST-PRESS & SHIPPING',
};

interface SearchParams {
  dept?: string;
  u?: string;
  q?: string;
}

function todayThaiLong(): string {
  const fmt = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return fmt.format(new Date());
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/board');

  const filters: BoardFilters = {
    dept: VALID_DEPTS.includes(searchParams.dept as Dept) ? (searchParams.dept as Dept) : '',
    urgency: VALID_URGENCY.includes(searchParams.u as Urgency)
      ? (searchParams.u as Urgency)
      : '',
    query: (searchParams.q || '').trim(),
  };

  let board;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    board = computeBoard(data, filters);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  // Flat list of currently-visible jobs — fed to bulk-actions bar so that
  // selection-only ops (intersection of FW_TARGETS) work against the same
  // view the user is filtering.
  const visibleJobs = board
    ? board.depts.flatMap((d) => d.columns.flatMap((c) => c.jobs))
    : [];

  return (
    <DashboardShell user={session.user} role={session.role}>
      <AutoSync />
      <UndoProvider>
      <BulkModeProvider>
        {/* Top date row + search */}
        <div className="bg-white border-b border-stone-100">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm text-stone-500">{todayThaiLong()}</div>
            </div>
            <SearchBox />
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4">
          {board && <KPIBar totals={board.totalsByUrgency} jobs={visibleJobs} />}

          {/* Tool row: toolbar buttons (create order, etc) */}
          <div className="flex flex-wrap items-center gap-2">
            <BoardToolbar
              canCreate={session.role === 'admin' || session.role === 'sales'}
              isAdmin={session.role === 'admin'}
              jobs={visibleJobs}
              defaultOrderer={session.user}
            />
          </div>

          {errorMessage ? (
            <ErrorPanel message={errorMessage} />
          ) : board ? (
            <>
              {/* Group section: dept heading + filter row */}
              {board.depts.map((dept) => (
                <section key={dept.dept} className="space-y-2">
                  <DeptSectionHeader
                    dept={dept.dept}
                    label={dept.label}
                    count={dept.columns.reduce((sum, c) => sum + c.jobs.length, 0)}
                  />
                  {/* Filter chips below first dept heading only */}
                  {dept.dept === board.depts[0].dept && <FilterChips />}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {dept.columns.map((col) => (
                      <Column
                        key={col.staff.id}
                        dept={dept.dept}
                        column={col}
                        sessionRole={session.role}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          ) : null}
        </div>

        <BulkActionsBar jobs={visibleJobs} isAdmin={session.role === 'admin'} />
      </BulkModeProvider>
      </UndoProvider>
    </DashboardShell>
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
      <h2 className="text-sm font-semibold text-stone-700">
        {label}
      </h2>
      <span className="text-[11px] uppercase tracking-wider text-stone-400">
        — {DEPT_ENGLISH[dept]}
      </span>
      <span className="text-xs text-stone-400 tabular-nums ml-auto">
        {count} งาน
      </span>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Kanban ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}

// Suppress unused warning — DEPT_LABELS is re-exported through column.tsx
void DEPT_LABELS;
