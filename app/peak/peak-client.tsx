'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type TestResult =
  | { ok: true; latestCode: string | null; ms: number }
  | { ok: false; error: string };

export function PeakClient({ connected }: { connected: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function runTest() {
    setBusy(true);
    setFailed(false);
    setResult(null);
    try {
      const res = await fetch('/api/admin/peak/test', { method: 'POST' });
      setResult((await res.json()) as TestResult);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <a
          href="/api/admin/peak/connect"
          className="inline-flex items-center rounded-md bg-[#c8553d] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          เชื่อมต่อ Peak
        </a>
        <button
          type="button"
          onClick={runTest}
          disabled={busy || !connected}
          className="inline-flex items-center rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-400 disabled:opacity-50"
        >
          {busy ? 'กำลังทดสอบ…' : 'ทดสอบ'}
        </button>
      </div>
      {failed && <p className="text-sm text-red-700">ทดสอบไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      {result && (
        <pre className="rounded-md bg-stone-50 border border-stone-200 p-3 text-xs text-stone-700 overflow-x-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}

export interface StaffRow {
  lineUserId: string;
  orderer: string;
  displayName: string | null;
  date: string;
}

export function StaffList({ rows }: { rows: StaffRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function remove(r: StaffRow) {
    const label = r.displayName || r.orderer;
    if (!window.confirm(`ลบการผูก ${label} (${r.orderer}) ออกจากรายชื่อ?`)) return;
    setBusyId(r.lineUserId);
    setError(false);
    try {
      const res = await fetch('/api/admin/peak/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineUserId: r.lineUserId }),
      });
      if (!res.ok) throw new Error('failed');
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <p className="text-sm text-stone-500">ยังไม่มีผู้สั่งงานที่ผูกไว้</p>;
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700">ลบไม่สำเร็จ ลองใหม่อีกครั้ง</p>}
      <ul className="rounded-md border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
        {rows.map((r) => (
          <li key={r.lineUserId} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-stone-900 break-words">
                {r.orderer}
                {r.displayName ? <span className="text-stone-500"> · {r.displayName}</span> : null}
              </div>
              <div className="text-xs text-stone-400">{r.date}</div>
            </div>
            <button
              type="button"
              onClick={() => remove(r)}
              disabled={busyId === r.lineUserId}
              className="rounded-md border border-stone-300 bg-white px-3 py-1 text-xs text-red-700 hover:border-red-300 disabled:opacity-50"
            >
              {busyId === r.lineUserId ? 'กำลังลบ…' : 'ลบ'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
