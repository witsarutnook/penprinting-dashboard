import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { displayDate } from '@/lib/jobs';
import { IconCheck, IconFolderOpen, IconFileText, IconPencil } from '@/lib/icons';
import { DashboardShell } from '@/components/dashboard-shell';
import {
  normalizeArchiveQuery,
  searchArchiveOrders,
  archiveRowState,
  ARCHIVE_MIN_QUERY_LENGTH,
  type ArchiveOrderRow,
  type ArchiveSearchResult,
  type ArchiveStateKind,
} from '@/lib/archive-search';

export const metadata: Metadata = {
  title: 'ค้นข้อมูลเก่า',
};

interface SearchParams {
  q?: string;
}

/** All-years order search (§13). Postgres-only — the Apps Script
 *  `searchArchive` it replaced only scanned Sheet tabs that never existed. */
export default async function ArchivePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Admin-only (matches WP — searchArchive was admin-restricted in ROLE_REQUIREMENTS)
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') {
    redirect('/analytics');
  }

  const rawQuery = (searchParams.q || '').trim();
  const query = normalizeArchiveQuery(rawQuery);
  let result: ArchiveSearchResult | null = null;
  let errorMessage: string | null = null;

  if (query) {
    try {
      result = await searchArchiveOrders(query);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold text-stone-900">ค้นข้อมูลเก่า</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 hidden sm:inline">
            admin only
          </span>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto">
        <SearchBox initial={rawQuery} />

        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : rawQuery.length === 0 ? (
          <EmptyState />
        ) : !query ? (
          <Hint>กรุณาใส่คำค้นอย่างน้อย {ARCHIVE_MIN_QUERY_LENGTH} ตัวอักษร</Hint>
        ) : !result ? null : result.rows.length === 0 ? (
          <Hint>ไม่พบผลลัพธ์สำหรับ &ldquo;{query}&rdquo;</Hint>
        ) : (
          <Results result={result} query={query} />
        )}

        <p className="text-xs text-stone-400 mt-6 text-right">
          ค้นจากใบสั่งงานทั้งหมดทุกปี — ไม่จำกัด 12 เดือนเหมือน /orders ·
          ค้น ชื่องาน / ลูกค้า / ผู้สั่ง / เลข id (ขึ้นต้น)
        </p>
      </div>
    </DashboardShell>
  );
}

// ─── Components ────────────────────────────────────────────

function SearchBox({ initial }: { initial: string }) {
  return (
    <form
      action="/archive"
      method="GET"
      className="bg-white rounded-xl border border-stone-200 p-3 mb-4 flex gap-2 items-center"
    >
      <input
        name="q"
        defaultValue={initial}
        autoFocus
        placeholder={`ชื่องาน / ลูกค้า / ผู้สั่ง / เลข id — ขั้นต่ำ ${ARCHIVE_MIN_QUERY_LENGTH} ตัวอักษร`}
        className="flex-grow px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-dark transition-colors"
      >
        ค้นหา
      </button>
    </form>
  );
}

const PILL_CLASS: Record<ArchiveStateKind, string> = {
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  shipped: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-stone-100 text-stone-600 border-stone-200',
  active: 'bg-amber-50 text-amber-800 border-amber-200',
};

function Results({ result, query }: { result: ArchiveSearchResult; query: string }) {
  return (
    <>
      <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <IconCheck size={14} className="flex-shrink-0" />
        <span>
          พบ <span className="font-semibold tabular-nums">{result.total}</span> รายการสำหรับ{' '}
          <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded">{query}</span>
          {result.truncated && (
            <span className="text-stone-500">
              {' '}
              (แสดง {result.rows.length} แรก — เพิ่มคำค้นให้เจาะจงเพื่อกรองให้แคบลง)
            </span>
          )}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">#</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ชื่องาน</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ลูกค้า</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ผู้สั่ง</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">รับงาน</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">กำหนดส่ง</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ราคา</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะ</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <ResultRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ResultRow({ row }: { row: ArchiveOrderRow }) {
  const state = archiveRowState(row);
  const detail = state.kind === 'shipped' && state.detail ? displayDate(state.detail) : state.detail;
  return (
    <tr className="border-t border-stone-100 hover:bg-stone-50/40 align-top">
      <td className="px-3 py-2 tabular-nums text-stone-500 whitespace-nowrap">{row.id}</td>
      <td className="px-3 py-2 text-stone-900 font-medium">{row.name || '—'}</td>
      <td className="px-3 py-2 text-stone-700">{row.customer || '—'}</td>
      <td className="px-3 py-2 text-stone-700">{row.orderer || '—'}</td>
      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{displayDate(row.dateIn)}</td>
      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{displayDate(row.dateDue)}</td>
      <td className="px-3 py-2 text-stone-700 tabular-nums whitespace-nowrap">{row.price || '—'}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${PILL_CLASS[state.kind]}`}
        >
          {state.label}
        </span>
        {detail && (
          <div className="text-[11px] text-stone-500 mt-0.5 max-w-[16rem] truncate" title={detail}>
            {detail}
          </div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link
          href={`/orders/${row.id}/print`}
          className="inline-flex items-center gap-1 text-accent hover:underline mr-3"
        >
          <IconFileText size={13} />
          ใบสั่งงาน
        </Link>
        <Link
          href={`/orders/${row.id}/edit`}
          className="inline-flex items-center gap-1 text-stone-600 hover:underline"
        >
          <IconPencil size={13} />
          แก้ไข
        </Link>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-dashed border-stone-200 p-8 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconFolderOpen size={36} />
      </div>
      <p className="text-sm text-stone-600">
        ค้นหาใบสั่งงานเก่าทุกปี — รวมทั้งที่{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">ส่งแล้ว</code>,{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">ยกเลิก</code> และที่ยังทำอยู่
      </p>
      <p className="text-xs text-stone-400 mt-3">
        ใส่ชื่องาน, ชื่อลูกค้า, ผู้สั่ง หรือเลข id (เช่น 2025 = ทุกงานปี 2025) แล้วกดค้นหา
      </p>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">ค้นหาไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
