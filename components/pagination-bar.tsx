'use client';

import { useId } from 'react';
import { totalPages as computeTotalPages } from '@/lib/page-size';
import { IconArrowLeft, IconArrowRight } from '@/lib/icons';

/** Pagination control rendered below list pages (/orders, /shipped,
 *  /cancelled). Reads/writes the `?page=` URL param via a hard reload
 *  so the server picks up the new offset cleanly — same pattern as
 *  PageSizeBar. Hides itself when the filtered list fits in one page.
 *
 *  Why a hard reload instead of `router.push`: list pages already do
 *  server-side filtering + slicing inside `page.tsx`. A client-side
 *  navigation would re-fetch the same SSR payload anyway and on slow
 *  connections the URL change feels disconnected from the table
 *  refresh. `window.location.assign` keeps URL ↔ visible state in
 *  lockstep without a separate loading state to reason about. */
export function PaginationBar({
  total,
  perPage,
  page,
  className = '',
}: {
  total: number;
  perPage: number;
  page: number;
  className?: string;
}) {
  const labelId = useId();
  const last = computeTotalPages(total, perPage);
  if (last <= 1) return null;

  function goto(p: number) {
    const url = new URL(window.location.href);
    if (p <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(p));
    window.location.assign(url.toString());
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= last;

  return (
    <nav
      aria-labelledby={labelId}
      className={`flex items-center justify-between gap-3 px-1 text-sm ${className}`}
    >
      <span id={labelId} className="sr-only">การเลื่อนหน้า</span>
      <button
        type="button"
        onClick={() => goto(page - 1)}
        disabled={prevDisabled}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="หน้าก่อนหน้า"
      >
        <IconArrowLeft size={14} />
        ก่อนหน้า
      </button>
      <span className="text-stone-500 tabular-nums">
        หน้า <b className="text-stone-900">{page}</b> / {last}
        <span className="hidden sm:inline text-stone-400 ml-2">
          ({(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} จาก {total})
        </span>
      </span>
      <button
        type="button"
        onClick={() => goto(page + 1)}
        disabled={nextDisabled}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="หน้าถัดไป"
      >
        ถัดไป
        <IconArrowRight size={14} />
      </button>
    </nav>
  );
}
