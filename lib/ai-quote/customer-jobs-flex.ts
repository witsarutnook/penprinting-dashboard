// lib/ai-quote/customer-jobs-flex.ts
// LINE summary bubble listing a customer's active jobs (used when 2+ jobs;
// a single job is answered by the full buildOrderFlex card instead).
import type { CustomerJob } from '@/lib/customer-track';

const STATUS_LABEL: Record<string, string> = {
  graphic: 'กราฟิก',
  print: 'กำลังพิมพ์',
  post: 'หลังพิมพ์',
};

function badge(job: CustomerJob): { label: string; color: string } {
  if (job.kind === 'received') return { label: 'รับงานแล้ว', color: '#b45309' };
  if (job.awaitingShipment) return { label: 'พร้อมรับ', color: '#059669' };
  return { label: (job.currentDept && STATUS_LABEL[job.currentDept]) || 'กำลังดำเนินการ', color: '#1d4ed8' };
}

function daysHint(job: CustomerJob): string {
  if (job.daysLeft == null) return '';
  if (job.daysLeft < 0) return `เลยกำหนด ${Math.abs(job.daysLeft)} วัน`;
  if (job.daysLeft === 0) return 'กำหนดส่งวันนี้';
  return `เหลือ ${job.daysLeft} วัน`;
}

export function buildCustomerJobsFlex(jobs: CustomerJob[]): Record<string, unknown> {
  const rows = jobs.map((job) => {
    const b = badge(job);
    const hint = daysHint(job);
    const dueLine = job.dateDue && job.dateDue !== '-'
      ? [{ type: 'text', text: 'กำหนดส่ง ' + job.dateDue + (hint ? ' · ' + hint : ''), size: 'xxs', color: '#718096', margin: 'xs', wrap: true }]
      : [];
    return {
      type: 'box', layout: 'vertical', paddingAll: 'md', cornerRadius: '8px', backgroundColor: '#f5f5f0', margin: 'sm',
      contents: [
        { type: 'text', text: job.name, size: 'sm', weight: 'bold', color: '#1a202c', wrap: true },
        {
          type: 'box', layout: 'baseline', spacing: 'sm', margin: 'sm',
          contents: [
            { type: 'text', text: '#' + job.orderId, size: 'xs', color: '#a0aec0', flex: 0 },
            { type: 'text', text: b.label, size: 'xs', color: b.color, weight: 'bold', flex: 1, align: 'end' },
          ],
        },
        ...dueLine,
      ],
    };
  });

  return {
    type: 'flex',
    altText: `งานปัจจุบัน ${jobs.length} รายการ`,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: 'md', backgroundColor: '#1a202c',
        contents: [
          { type: 'text', text: 'PENPRINTING', color: '#ffffff', weight: 'bold', size: 'md', align: 'center' },
          { type: 'text', text: `งานปัจจุบัน ${jobs.length} รายการ`, color: '#a0aec0', size: 'xxs', align: 'center', margin: 'xs' },
        ],
      },
      body: { type: 'box', layout: 'vertical', paddingAll: 'lg', backgroundColor: '#ffffff', contents: rows },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'md', backgroundColor: '#f5f5f0',
        contents: [
          { type: 'text', text: 'พิมพ์ /track <เลขที่> เพื่อดูรายละเอียดงาน', size: 'xxs', color: '#718096', align: 'center', wrap: true },
        ],
      },
    },
  };
}
