'use client';

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Resolve a `?per=` param to a safe integer. Falls back to default if
 *  the value isn't in the allowlist. Use server-side. */
export function resolvePerPage(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/** Page-size dropdown for /orders, /shipped, /cancelled. Replaces `?per=`
 *  in the current URL on change — no client routing, just a hard reload
 *  so the server picks up the new value cleanly. */
export function PageSizeBar({
  total, perPage, shown, label = 'แสดงต่อหน้า',
}: {
  total: number;
  perPage: number;
  shown: number;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-stone-500 px-1">
      <span className="tabular-nums">
        แสดง <b className="text-stone-700">{shown}</b> จาก{' '}
        <b className="text-stone-700">{total}</b> รายการ
      </span>
      <label className="flex items-center gap-2">
        <span>{label}:</span>
        <select
          defaultValue={perPage}
          onChange={(e) => {
            const url = new URL(window.location.href);
            url.searchParams.set('per', e.target.value);
            window.location.assign(url.toString());
          }}
          className="px-2 py-1 border border-stone-200 rounded-md text-xs bg-white tabular-nums focus:outline-none focus:border-accent"
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
