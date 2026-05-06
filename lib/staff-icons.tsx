/**
 * Per-staff icon + color theming. Mirrors the WP screenshot's icon-square
 * pattern at column headers — each staff/machine gets its own
 * iconography + accent palette.
 */

import type { ComponentType, SVGProps } from 'react';
import {
  IconPencil,
  IconPrinter,
  IconInkjet,
  IconBuilding,
  IconScissors,
  IconBook,
  IconTruck,
} from './icons';
import type { Dept } from './board';

export interface StaffIconTheme {
  Icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** Tailwind classes for the 40-44px square wrapper (bg) + icon color (text). */
  bgClass: string;
  iconClass: string;
}

const DEFAULT_THEME: StaffIconTheme = {
  Icon: IconPencil,
  bgClass: 'bg-stone-100',
  iconClass: 'text-stone-600',
};

/** Map STAFF.id → {Icon, bg/icon classes}. Falls back to pencil-on-stone
 *  if missing — keeps the layout intact when WP adds a new staff before
 *  v2 is updated. */
const STAFF_THEME: Record<Dept, Record<string, StaffIconTheme>> = {
  graphic: {
    pook: { Icon: IconPencil, bgClass: 'bg-amber-100', iconClass: 'text-amber-700' },
    perl: { Icon: IconPencil, bgClass: 'bg-amber-100', iconClass: 'text-amber-700' },
    aed: { Icon: IconPencil, bgClass: 'bg-amber-100', iconClass: 'text-amber-700' },
  },
  print: {
    sm74: { Icon: IconPrinter, bgClass: 'bg-sky-100', iconClass: 'text-sky-700' },
    mo5: { Icon: IconPrinter, bgClass: 'bg-sky-100', iconClass: 'text-sky-700' },
    mo: { Icon: IconPrinter, bgClass: 'bg-sky-100', iconClass: 'text-sky-700' },
    hamada: { Icon: IconPrinter, bgClass: 'bg-sky-100', iconClass: 'text-sky-700' },
    inkjet: { Icon: IconInkjet, bgClass: 'bg-emerald-100', iconClass: 'text-emerald-700' },
    outsource: { Icon: IconBuilding, bgClass: 'bg-violet-100', iconClass: 'text-violet-700' },
  },
  post: {
    cut: { Icon: IconScissors, bgClass: 'bg-stone-200', iconClass: 'text-stone-700' },
    bind: { Icon: IconBook, bgClass: 'bg-stone-200', iconClass: 'text-stone-700' },
    diecut_in: { Icon: IconScissors, bgClass: 'bg-amber-200/60', iconClass: 'text-amber-900' },
    diecut_out: { Icon: IconBuilding, bgClass: 'bg-violet-100', iconClass: 'text-violet-700' },
    ship: { Icon: IconTruck, bgClass: 'bg-amber-200/60', iconClass: 'text-amber-900' },
  },
};

export function getStaffTheme(dept: string, staffId: string): StaffIconTheme {
  return STAFF_THEME[dept as Dept]?.[staffId] || DEFAULT_THEME;
}
