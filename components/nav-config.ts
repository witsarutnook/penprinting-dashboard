/**
 * Shared nav config for sidebar (desktop) + bottom-nav (mobile).
 * Single source of truth so adding a section updates both at once.
 *
 * Mirrors WP sidebar groups: "การผลิต" (production) + "รายการ" (lists).
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
      { href: '/board?dept=graphic', label: 'กราฟฟิก', icon: IconPencil },
      { href: '/board?dept=print', label: 'พิมพ์', icon: IconPrinter },
      { href: '/board?dept=post', label: 'หลังพิมพ์ / จัดส่ง', icon: IconScissors, mobile: true },
      { href: '/calendar', label: 'ปฏิทิน', icon: IconCalendar, adminOnly: true },
    ],
  },
  {
    label: 'รายการ',
    items: [
      { href: '/analytics', label: 'รายงาน', icon: IconTrendingUp, adminOnly: true },
      { href: '/orders', label: 'รายการใบสั่งงาน', icon: IconClock, mobile: true, adminOrSalesOnly: true },
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

/** Flat list of mobile-priority items, capped at 5. Slicing happens AFTER
 *  the role filter — staff who can't see the "สั่งงาน" item slot the next
 *  mobile-flagged item in (e.g. กราฟฟิก) instead of getting a 4-item bar. */
export function getBottomNavItems(role: string | undefined): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((it) => it.mobile && canSee(it, role))
    .slice(0, 5);
}

// Re-export for components that need explicit icon refs
export { IconCheck, IconX };
