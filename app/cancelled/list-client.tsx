'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Cancelled } from '@/lib/types';
import { useDeltaSync } from '@/lib/delta-sync';
import { broadcastWrite } from '@/lib/auto-sync';
import { useConfirm } from '@/components/confirm-provider';
import { buildCsv, downloadCsv, distinctYears, filterByYearMonth, THAI_MONTHS_FULL } from '@/lib/list-helpers';
import { displayDateTime } from '@/lib/jobs';
import { DEPT_LABELS, type Dept } from '@/lib/board';
import { resolvePerPage, resolvePage, paginate, clampPage } from '@/lib/page-size';
import { PageSizeBar } from '@/components/page-size-bar';
import { PaginationBar } from '@/components/pagination-bar';
import {
  IconRefreshCw, IconDownload, IconAlertCircle, IconSearch,
} from '@/lib/icons';

/**
 * Client-side `/cancelled` body. Bootstraps from `loadBoardDelta({ fullLists })`
 * then delta-polls — drops the previous `useAutoSync` full-page `router.refresh()`
 * pattern in favor of a small incremental delta. Filters + paginate run
 * locally off `useSearchParams`, no server round-trip when the user
 * changes a year/month filter.
 *
 * Restore + CSV export live inline (single-use here — extracting them as
 * shared components would just add file count).
 */
export function CancelledListClient({
  initialCancelled,
  initialServerTime,
}: {
  initialCancelled: Cancelled[];
  initialServerTime: string;
}) {
  const { cancelled } = useDeltaSync(
    {
      // /cancelled doesn't read jobs/orders — bootstrap with empty arrays,
      // delta endpoint still returns the small jobs/orders delta but we ignore.
      jobs: [],
      orders: [],
      cancelled: initialCancelled,
      shipped: [],
      serverTime: initialServerTime,
    },
    { fullLists: true },
  );

  const searchParams = useSearchParams();
  const { sorted, years, filtered, query, year, month, perPage, page, hasActiveFilter } = useMemo(() => {
    const query = (searchParams.get('q') || '').trim().toLowerCase();
    const year = Number(searchParams.get('year')) || 0;
    const month = Number(searchParams.get('month')) || 0;
    const perPage = resolvePerPage(searchParams.get('per') ?? undefined);
    const page = resolvePage(searchParams.get('page') ?? undefined);

    const sorted = [...cancelled].sort((a, b) => Number(b.id) - Number(a.id));
    const years = distinctYears(sorted, (c) => c.cancelledAt);
    const filtered = filterByYearMonth(sorted, (c) => c.cancelledAt, year, month).filter((c) => {
      if (!query) return true;
      const haystack = `${c.name} ${c.id} ${c.cancelledBy} ${c.reason}`.toLowerCase();
      return haystack.includes(query);
    });
    return {
      sorted, years, filtered, query, year, month, perPage, page,
      hasActiveFilter: !!(query || year || month),
    };
  }, [cancelled, searchParams]);

  function exportCsv() {
    const headers = ['#', 'ชื่องาน', 'แผนก', 'ผู้รับงาน', 'ยกเลิกโดย', 'วันที่ยกเลิก', 'เหตุผล', 'orderId'];
    const data = filtered.map((c) => [
      c.id,
      c.name || '',
      DEPT_LABELS[c.dept as Dept] || c.dept || '',
      c.staff || '',
      c.cancelledBy || '',
      displayDateTime(c.cancelledAt),
      c.reason || '',
      c.orderId || '',
    ]);
    const csv = buildCsv(headers, data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`cancelled-${stamp}.csv`, csv);
  }

  return (
    <>
      <FilterForm query={query} year={year} month={month} years={years} hasActiveFilter={hasActiveFilter} />

      <div className="text-xs text-stone-500 tabular-nums">
        {filtered.length}/{sorted.length} รายการ
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={exportCsv}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
        >
          <IconDownload size={13} />
          Export CSV ({filtered.length})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
          <div className="flex justify-center mb-2 text-stone-300">
            <IconAlertCircle size={36} />
          </div>
          <p className="text-sm text-stone-500">
            {hasActiveFilter ? 'ไม่พบรายการที่ตรงตามตัวกรอง' : 'ไม่มีรายการยกเลิก'}
          </p>
        </div>
      ) : (
        (() => {
          const safePage = clampPage(page, filtered.length, perPage);
          const visible = paginate(filtered, safePage, perPage);
          return (
            <>
              <PageSizeBar total={filtered.length} perPage={perPage} shown={visible.length} />
              <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-14">#</th>
                      <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                      <th className="text-left px-3 py-2 font-medium">แผนก</th>
                      <th className="text-left px-3 py-2 font-medium">ยกเลิกโดย</th>
                      <th className="text-right px-3 py-2 font-medium">วันที่ยกเลิก</th>
                      <th className="text-left px-3 py-2 font-medium">เหตุผล</th>
                      <th className="text-right px-3 py-2 font-medium w-24">การจัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {visible.map((c) => (
                      <tr key={c.id} className="hover:bg-red-50/30">
                        <td className="px-3 py-2 tabular-nums text-stone-500">#{c.id}</td>
                        <td className="px-3 py-2 font-medium text-red-700 line-through decoration-red-300">
                          {c.name}
                        </td>
                        <td className="px-3 py-2 text-stone-600">
                          {DEPT_LABELS[c.dept as Dept] || c.dept || '—'}
                        </td>
                        <td className="px-3 py-2 text-stone-600">{c.cancelledBy || '—'}</td>
                        <td className="px-3 py-2 text-right text-stone-500 tabular-nums whitespace-nowrap">
                          {displayDateTime(c.cancelledAt)}
                        </td>
                        <td className="px-3 py-2 text-stone-600 max-w-[18rem] truncate" title={c.reason}>
                          {c.reason || '—'}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <RestoreButton
                            id={c.id}
                            name={c.name}
                            dept={c.dept}
                            staff={c.staff}
                            orderId={c.orderId}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar total={filtered.length} perPage={perPage} page={safePage} className="pt-2" />
            </>
          );
        })()
      )}
    </>
  );
}

function FilterForm({
  query, year, month, years, hasActiveFilter,
}: {
  query: string;
  year: number;
  month: number;
  years: number[];
  hasActiveFilter: boolean;
}) {
  return (
    <form action="/cancelled" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ค้นชื่องาน / ผู้ยกเลิก / เหตุผล..."
          className="w-full pl-9 pr-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>
      <select
        name="year"
        defaultValue={year || ''}
        className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white tabular-nums focus:outline-none focus:border-accent"
      >
        <option value="">ทุกปี</option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y + 543}
          </option>
        ))}
      </select>
      <select
        name="month"
        defaultValue={month || ''}
        className="px-3 py-2 border border-stone-200 rounded-xl text-sm bg-white focus:outline-none focus:border-accent"
      >
        <option value="">ทุกเดือน</option>
        {THAI_MONTHS_FULL.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="px-3 py-2 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-dark"
      >
        กรอง
      </button>
      {hasActiveFilter && (
        <a href="/cancelled" className="text-xs text-stone-500 hover:text-stone-700 underline">
          ล้างตัวกรอง
        </a>
      )}
    </form>
  );
}

