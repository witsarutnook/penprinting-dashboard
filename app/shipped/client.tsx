'use client';

import { buildCsv, downloadCsv } from '@/lib/list-helpers';
import { displayDate } from '@/lib/jobs';
import { IconDownload } from '@/lib/icons';

interface ShippedRow {
  id: number;
  name: string;
  customer: string;
  shippedDate: string;
  monthLabel: string;
  orderId: number | null;
}

export function ShippedClient({ rows }: { rows: ShippedRow[] }) {
  function exportCsv() {
    const headers = ['#', 'ชื่องาน', 'ลูกค้า', 'วันที่จัดส่ง', 'เดือน', 'orderId'];
    const data = rows.map((s) => [
      s.id,
      s.name || '',
      s.customer || '',
      displayDate(s.shippedDate),
      s.monthLabel,
      s.orderId || '',
    ]);
    const csv = buildCsv(headers, data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`shipped-${stamp}.csv`, csv);
  }
  return (
    <button
      type="button"
      onClick={exportCsv}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200 disabled:opacity-50"
    >
      <IconDownload size={13} />
      Export CSV ({rows.length})
    </button>
  );
}
