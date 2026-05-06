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