/** Per-row restore button — admin only, posts to /api/jobs/restore.
 *  Accepts the FULL cancelled-row snapshot from the parent so the server
 *  can skip a `loadAllFresh()` round-trip — saves ~600ms per restore. */
function RestoreButton({
  id, name, dept, staff, orderId,
}: {
  id: number;
  name: string;
  dept: string;
  staff: string;
  orderId: number | null;
}) {
  const confirmDlg = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    const ok = await confirmDlg.confirm({
      title: `กู้คืนงาน "${name}"?`,
      message: 'งานจะกลับเข้า Kanban ในแผนกเดิม สถานะ "รอดำเนินการ"',
      okLabel: 'กู้คืน',
      variant: 'default',
    });
    if (!ok) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/jobs/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        srcCancelled: { name, dept, staff, orderId },
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return;
    }
    // broadcastWrite triggers a delta poll on this hook's BroadcastChannel
    // listener → fullLists delta drops the just-deleted cancelled row +
    // adds the restored job. No router.refresh() needed.
    broadcastWrite('/api/jobs/restore');
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-700" title={error}>
        <IconAlertCircle size={12} />
        ผิดพลาด
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={restore}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-medium disabled:opacity-50"
    >
      <IconRefreshCw size={11} />
      {busy ? 'กำลังกู้คืน...' : 'กู้คืน'}
    </button>
  );
}
