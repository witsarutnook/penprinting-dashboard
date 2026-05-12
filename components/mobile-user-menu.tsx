'use client';

import { useEffect, useRef, useState } from 'react';
import { IconUser, IconLogOut, IconX, IconExternalLink } from '@/lib/icons';

interface MobileUserMenuProps {
  user: string;
  role: string;
}

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v2';

const ROLE_LABEL: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  sales: 'ฝ่ายขาย',
  staff: 'พนักงาน',
};

/** Mobile-only floating user menu (`md:hidden`). Sits top-right above
 *  every page header so logout is always one tap away — desktop has
 *  this in the sidebar, but on mobile the sidebar is hidden, leaving
 *  no visible logout. Tapping opens a bottom sheet with name / role /
 *  logout / quick links.
 *
 *  Floating button rather than a fixed top bar so we don't clash with
 *  per-page sticky headers (board, orders, etc. each have their own).
 *  Z-index 40 — above page headers (z-20) and bottom-nav (z-30) but
 *  below confirm/toast (z-50). */
export function MobileUserMenu({ user, role }: MobileUserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-2 right-2 z-40 w-11 h-11 rounded-full bg-white border border-stone-200 shadow-sm flex items-center justify-center text-stone-700 hover:bg-stone-50 active:bg-stone-100"
        aria-label={`${user} — เมนูผู้ใช้`}
        aria-expanded={open}
      >
        <IconUser size={18} />
      </button>
      {open && <UserMenuSheet user={user} role={role} onClose={() => setOpen(false)} />}
    </>
  );
}

function UserMenuSheet({
  user,
  role,
  onClose,
}: {
  user: string;
  role: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [busyLogout, setBusyLogout] = useState(false);

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

  async function handleLogout() {
    setBusyLogout(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  const roleLabel = ROLE_LABEL[role] || role;

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
        className="bg-white rounded-t-2xl shadow-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 12px)' }}
      >
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-stone-900">บัญชีผู้ใช้</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100"
            aria-label="ปิด"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* User card */}
        <div className="px-5 py-4 flex items-center gap-3 border-b border-stone-100">
          <div className="w-12 h-12 rounded-full bg-sky-50 text-sky-700 flex items-center justify-center flex-shrink-0">
            <IconUser size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-stone-900 truncate">{user}</div>
            <div className="text-xs text-stone-500 mt-0.5">
              {roleLabel}
              <span className="mx-1.5 text-stone-300">·</span>
              <span className="text-[10px] uppercase tracking-wider text-stone-400">{role}</span>
            </div>
          </div>
        </div>

        {/* Quick links */}
        <div className="px-2 py-2 border-b border-stone-100">
          <a
            href="/track"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm text-stone-700 hover:bg-stone-50 active:bg-stone-100"
          >
            <IconExternalLink size={18} className="flex-shrink-0 text-stone-500" />
            <span className="flex-1">ดูหน้าตรวจสถานะ (มุมมองลูกค้า)</span>
          </a>
        </div>

        {/* Logout */}
        <div className="px-5 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-stone-400 tabular-nums">{APP_VERSION}</span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={busyLogout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm font-medium hover:bg-red-100 active:bg-red-200 disabled:opacity-50 transition-colors"
          >
            <IconLogOut size={16} />
            {busyLogout ? 'กำลังออก...' : 'ออกจากระบบ'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
