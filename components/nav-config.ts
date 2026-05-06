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
  IconArrowRight,
  IconRefreshCw,
  IconCheck,
  IconX,
  IconUsers,
} from '@/lib/icons';

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export interface NavItem {
  href: string;
  label: string;
  icon: IconComponent;
  /** Restrict to admin role (matches WP ROLE_REQUIREMENTS). */
  adminOnly?: boolean;
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
      { href: '/board', label: 'สั่งงาน', icon: IconFileText, mobile: true },
      { href: '/board?dept=graphic', label: 'กราฟฟิก', icon: IconPencil },
      { href: '/board?dept=print', label: 'พิมพ์', icon: IconArrowRight },
      { href: '/board?dept=post', label: 'หลังพิมพ์ / จัดส่ง', icon: IconUsers },
      { href: '/calendar', label: 'ปฏิทิน', icon: IconRefreshCw, adminOnly: true, mobile: true },
    ],
  },
  {
    label: 'รายการ',
    items: [
      { href: '/analytics', label: 'รายงาน', icon: IconTrendingUp, mobile: true },
      { href: '/archive', label: 'ค้นข้อมูลเก่า', icon: IconFolderOpen, adminOnly: true, mobile: true },
      // Future: { href: '/orders', ... }, { href: '/shipped', ... }, { href: '/cancelled', ... }
    ],
  },
];

/** Visible items for a given role — applied AFTER user role check passes
 *  middleware. Used by sidebar + bottom-nav to filter their lists. */
export function getNavGroups(role: string | undefined): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => !it.adminOnly || role === 'admin'),
  })).filter((g) => g.items.length > 0);
}

/** Flat list of mobile-priority items, capped at 5. */
export function getBottomNavItems(role: string | undefined): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((it) => it.mobile && (!it.adminOnly || role === 'admin'))
    .slice(0, 5);
}

// Re-export for components that need explicit icon refs
export { IconCheck, IconX };
