'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { broadcastWrite } from '@/lib/auto-sync';
import { buildCsv, downloadCsv } from '@/lib/list-helpers';
import { displayDateTime } from '@/lib/jobs';
import { DEPT_LABELS, type Dept } from '@/lib/board';
import {
  IconRefreshCw, IconDownload, IconAlertCircle,
} from '@/lib/icons';
import type { Cancelled } from '@/lib/types';

/** Toolbar above the cancelled table — Export CSV. */
export function CancelledClient({ rows }: { rows: Cancelled[] }) {
  function exportCsv() {
    const headers = ['#', 'ชื่องาน', 'แผนก', 'ผู้รับงาน', 'ยกเลิกโดย', 'วันที่ยกเลิก', 'เหตุผล', 'orderId'];
    const data = rows.map((c) => [
      c.id,
      c.name || '',
      DEPT_LABELS[c.dept as Dept] || c.dept || '',
      c.staff || '',
      c.cancelledBy || '',
      displayDateTime(c.cancelledAt),
      c.reason || '',
      c.orderId || '',
    ]);
    const csv = buildCsv(headers, data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`cancelled-${stamp}.csv`, csv);
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={exportCsv}
        disabled={rows.length === 0}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
      >
        <IconDownload size={13} />
        Export CSV ({rows.length})
      </button>
    </div>
  );
}

/** Per-row restore button — admin only, posts to /api/jobs/restore. */
export function RestoreButton({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (!confirm(`กู้คืนงาน "${name}" ?\n\nงานจะกลับเข้า Kanban ในแผนกเดิม สถานะ "รอดำเนินการ"`)) return;
    setError(null);
    setBusy(true);
    const res = await fetch('/api/jobs/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return;
    }
    broadcastWrite('/api/jobs/restore');
    router.refresh();
  }

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-red-700" title={error}>
        <IconAlertCircle size={12} />
        ผิดพลาด
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={restore}
      disabled={busy}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-[11px] font-medium disabled:opacity-50"
    >
      <IconRefreshCw size={11} />
      {busy ? 'กำลังกู้คืน...' : 'กู้คืน'}
    </button>
  );
}
