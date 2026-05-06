'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';
import { broadcastWrite } from '@/lib/auto-sync';
import { IconCheck, IconAlertCircle } from '@/lib/icons';
import type { OrderSummary } from '@/lib/board';

/** Inline edit page wrapper. For draft orders, renders an extra
 *  "ส่งเข้าระบบ (สร้างงานในสาย)" call-to-action above the form. */
export function OrderEditClient({
  initial, defaultOrderer, isDraft,
}: {
  initial: OrderSummary;
  defaultOrderer: string;
  isDraft: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ jobId: number } | null>(null);

  async function promote() {
    if (!confirm('ส่งใบสั่งนี้เข้าระบบ? ระบบจะสร้าง Job ในแผนก/ผู้รับงานที่กำหนดและเปลี่ยนสถานะเป็น "สั่งแล้ว"')) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/orders/promote-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/orders/promote-draft');
      setSuccess({ jobId: Number(data.jobId) });
      setTimeout(() => router.push('/board?dept=post'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {isDraft && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 flex flex-wrap items-center gap-3">
          <div className="flex-grow min-w-0">
            <h2 className="text-sm font-semibold text-amber-900">ใบสั่งนี้ยังเป็นแบบร่าง</h2>
            <p className="text-xs text-amber-800 mt-0.5">
              บันทึกการแก้ไขเพื่ออัปเดตข้อมูลในแบบร่าง — หรือกด &quot;ส่งเข้าระบบ&quot; เพื่อสร้าง Job เข้าสายผลิต
            </p>
          </div>
          <button
            type="button"
            onClick={promote}
            disabled={busy || !!success}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
          >
            <IconCheck size={14} />
            {success ? `สำเร็จ — Job #${success.jobId}` : busy ? 'กำลังส่ง...' : 'ส่งเข้าระบบ'}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 flex items-start gap-2">
          <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <OrderForm
        open
        inline
        initial={initial}
        onClose={() => router.push('/orders')}
        defaultOrderer={defaultOrderer}
      />
    </div>
  );
}
