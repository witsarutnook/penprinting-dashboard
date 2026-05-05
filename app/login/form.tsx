'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/analytics';

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `เข้าระบบไม่สำเร็จ (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      // Hard navigate so middleware sees the new cookie
      window.location.href = next;
    } catch {
      setError('เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้ง');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-stone-600 mb-1.5">
          รหัสผ่าน
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          className="w-full px-4 py-2.5 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !password}
        className="w-full px-4 py-2.5 bg-accent text-white rounded-lg font-medium hover:bg-accent-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'กำลังเข้าระบบ...' : 'เข้าสู่ระบบ'}
      </button>

      <p className="text-xs text-stone-400 text-center pt-2">
        ใช้รหัสผ่านเดียวกันกับ WordPress dashboard เดิม
      </p>
    </form>
  );
}
