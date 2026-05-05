'use client';

import { useState } from 'react';

export function LogoutButton() {
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
      onClick={onClick}
      disabled={busy}
      className="text-stone-500 hover:text-stone-900 disabled:opacity-50"
      title="ออกจากระบบ"
    >
      {busy ? '...' : '🚪 ออก'}
    </button>
  );
}
