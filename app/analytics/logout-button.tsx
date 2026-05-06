'use client';

import { useState } from 'react';
import { IconLogOut } from '@/lib/icons';
import { broadcastWrite } from '@/lib/auto-sync';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      // Tell other tabs to refresh — without this, sidebar in tab B keeps
      // showing the logged-in username until the next 15s auto-sync tick
      // or the user clicks something.
      broadcastWrite('/api/auth/logout');
    } finally {
      window.location.href = '/login';
    }
  }
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="text-stone-500 hover:text-stone-900 disabled:opacity-50 inline-flex items-center gap-1"
      title="ออกจากระบบ"
    >
      <IconLogOut size={14} />
      {busy ? '...' : 'ออก'}
    </button>
  );
}
