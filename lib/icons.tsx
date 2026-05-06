/**
 * Outline SVG icon set for the dashboard. Style follows Lucide:
 *   - 24×24 viewBox, stroke="currentColor", strokeWidth=2,
 *     linecap=round, linejoin=round
 *   - Single-color, color inherits via currentColor
 *   - Default size 16px — pass `size` or className utility (w-4 h-4 etc).
 *
 * Replaces every emoji used as UI affordance across app/*. Per user
 * preference (2026-05-06): no emoji icons anywhere in the system.
 */

import type { SVGProps } from 'react';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

function makeIcon(paths: React.ReactNode, displayName: string) {
  function Icon({ size = 16, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

// ─── Actions ──────────────────────────────────────────────

export const IconPlus = makeIcon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
  'IconPlus',
);

export const IconCheck = makeIcon(
  <polyline points="20 6 9 17 4 12" />,
  'IconCheck',
);

export const IconX = makeIcon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
  'IconX',
);

export const IconPencil = makeIcon(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </>,
  'IconPencil',
);

export const IconTrash = makeIcon(
  <>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </>,
  'IconTrash',
);

export const IconAlertTriangle = makeIcon(
  <>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
  </>,
  'IconAlertTriangle',
);

export const IconAlertCircle = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none" />
  </>,
  'IconAlertCircle',
);

export const IconInfo = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none" />
  </>,
  'IconInfo',
);

// ─── Movement / Workflow ──────────────────────────────────

export const IconArrowRight = makeIcon(
  <>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </>,
  'IconArrowRight',
);

export const IconArrowLeft = makeIcon(
  <>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </>,
  'IconArrowLeft',
);

/** Forward — corner arrow (right-then-up), used for "ส่งต่อ". */
export const IconCornerUpRight = makeIcon(
  <>
    <polyline points="15 14 20 9 15 4" />
    <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
  </>,
  'IconCornerUpRight',
);

/** Refresh — circular arrow, used for "ย้าย" (reassign within dept). */
export const IconRefreshCw = makeIcon(
  <>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
    <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
  </>,
  'IconRefreshCw',
);

// ─── People / Customer ────────────────────────────────────

export const IconUser = makeIcon(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
  'IconUser',
);

export const IconUsers = makeIcon(
  <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
  'IconUsers',
);

export const IconLogOut = makeIcon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </>,
  'IconLogOut',
);

// ─── Documents / Storage ──────────────────────────────────

export const IconFileText = makeIcon(
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </>,
  'IconFileText',
);

export const IconFolder = makeIcon(
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  'IconFolder',
);

export const IconFolderOpen = makeIcon(
  <path d="M6 14l1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 2 2.4l-1.5 6a2 2 0 0 1-1.94 1.6H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />,
  'IconFolderOpen',
);

// ─── Charts / Stats ───────────────────────────────────────

export const IconTrendingUp = makeIcon(
  <>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </>,
  'IconTrendingUp',
);

export const IconTrophy = makeIcon(
  <>
    <line x1="6" y1="9" x2="6" y2="3" />
    <line x1="18" y1="9" x2="18" y2="3" />
    <path d="M6 9a6 6 0 0 0 12 0V3H6z" />
    <path d="M6 4H4a2 2 0 0 0 0 4h2" />
    <path d="M18 4h2a2 2 0 0 1 0 4h-2" />
    <line x1="9" y1="22" x2="15" y2="22" />
    <line x1="12" y1="15" x2="12" y2="22" />
  </>,
  'IconTrophy',
);

export const IconTarget = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </>,
  'IconTarget',
);

// ─── Status / Time ────────────────────────────────────────

export const IconCalendar = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </>,
  'IconCalendar',
);

export const IconClock = makeIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>,
  'IconClock',
);

export const IconBolt = makeIcon(
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  'IconBolt',
);

export const IconSearch = makeIcon(
  <>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>,
  'IconSearch',
);

// ─── Production stations ──────────────────────────────────

/** Scissors — cut / diecut stations. */
export const IconScissors = makeIcon(
  <>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </>,
  'IconScissors',
);

/** Book — binding station. */
export const IconBook = makeIcon(
  <>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </>,
  'IconBook',
);

/** Printer — offset/digital press machines. */
export const IconPrinter = makeIcon(
  <>
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </>,
  'IconPrinter',
);

/** Truck — shipping / รอจัดส่ง. */
export const IconTruck = makeIcon(
  <>
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </>,
  'IconTruck',
);

/** Building — vendor / outsource columns. */
export const IconBuilding = makeIcon(
  <>
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <line x1="8" y1="6" x2="8" y2="6" />
    <line x1="16" y1="6" x2="16" y2="6" />
    <line x1="8" y1="10" x2="8" y2="10" />
    <line x1="16" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="8" y2="14" />
    <line x1="16" y1="14" x2="16" y2="14" />
  </>,
  'IconBuilding',
);

/** Inkjet / digital — used for the inkjet station. */
export const IconInkjet = makeIcon(
  <>
    <rect x="4" y="3" width="16" height="14" rx="1" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="9" y1="12" x2="13" y2="12" />
  </>,
  'IconInkjet',
);

/** Squares (filter / multi-select). */
export const IconCheckSquare = makeIcon(
  <>
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
  </>,
  'IconCheckSquare',
);

export const IconSquare = makeIcon(
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />,
  'IconSquare',
);
