import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { searchArchive, AppsScriptError, type ArchiveSearchResult } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { IconCheck, IconFolderOpen } from '@/lib/icons';
import { DashboardShell } from '@/components/dashboard-shell';

export const metadata: Metadata = {
  title: 'Search Archive',
};

interface SearchParams {
  q?: string;
}

export default async function ArchivePage({ searchParams }: { searchParams: SearchParams }) {
  // Admin-only (matches WP — searchArchive is admin-restricted in ROLE_REQUIREMENTS)
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') {
    redirect('/analytics');
  }

  const query = (searchParams.q || '').trim();
  let result: ArchiveSearchResult | null = null;
  let errorMessage: string | null = null;

  if (query.length >= 2) {
    try {
      result = await searchArchive(query);
    } catch (err) {
      errorMessage = err instanceof AppsScriptError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
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
        <SearchBox initial={query} />

        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : query.length === 0 ? (
          <EmptyState />
        ) : query.length < 2 ? (
          <Hint>กรุณาใส่คำค้นอย่างน้อย 2 ตัวอักษร</Hint>
        ) : !result ? null : result.results.length === 0 ? (
          <Hint>ไม่พบผลลัพธ์สำหรับ &ldquo;{query}&rdquo;</Hint>
        ) : (
          <Results result={result} query={query} />
        )}

        <p className="text-xs text-stone-400 mt-6 text-right">
          ค้นใน <code className="bg-stone-100 px-1 rounded">*_archive_YYYY</code> sheets ·
          shipped/cancelled (≥ 365 วัน) · audit_log (≥ 180 วัน)
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
        placeholder="พิมพ์อะไรก็ได้ (ชื่องาน / ลูกค้า / id) — ขั้นต่ำ 2 ตัวอักษร"
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

function Results({ result, query }: { result: ArchiveSearchResult; query: string }) {
  // Group by source sheet
  const grouped = new Map<string, Array<Record<string, unknown> & { _sheet: string }>>();
  result.results.forEach((r) => {
    const src = r._sheet || 'unknown';
    if (!grouped.has(src)) grouped.set(src, []);
    grouped.get(src)!.push(r);
  });

  const total = result.total ?? result.results.length;
  const showing = result.results.length;

  return (
    <>
      <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <IconCheck size={14} className="flex-shrink-0" />
        <span>
          พบ <span className="font-semibold tabular-nums">{total}</span> รายการสำหรับ{' '}
          <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded">{query}</span>
          {showing < total && (
            <span className="text-stone-500">
              {' '}
              (แสดง {showing} แรก — เพิ่มคำค้นให้เจาะจงเพื่อกรองให้แคบลง)
            </span>
          )}
        </span>
      </div>

      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([sheetName, rows]) => (
          <SheetSection key={sheetName} sheetName={sheetName} rows={rows} />
        ))}
      </div>
    </>
  );
}

function SheetSection({
  sheetName,
  rows,
}: {
  sheetName: string;
  rows: Array<Record<string, unknown> & { _sheet: string }>;
}) {
  // Use keys from first row as column headers (excluding _sheet)
  const cols = Object.keys(rows[0]).filter((k) => k !== '_sheet');
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
      <div className="px-4 py-2.5 bg-stone-100 border-b border-stone-200 flex items-center justify-between">
        <span className="text-sm font-semibold text-stone-800">{sheetName}</span>
        <span className="text-xs text-stone-500 tabular-nums">{rows.length} รายการ</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-stone-50 text-stone-500">
            <tr>
              {cols.map((c) => (
                <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-stone-100 hover:bg-stone-50/40">
                {cols.map((c) => (
                  <td key={c} className="px-3 py-1.5 text-stone-700 align-top">
                    <CellValue value={row[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-stone-400">—</span>;
  const s = String(value);
  if (s.length > 80) {
    return (
      <span title={s}>
        {s.substring(0, 78)}
        <span className="text-stone-400">…</span>
      </span>
    );
  }
  return <>{s}</>;
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-dashed border-stone-200 p-8 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconFolderOpen size={36} />
      </div>
      <p className="text-sm text-stone-600">
        ค้นหาออเดอร์เก่าจาก archive — รวมทั้ง <code className="text-xs bg-stone-100 px-1 rounded">shipped</code>,{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">cancelled</code>,{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">audit_log</code> ของปีก่อนๆ
      </p>
      <p className="text-xs text-stone-400 mt-3">
        ใส่ชื่องาน, ชื่อลูกค้า, หรือเลข id แล้วกดค้นหา
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
