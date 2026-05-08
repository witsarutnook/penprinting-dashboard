/** Pure server-safe helpers for the page-size selector — kept in a
 *  non-'use client' module so server pages (`/orders`, `/shipped`,
 *  `/cancelled`) can import `resolvePerPage` without pulling the whole
 *  client component bundle. The visual <PageSizeBar /> stays in
 *  components/page-size-bar.tsx as a client component. */

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Resolve a `?per=` param to a safe integer. Falls back to the default
 *  when the value isn't in the allowlist. Server-side. */
export function resolvePerPage(raw: string | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/** Resolve a `?page=` param to a 1-based positive integer. Defaults to 1
 *  for missing/invalid values. List pages should additionally clamp the
 *  result against `Math.ceil(total / perPage)` after applying their
 *  filters — this helper only validates the URL shape. */
export function resolvePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/** Slice a filtered list to the rows visible on `page` (1-based) at
 *  `perPage` per page. Caller can hand the result straight to .map().
 *  Out-of-range pages return an empty array — pair with `clampPage` so
 *  users land on the last valid page after filters narrow the list. */
export function paginate<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  if (start < 0 || start >= items.length) return [];
  return items.slice(start, start + perPage);
}

/** Number of pages required to show `total` items at `perPage` each.
 *  Always returns at least 1 (so the "หน้า 1 / 1" label renders even
 *  when the filtered list is empty). */
export function totalPages(total: number, perPage: number): number {
  if (total <= 0) return 1;
  return Math.ceil(total / perPage);
}

/** Clamp a 1-based page number to the valid range for the current
 *  total. Used after applying filters — without this, narrowing a
 *  filter while sitting on page 5 would render a blank table. */
export function clampPage(page: number, total: number, perPage: number): number {
  const last = totalPages(total, perPage);
  if (page < 1) return 1;
  if (page > last) return last;
  return page;
}
