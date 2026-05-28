import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { loadBoardDelta, type BoardDelta } from '@/lib/board-delta';
import { COOKIE_NAME, verifySession, type Session } from '@/lib/auth';
import {
  computeBoard,
  DEPT_LABELS,
  type BoardFilters,
  type Dept,
} from '@/lib/board';
import type { Urgency } from '@/lib/calendar';
import { Column } from './column';
import { BoardClient } from './board-client';
import { BoardToolbar } from './toolbar';
import { DashboardShell } from '@/components/dashboard-shell';
import { KPIBar } from '@/components/board/kpi-bar';
import { FilterChips } from '@/components/board/filter-chips';
import { SearchBox } from '@/components/board/search-box';
import { BulkModeProvider } from '@/components/board/bulk-context';
import { BulkActionsBar } from '@/components/board/bulk-actions-bar';
import { UndoProvider } from '@/components/board/undo-context';
import { PendingMutationsProvider } from '@/components/board/pending-mutations';

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

/** Top-level Server Component. Returns the page shell (sidebar, header,
 *  search) immediately — Apps Script `loadAll()` is awaited inside the
 *  `<BoardData>` Suspense boundary so the user sees the layout skeleton
 *  in ~50ms instead of staring at a blank page for 300-1500ms while the
 *  server holds. (Compared to the previous shape that awaited loadAll
 *  at the top of the page function.) */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/board');

  // ── Delta-fetch P3 (NEXT_PUBLIC_DELTA_FETCH) ──────────────────────────
  // Client-driven board: the server ships a bootstrap snapshot, then the
  // client delta-polls `/api/board/delta` and merges changed rows. Filtering
  // moves client-side (BoardClient reads searchParams) so this path needs no
  // `filters` / Suspense filter-key. Flag OFF → the original server-rendered
  // `router.refresh()` path below, untouched.
  if (process.env.NEXT_PUBLIC_DELTA_FETCH === '1') {
    return (
      <DashboardShell user={session.user} role={session.role}>
        {/* Top date row + search — no data dep, render in the first chunk */}
        <div className="bg-white border-b border-stone-100">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm text-stone-500">{todayThaiLong()}</div>
            </div>
            <SearchBox />
          </div>
        </div>
        <div className="px-4 sm:px-6 py-4 space-y-4">
          <Suspense fallback={<BoardSkeleton />}>
            <BoardDataDelta session={session} />
          </Suspense>
        </div>
      </DashboardShell>
    );
  }

  const filters: BoardFilters = {
    dept: VALID_DEPTS.includes(searchParams.dept as Dept) ? (searchParams.dept as Dept) : '',
    urgency: VALID_URGENCY.includes(searchParams.u as Urgency)
      ? (searchParams.u as Urgency)
      : '',
    query: (searchParams.q || '').trim(),
  };

  // Suspense key derived from filters — different filter sets bust the
  // cached resolved component and force a fresh skeleton frame, so the
  // user gets immediate feedback instead of seeing the previous board
  // hang while the new one renders.
  const dataKey = `${filters.dept}|${filters.urgency}|${filters.query}`;

  return (
    <DashboardShell user={session.user} role={session.role}>
      <UndoProvider>
      <PendingMutationsProvider>
      <BulkModeProvider>
        {/* Top date row + search — no data dep, render in the first chunk */}
        <div className="bg-white border-b border-stone-100">
          <div className="px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm text-stone-500">{todayThaiLong()}</div>
            </div>
            <SearchBox />
          </div>
        </div>

        <div className="px-4 sm:px-6 py-4 space-y-4">
          <Suspense key={dataKey} fallback={<BoardSkeleton />}>
            <BoardData filters={filters} session={session} />
          </Suspense>
        </div>
      </BulkModeProvider>
      </PendingMutationsProvider>
      </UndoProvider>
    </DashboardShell>
  );
}

/** Async data section — awaits loadAll() and renders KPI + toolbar +
 *  dept sections + bulk bar. Lives behind a Suspense boundary so the
 *  page shell streams to the client first. */
async function BoardData({
  filters,
  session,
}: {
  filters: BoardFilters;
  session: Session;
}) {
  let board: ReturnType<typeof computeBoard> | undefined;
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
    <>
      {board && <KPIBar totals={board.totalsByUrgency} jobs={board.allJobs} />}

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

      <BulkActionsBar jobs={visibleJobs} isAdmin={session.role === 'admin'} />
    </>
  );
}

/** Delta-fetch data section (NEXT_PUBLIC_DELTA_FETCH path). Awaits the
 *  bootstrap snapshot — `loadBoardDelta(null)` returns jobs + orders +
 *  serverTime, reading only the 2 tables /board needs (closes audit PA-H2,
 *  vs `loadAll()`'s 5-table over-fetch) — then hands it to the client
 *  `<BoardClient>`. Lives behind a Suspense boundary so the page shell
 *  (sidebar, date row, search) streams to the client first.
 *
 *  On a Postgres error there is no client mount to retry, so the error
 *  surfaces as a panel; the user reloads. */
async function BoardDataDelta({ session }: { session: Session }) {
  let initial: BoardDelta | null = null;
  let errorMessage: string | null = null;
  try {
    initial = await loadBoardDelta(null);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (!initial) {
    return <ErrorPanel message={errorMessage || 'โหลด Kanban ไม่สำเร็จ'} />;
  }

  return (
    <BoardClient
      initialJobs={initial.jobs}
      initialOrders={initial.orders}
      initialServerTime={initial.serverTime}
      sessionRole={session.role}
      canCreate={session.role === 'admin' || session.role === 'sales'}
      isAdmin={session.role === 'admin'}
      defaultOrderer={session.user}
    />
  );
}

/** Layout-matched skeleton shown while BoardData awaits loadAll. Geometry
 *  is tuned to /board: 4 KPI chips + toolbar row + 3 dept sections × 3
 *  staff columns × 4 card stubs. Animates with `animate-pulse`. */
function BoardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {/* KPI bar — 4 urgency chips */}
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-11 w-32 bg-stone-100 rounded-lg animate-pulse" />
        ))}
      </div>
      {/* Toolbar — create-order + admin buttons */}
      <div className="flex gap-2">
        <div className="h-9 w-36 bg-stone-100 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
        <div className="h-9 w-24 bg-stone-100 rounded-lg animate-pulse" />
      </div>
      {/* 3 dept sections */}
      {[0, 1, 2].map((s) => (
        <div key={s} className="space-y-2">
          <div className="flex items-baseline gap-3 px-1 pt-2">
            <div className="h-4 w-28 bg-stone-200 rounded animate-pulse" />
            <div className="h-3 w-20 bg-stone-100 rounded animate-pulse" />
            <div className="h-3 w-12 bg-stone-100 rounded animate-pulse ml-auto" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((c) => (
              <div key={c} className="space-y-2 bg-white border border-stone-100 rounded-lg p-2">
                <div className="h-12 bg-stone-100 rounded animate-pulse" />
                {[0, 1, 2, 3].map((j) => (
                  <div
                    key={j}
                    className="h-20 bg-stone-50 border border-stone-100 rounded animate-pulse"
                    style={{ animationDelay: `${(s + c + j) * 80}ms` }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
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
