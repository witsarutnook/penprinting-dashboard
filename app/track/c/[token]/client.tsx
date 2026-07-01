'use client';
import { useMemo, useState } from 'react';
import type { CustomerJob } from '@/lib/customer-track';

const STEP_LABELS = ['รับใบสั่งงาน', 'กราฟิก', 'พิมพ์', 'หลังพิมพ์', 'พร้อมรับ', 'จัดส่ง'];
const DEPT_STEP: Record<string, number> = { graphic: 1, print: 2, post: 3 };

function activeStep(job: CustomerJob): number {
  if (job.kind === 'shipped') return 5;
  if (job.awaitingShipment) return 4;
  if (job.currentDept) return DEPT_STEP[job.currentDept] ?? 0;
  return 0;
}

function badge(job: CustomerJob): { label: string; cls: string } {
  if (job.kind === 'cancelled') return { label: 'ยกเลิก', cls: 'bg-gray-100 text-gray-500' };
  if (job.kind === 'shipped') return { label: 'จัดส่งแล้ว', cls: 'bg-green-100 text-green-700' };
  if (job.awaitingShipment) return { label: 'พร้อมรับ', cls: 'bg-green-100 text-green-700' };
  if (job.currentDept === 'graphic') return { label: 'กราฟิก', cls: 'bg-blue-100 text-blue-700' };
  if (job.currentDept === 'print') return { label: 'กำลังพิมพ์', cls: 'bg-blue-100 text-blue-700' };
  if (job.currentDept === 'post') return { label: 'หลังพิมพ์', cls: 'bg-blue-100 text-blue-700' };
  return { label: 'รับงานแล้ว', cls: 'bg-amber-100 text-amber-700' };
}

function daysHint(job: CustomerJob): string {
  if (job.daysLeft == null) return '';
  if (job.daysLeft < 0) return `เลยกำหนด ${Math.abs(job.daysLeft)} วัน`;
  if (job.daysLeft === 0) return 'กำหนดส่งวันนี้';
  return `เหลืออีก ${job.daysLeft} วัน`;
}

export default function CustomerTrackClient({ jobs, customerLabel }: { jobs: CustomerJob[]; customerLabel: string }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return jobs;
    return jobs.filter((j) => j.name.toLowerCase().includes(kw) || j.customer.toLowerCase().includes(kw));
  }, [jobs, q]);

  return (
    <main className="mx-auto max-w-xl p-4">
      <header className="mb-4">
        <h1 className="text-lg font-bold">งานปัจจุบัน — {customerLabel}</h1>
        <p className="text-sm text-gray-500">ทั้งหมด {jobs.length} รายการที่กำลังดำเนินการ</p>
      </header>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่องาน..." className="w-full border rounded px-3 py-2 mb-4" />

      <div className="space-y-3">
        {filtered.map((job) => {
          const b = badge(job);
          const step = activeStep(job);
          const hint = daysHint(job);
          return (
            <div key={job.orderId} className="rounded-lg border border-gray-200 p-3">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <div className="font-medium break-words">{job.name}</div>
                  <div className="text-xs text-gray-500">#{job.orderId} · กำหนดส่ง {job.dateDue}{hint ? ` · ${hint}` : ''}</div>
                </div>
                <span className={`text-xs rounded-full px-2 py-1 shrink-0 ${b.cls}`}>{b.label}</span>
              </div>
              <div className="flex gap-1 mt-3">
                {STEP_LABELS.map((label, i) => (
                  <div key={label} className="flex-1 text-center">
                    <div className={`h-1.5 rounded-full ${i <= step ? 'bg-[#c8553d]' : 'bg-gray-200'}`} />
                    <div className={`text-[9px] mt-1 ${i === step ? 'text-[#c8553d] font-bold' : 'text-gray-400'}`}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-gray-400 text-center py-8">ไม่พบงานที่ตรงกับคำค้น</p>}
      </div>

      <footer className="mt-6 text-center text-xs text-gray-400">โรงพิมพ์เพ็ญพรินติ้ง · 043-220-582</footer>
    </main>
  );
}
