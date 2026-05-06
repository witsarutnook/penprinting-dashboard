'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { getNavGroups, type NavItem } from './nav-config';
import { IconLogOut } from '@/lib/icons';

interface SidebarProps {
  user: string;
  role: string;
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v2';

/** Desktop sidebar (`hidden md:flex`). Mirrors WP sidebar from screenshot:
 *  logo top → grouped nav → user info + logout at bottom. */
export function Sidebar({ user, role }: SidebarProps) {
  const groups = getNavGroups(role);
  return (
    <aside className="hidden md:flex fixed inset-y-0 left-0 w-[220px] bg-white border-r border-stone-100 flex-col z-30">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-stone-100">
        <Link href="/" className="block" aria-label="Penprinting Home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/penprinting-logo.svg"
            alt="Penprinting"
            width={140}
            height={66}
            className="h-auto w-[140px]"
          />
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-grow overflow-y-auto py-3">
        {groups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-5 pb-1.5 text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
              {group.label}
            </div>
            <ul>
              {group.items.map((it) => (
                <NavLink key={`${it.href}|${it.label}`} item={it} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: user + logout + version */}
      <div className="border-t border-stone-100 px-4 py-3 space-y-2">
        <div className="text-xs">
          <div className="text-stone-700 font-medium truncate">{user}</div>
          <div className="text-[10px] text-stone-400 uppercase tracking-wider">{role}</div>
        </div>
        <LogoutButton />
        <div className="text-[10px] text-stone-300 tabular-nums pt-1">{APP_VERSION}</div>
      </div>
    </aside>
  );
}

function NavLink({ item }: { item: NavItem }) {
  const isActive = useIsActive(item.href);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        className={`flex items-center gap-2.5 px-5 py-2 text-sm transition-colors border-l-2 ${
          isActive
            ? 'bg-sky-50 text-sky-800 font-medium border-l-sky-500'
            : 'text-stone-600 hover:bg-stone-50 border-l-transparent'
        }`}
      >
        <Icon size={16} className="flex-shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

/** Active-state rule shared with bottom-nav:
 *  - href without `?` → exact path match AND no `dept` query
 *  - href with `?dept=X` → path match AND searchParams.dept === X */
export function useIsActive(href: string): boolean {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [hrefPath, hrefQuery] = href.split('?');
  if (pathname !== hrefPath) return false;
  const hrefDept = hrefQuery ? new URLSearchParams(hrefQuery).get('dept') : null;
  const currentDept = searchParams.get('dept');
  if (hrefDept) return currentDept === hrefDept;
  return !currentDept;
}

function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full inline-flex items-center gap-2 px-2 py-1.5 rounded text-xs text-stone-500 hover:text-stone-900 hover:bg-stone-50 disabled:opacity-50 transition-colors"
    >
      <IconLogOut size={14} />
      {busy ? 'กำลังออก...' : 'ออกจากระบบ'}
    </button>
  );
}
