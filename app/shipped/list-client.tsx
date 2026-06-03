'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Order, Shipped } from '@/lib/types';
import { useDeltaSync } from '@/lib/delta-sync';
import { buildCsv, downloadCsv, distinctYears, filterByYearMonth, dateMonthLabel, THAI_MONTHS_FULL } from '@/lib/list-helpers';
import { displayDate } from '@/lib/jobs';
import { resolvePerPage, resolvePage, paginate, clampPage } from '@/lib/page-size';
import { PageSizeBar } from '@/components/page-size-bar';
import { PaginationBar } from '@/components/pagination-bar';
import { IconTruck, IconSearch, IconDownload } from '@/lib/icons';

interface ShippedRow extends Shipped {
  customer: string;
  monthLabel: string;
}

/**
 * Client-side `/shipped` body. Bootstraps from `loadBoardDelta({ fullLists })`
 * then delta-polls. Customer column is resolved from the orders table via
 * orderId — orders come from the same delta payload, so customer names stay
 * fresh without a separate fetch.
 */
export function ShippedListClient({
  initialOrders,
  initialShipped,
  initialServerTime,
}: {
  initialOrders: Order[];
  initialShipped: Shipped[];
  initialServerTime: string;
}) {
  const { orders, shipped } = useDeltaSync(
    {
      jobs: [],
      orders: initialOrders,
      shipped: initialShipped,
      cancelled: [],
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

    const sorted = [...shipped].sort((a, b) => Number(b.id) - Number(a.id));
    const customerByOrderId = new Map<number, string>();
    for (const o of orders) {
      if (o.customer && o.customer !== '-') customerByOrderId.set(Number(o.id), o.customer);
    }
    const enriched: ShippedRow[] = sorted.map((s) => ({
      ...s,
      customer: s.orderId ? customerByOrderId.get(Number(s.orderId)) || '' : '',
      monthLabel: dateMonthLabel(s.shippedDate),
    }));
    const years = distinctYears(sorted, (s) => s.shippedDate);
    const filtered = filterByYearMonth(enriched, (s) => s.shippedDate, year, month).filter((s) => {
      if (!query) return true;
      const haystack = `${s.name} ${s.id} ${s.orderId || ''} ${s.customer}`.toLowerCase();
      return haystack.includes(query);
    });
    return {
      sorted, years, filtered, query, year, month, perPage, page,
      hasActiveFilter: !!(query || year || month),
    };
  }, [orders, shipped, searchParams]);

  function exportCsv() {
    const headers = ['#', 'ชื่องาน', 'ลูกค้า', 'วันที่จัดส่ง', 'เดือน', 'orderId'];
    const data = filtered.map((s) => [
      s.id, s.name || '', s.customer || '',
      displayDate(s.shippedDate), s.monthLabel, s.orderId || '',
    ]);
    const csv = buildCsv(headers, data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`shipped-${stamp}.csv`, csv);
  }

  return (
    <>
      <FilterForm query={query} year={year} month={month} years={years} hasActiveFilter={hasActiveFilter} />

      <div className="text-xs text-stone-500 tabular-nums">
        {filtered.length}/{sorted.length} รายการ
      </div>

      <button
        type="button"
        onClick={exportCsv}
        disabled={filtered.length === 0}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
      >
        <IconDownload size={13} />
        Export CSV ({filtered.length})
      </button>

      {filtered.length === 0 ? (
        <EmptyState filtered={hasActiveFilter} />
      ) : (
        (() => {
          const safePage = clampPage(page, filtered.length, perPage);
          const visible = paginate(filtered, safePage, perPage);
          return (
            <>
              <PageSizeBar total={filtered.length} perPage={perPage} shown={visible.length} />
              <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-14">#</th>
                      <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
                      <th className="text-left px-3 py-2 font-medium">ลูกค้า</th>
                      <th className="text-right px-3 py-2 font-medium whitespace-nowrap">วันที่จัดส่ง</th>
                      <th className="text-left px-3 py-2 font-medium whitespace-nowrap">เดือน</th>
                      <th className="text-left px-3 py-2 font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {visible.map((s) => (
                      <tr key={s.id} className="hover:bg-emerald-50/30">
                        <td className="px-3 py-2 tabular-nums text-stone-500">#{s.id}</td>
                        <td className="px-3 py-2 font-medium text-stone-900">{s.name}</td>
                        <td className="px-3 py-2 text-stone-600">{s.customer || '—'}</td>
                        <td className="px-3 py-2 text-right text-stone-700 tabular-nums whitespace-nowrap">
                          {displayDate(s.shippedDate)}
                        </td>
                        <td className="px-3 py-2 text-stone-500 whitespace-nowrap">{s.monthLabel}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            จัดส่งแล้ว
                          </span>
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
    <form action="/shipped" className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-72">
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="ค้นชื่องาน / ลูกค้า / id..."
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
        <a href="/shipped" className="text-xs text-stone-500 hover:text-stone-700 underline">
          ล้างตัวกรอง
        </a>
      )}
    </form>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconTruck size={36} />
      </div>
      <p className="text-sm text-stone-500">
        {filtered ? 'ไม่พบงานที่ตรงตามตัวกรอง' : 'ยังไม่มีงานที่จัดส่งแล้ว'}
      </p>
    </div>
  );
}
