'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';
import { broadcastWrite } from '@/lib/auto-sync';
import { useConfirm } from '@/components/confirm-provider';
import { IconCheck, IconAlertCircle } from '@/lib/icons';
import type { OrderSummary } from '@/lib/board';

interface RecentOrder {
  id: number;
  name: string;
  customer: string;
  hasRawData: boolean;
}

/** Inline edit page wrapper. For draft orders, renders an extra
 *  "ส่งเข้าระบบ (สร้างงานในสาย)" call-to-action above the form. */
export function OrderEditClient({
  initial, defaultOrderer, isDraft, recentOrders = [],
}: {
  initial: OrderSummary;
  defaultOrderer: string;
  isDraft: boolean;
  recentOrders?: RecentOrder[];
}) {
  const router = useRouter();
  const confirmDlg = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ jobId: number } | null>(null);

  async function promote() {
    const ok = await confirmDlg.confirm({
      title: 'ส่งใบสั่งนี้เข้าระบบ?',
      message: 'ระบบจะสร้าง Job ในแผนก/ผู้รับงานที่กำหนดและเปลี่ยนสถานะเป็น "สั่งแล้ว"',
      okLabel: 'ส่งเข้าระบบ',
      variant: 'default',
    });
    if (!ok) return;
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
      // Force the current router cache to drop its pre-promote snapshot so
      // the upcoming /board navigation lands on fresh data instead of the
      // stale ISR copy. Without this, the new card briefly appeared (server
      // re-rendered after the action's revalidatePath) then vanished on
      // the first auto-sync tick that hit the still-warm fetch cache, and
      // only came back after the 60s ISR window rotated. Pairing the
      // refresh with the navigation closes that flicker window.
      router.refresh();
      // Land on the unfiltered board — the new job goes to the order's
      // assignDept (often 'graphic' for photobook), so a `?dept=post`
      // filter would hide it on arrival and create the same disappearance
      // illusion. Show all so the user sees their just-promoted card.
      setTimeout(() => router.push('/board'), 1500);
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
        recentOrders={recentOrders}
      />
    </div>
  );
}
