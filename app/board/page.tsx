import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { computeBoard, URGENCY_COLORS, URGENCY_LABELS, type Urgency } from '@/lib/board';
import { LogoutButton } from '../analytics/logout-button';
import { Column } from './column';
import { BoardToolbar } from './toolbar';
import { AutoSync } from '@/lib/auto-sync';
import { IconArrowLeft } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'Kanban Board',
};

// Server Component — fetches loadAll, computes board server-side, renders read-only view
export default async function BoardPage() {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  // No role restriction — all logged-in users see board (matches WP behavior)

  let board;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    board = computeBoard(data);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <AutoSync />
      <header className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-full mx-auto px-3 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-stone-500 hover:text-stone-700 inline-flex items-center"
              aria-label="กลับหน้าหลัก"
            >
              <IconArrowLeft size={18} />
            </Link>
            <h1 className="text-lg sm:text-xl font-bold text-stone-900">Kanban Board</h1>
          </div>
          {session && (
            <div className="flex items-center gap-2 text-xs text-stone-500 flex-wrap">
              <BoardToolbar
                canCreate={session.role === 'admin' || session.role === 'sales'}
                isAdmin={session.role === 'admin'}
                jobs={board ? board.depts.flatMap((d) => d.columns.flatMap((c) => c.jobs)) : []}
                defaultOrderer={session.user}
              />
              <span>
                {session.user} <span className="text-stone-400">({session.role})</span>
              </span>
              <LogoutButton />
            </div>
          )}
        </div>
        {board && (
          <div className="max-w-full mx-auto px-3 sm:px-6 py-2 border-t border-stone-100 flex flex-wrap gap-2 items-center text-xs">
            <span className="text-stone-500">งาน active:</span>
            <span className="font-semibold tabular-nums text-stone-900">{board.totalJobs} รายการ</span>
            {(['overdue', 'dday', 'urgent', 'normal'] as Urgency[]).map((u) =>
              board.totalsByUrgency[u] > 0 ? (
                <span
                  key={u}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-medium tabular-nums"
                  style={{
                    background: URGENCY_COLORS[u] + '20',
                    color: URGENCY_COLORS[u],
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: URGENCY_COLORS[u] }} />
                  {URGENCY_LABELS[u]} {board.totalsByUrgency[u]}
                </span>
              ) : null,
            )}
            <span className="ml-auto text-stone-400 hidden sm:inline tabular-nums">
              auto-sync 15s
            </span>
          </div>
        )}
      </header>

      <div className="max-w-full mx-auto px-3 sm:px-6 py-4">
        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : board ? (
          <div className="space-y-6">
            {board.depts.map((dept) => (
              <section key={dept.dept}>
                <h2 className="text-sm font-bold text-stone-700 mb-2 px-1 flex items-center gap-2">
                  {dept.label}
                  <span className="text-xs font-normal text-stone-400">
                    ({dept.columns.reduce((sum, c) => sum + c.jobs.length, 0)} งาน)
                  </span>
                </h2>
                <div className="overflow-x-auto -mx-3 px-3 pb-2 sm:mx-0 sm:px-0">
                  <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                    {dept.columns.map((col) => (
                      <Column
                        key={col.staff.id}
                        dept={dept.dept}
                        column={col}
                        sessionRole={session?.role || null}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">โหลด Kanban ไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
