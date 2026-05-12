'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { getBottomNavItems, getMoreMenuGroups } from './nav-config';
import { useIsActive } from './sidebar';
import { IconMenu, IconX } from '@/lib/icons';

interface BottomNavProps {
  role: string;
}

/** Mobile-only bottom tab bar (`md:hidden`). Up to 4 highest-priority nav
 *  items + a "More" hamburger that opens a sheet with the rest. The
 *  hamburger is always present so the long-tail (calendar / analytics /
 *  shipped / archive / cancelled) is one tap away no matter the role.
 *  Pinned to bottom with safe-area padding for iPhone notch/home-bar. */
export function BottomNav({ role }: BottomNavProps) {
  const items = getBottomNavItems(role);
  const moreGroups = getMoreMenuGroups(role);
  const [moreOpen, setMoreOpen] = useState(false);
  const totalSlots = items.length + 1; // +1 for hamburger

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 z-30"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1fr))` }}>
          {items.map((it) => (
            <li key={`${it.href}|${it.label}`}>
              <BottomNavLink href={it.href} label={it.label} icon={it.icon} />
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] text-stone-500 w-full transition-colors hover:text-stone-700"
              aria-label="เมนูเพิ่มเติม"
              aria-expanded={moreOpen}
            >
              <IconMenu size={20} className="flex-shrink-0" />
              <span className="truncate max-w-full px-1">เมนู</span>
            </button>
          </li>
        </ul>
      </nav>
      {moreOpen && (
        <MoreMenuSheet
          groups={moreGroups}
          onClose={() => setMoreOpen(false)}
        />
      )}
    </>
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

/** Bottom-sheet style modal listing the secondary nav items. Closes on
 *  backdrop click, ESC, or any nav link tap. */
function MoreMenuSheet({
  groups,
  onClose,
}: {
  groups: ReturnType<typeof getMoreMenuGroups>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) { e.preventDefault(); onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      className="md:hidden m-0 w-full max-w-full p-0 bg-transparent backdrop:bg-black/40"
      style={{
        marginTop: 'auto',
        marginBottom: 0,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-h-[80vh] overflow-y-auto"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between sticky top-0 bg-white">
          <h2 className="text-base font-bold text-stone-900">เมนูเพิ่มเติม</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100"
            aria-label="ปิด"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="px-2 py-3">
          {groups.map((g) => (
            <div key={g.label} className="mb-3 last:mb-0">
              <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-stone-400 font-semibold">
                {g.label}
              </div>
              <ul>
                {g.items.map((it) => (
                  <SheetLink
                    key={`${it.href}|${it.label}`}
                    href={it.href}
                    label={it.label}
                    icon={it.icon}
                    onTap={onClose}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}

function SheetLink({
  href,
  label,
  icon: Icon,
  onTap,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  onTap: () => void;
}) {
  const isActive = useIsActive(href);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onTap();  // close sheet immediately for snappy feel
    if (isActive) return;
    startTransition(() => router.push(href));
  }

  return (
    <li>
      <Link
        href={href}
        onClick={handleClick}
        aria-busy={isPending}
        className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-sky-50 text-sky-800 font-medium'
            : 'text-stone-700 hover:bg-stone-50 active:bg-stone-100'
        }`}
      >
        <Icon size={18} className="flex-shrink-0" />
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
