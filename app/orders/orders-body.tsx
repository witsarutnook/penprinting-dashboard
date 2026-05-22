import Link from 'next/link';
import { IconFileText, IconPlus } from '@/lib/icons';
import { OrdersClient } from './client';
import { OrdersTable } from './orders-table';
import { DataAuditButton } from './data-audit-modal';
import type { OrdersListResult } from '@/lib/orders-list';

/**
 * Shared /orders body — the toolbar (export CSV / data-audit / count /
 * new-order) plus the table / empty-state / error panel. Rendered by both
 * the server `OrdersData` and the delta-fetch `OrdersListClient`, so it's a
 * plain shared component — no 'use client', no hooks.
 */
export function OrdersBody({
  result,
  role,
  perPage,
  page,
  hasActiveFilter,
  errorMessage,
}: {
  result: OrdersListResult;
  role: 'admin' | 'sales' | 'staff';
  perPage: number;
  page: number;
  /** Whether any filter (query/status/date) is active — drives the
   *  empty-state copy ("ไม่พบ...ตามเงื่อนไข" vs "ยังไม่มี..."). */
  hasActiveFilter: boolean;
  errorMessage: string | null;
}) {
  const { rows, totalCount, orphans, duplicates } = result;
  return (
    <>
      {/* Toolbar — Export CSV + ตรวจสอบข้อมูล + count + สั่งงานใหม่ */}
      <div className="flex flex-wrap items-center gap-2">
        <OrdersClient rows={rows} />
        <DataAuditButton orphans={orphans} duplicates={duplicates} isAdmin={role === 'admin'} />
        <span className="text-xs text-stone-500 tabular-nums">
          {rows.length}/{totalCount} ใบ
        </span>
        {(role === 'admin' || role === 'sales') && (
          <Link
            href="/orders/new"
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark"
          >
            <IconPlus size={13} />
            สั่งงานใหม่
          </Link>
        )}
      </div>

      {errorMessage ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
          <p className="text-sm text-amber-800 mt-2 font-mono">{errorMessage}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-stone-200 p-10 text-center">
          <div className="flex justify-center mb-2 text-stone-300">
            <IconFileText size={36} />
          </div>
          <p className="text-sm text-stone-500">
            {hasActiveFilter ? 'ไม่พบใบสั่งงานตามเงื่อนไข' : 'ยังไม่มีใบสั่งงาน'}
          </p>
        </div>
      ) : (
        <OrdersTable rows={rows} role={role} perPage={perPage} page={page} />
      )}
    </>
  );
}
