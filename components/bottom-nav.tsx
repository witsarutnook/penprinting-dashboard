'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { getBottomNavItems } from './nav-config';
import { useIsActive } from './sidebar';

interface BottomNavProps {
  role: string;
}

/** Mobile-only bottom tab bar (`md:hidden`). Up to 5 highest-priority items
 *  from nav-config, filtered by role. Pinned to bottom with safe-area
 *  padding for iPhone notch/home-bar. */
export function BottomNav({ role }: BottomNavProps) {
  const items = getBottomNavItems(role);
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-30"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <li key={`${it.href}|${it.label}`}>
            <BottomNavLink href={it.href} label={it.label} icon={it.icon} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BottomNavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const isActive = useIsActive(href);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (isActive) return;
    e.preventDefault();
    startTransition(() => router.push(href));
  }

  return (
    <Link
      href={href}
      onClick={handleClick}
      aria-busy={isPending}
      className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] transition-colors ${
        isActive
          ? 'text-sky-700 font-semibold'
          : isPending
            ? 'text-stone-700 bg-stone-100'
            : 'text-stone-500'
      }`}
    >
      <Icon size={20} className="flex-shrink-0" />
      <span className="truncate max-w-full px-1">{label}</span>
    </Link>
  );
}
