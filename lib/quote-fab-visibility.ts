// lib/quote-fab-visibility.ts
// Pure mount decision for the floating Quote FAB. Bulk-mode mobile-hide is a
// responsive CSS concern handled in the component (a className), NOT here.

const FAB_ROLES = ['admin', 'sales'] as const;

export function shouldShowFab(role: string, pathname: string): boolean {
  if (!FAB_ROLES.includes(role as (typeof FAB_ROLES)[number])) return false;
  if (pathname === '/quote-assistant') return false;
  return true;
}
