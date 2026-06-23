/**
 * Shared nav config for sidebar (desktop) + bottom-nav (mobile).
 * Single source of truth so adding a section updates both at once.
 *
 * Groups: "การผลิต" (production) + "AI Quote" (quoting assistant) + "รายการ" (lists).
 */

import type { ComponentType, SVGProps } from 'react';
import {
  IconFileText,
  IconPencil,
  IconTrendingUp,
  IconFolderOpen,
  IconCalendar,
  IconCheck,
  IconX,
  IconPrinter,
  IconScissors,
  IconClock,
  IconTruck,
  IconAlertCircle,
  IconSparkles,
  IconClipboardList,
} from '@/lib/icons';

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  /** Restrict to admin role (matches WP ROLE_REQUIREMENTS). */
  adminOnly?: boolean;
  /** Restrict to admin + sales (e.g. /orders/new — page redirects staff
   *  away anyway, so don't show the link to confuse them). */
  adminOrSalesOnly?: boolean;
  /** Show in mobile bottom-nav (≤5 highest-priority items). */
  mobile?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'การผลิต',
    items: [
      { href: '/orders/new', label: 'สั่งงาน', icon: IconFileText, mobile: true, adminOrSalesOnly: true },
      { href: '/board?dept=graphic', label: 'กราฟฟิก', icon: IconPencil, mobile: true },
      { href: '/board?dept=print', label: 'พิมพ์', icon: IconPrinter, mobile: true },
      { href: '/board?dept=post', label: 'หลังพิมพ์ / จัดส่ง', icon: IconScissors, mobile: true },
      { href: '/calendar', label: 'ปฏิทิน', icon: IconCalendar, adminOnly: true },
    ],
  },
  {
    label: 'AI Quote',
    items: [
      { href: '/quote-assistant', label: 'ผู้ช่วยตีราคา (AI)', icon: IconSparkles, adminOrSalesOnly: true },
      { href: '/quote-leads', label: 'Lead ใบเสนอราคา', icon: IconClipboardList, adminOrSalesOnly: true },
    ],
  },
  {
    label: 'รายการ',
    items: [
      { href: '/analytics', label: 'รายงาน', icon: IconTrendingUp, adminOnly: true },
      { href: '/orders', label: 'รายการใบสั่งงาน', icon: IconClock, adminOrSalesOnly: true },
      { href: '/shipped', label: 'จัดส่งแล้ว', icon: IconTruck },
      { href: '/cancelled', label: 'รายการยกเลิก', icon: IconAlertCircle, adminOnly: true },
      { href: '/archive', label: 'ค้นข้อมูลเก่า', icon: IconFolderOpen, adminOnly: true },
    ],
  },
];

/** Whether this role can see this nav item.
 *  Layered: adminOnly is strictest, then adminOrSalesOnly, then everyone.
 *  Server-side page redirects act as the final guard regardless of nav. */
function canSee(item: NavItem, role: string | undefined): boolean {
  if (item.adminOnly) return role === 'admin';
  if (item.adminOrSalesOnly) return role === 'admin' || role === 'sales';
  return true;
}

/** Visible items for a given role — applied AFTER user role check passes
 *  middleware. Used by sidebar + bottom-nav to filter their lists. */
export function getNavGroups(role: string | undefined): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => canSee(it, role)),
  })).filter((g) => g.items.length > 0);
}

/** Flat list of mobile-priority items, capped at 4. Bottom nav reserves
 *  the 5th slot for the "More" hamburger that opens a sheet with the
 *  remaining nav items. Capped at 4 (not 5) so we never displace the
 *  hamburger — keeps the "more" affordance reachable from every state.
 *  For staff (no สั่งงาน): 3 dept items + hamburger = 4 slots total. */
export function getBottomNavItems(role: string | undefined): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((it) => it.mobile && canSee(it, role))
    .slice(0, 4);
}

/** Items NOT shown in the bottom-nav primary row — surfaced via the
 *  hamburger sheet on mobile. Returns the role-visible nav GROUPS with
 *  bottom-nav items stripped, so the sheet can preserve group headings. */
export function getMoreMenuGroups(role: string | undefined): NavGroup[] {
  const inBottom = new Set(getBottomNavItems(role).map((it) => `${it.href}|${it.label}`));
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => canSee(it, role) && !inBottom.has(`${it.href}|${it.label}`)),
  })).filter((g) => g.items.length > 0);
}

// Re-export for components that need explicit icon refs
export { IconCheck, IconX };
