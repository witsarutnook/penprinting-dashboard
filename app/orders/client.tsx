'use client';

import { buildCsv, downloadCsv } from '@/lib/list-helpers';
import { displayDate } from '@/lib/jobs';
import { IconDownload } from '@/lib/icons';

interface OrderRow {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  orderStatusLabel: string;
  step: string;
  jobUrgencyLabel: string;
}

export function OrdersClient({ rows }: { rows: OrderRow[] }) {
  function exportCsv() {
    const headers = ['#', 'เลขที่ใบสั่ง', 'ชื่องาน', 'ลูกค้า', 'วันที่รับ', 'กำหนดส่ง', 'สถานะใบสั่ง', 'ขั้นตอนปัจจุบัน', 'สถานะงาน'];
    const data = rows.map((o, idx) => [
      idx + 1,
      o.id,
      o.name || '',
      o.customer || '',
      displayDate(o.dateIn),
      displayDate(o.dateDue),
      o.orderStatusLabel,
      o.step,
      o.jobUrgencyLabel,
    ]);
    const csv = buildCsv(headers, data);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`orders-${stamp}.csv`, csv);
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
