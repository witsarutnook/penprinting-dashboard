'use client';

import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';
import type { OrderSummary } from '@/lib/board';

interface RecentOrder {
  id: number;
  name: string;
  customer: string;
  hasRawData: boolean;
}

/** Inline edit page wrapper. For draft orders, the OrderForm footer
 *  renders a "บันทึก + ส่งเข้าระบบ" button that saves + promotes in one
 *  click — no banner-level button needed. */
export function OrderEditClient({
  initial, defaultOrderer, isDraft, recentOrders = [],
}: {
  initial: OrderSummary;
  defaultOrderer: string;
  isDraft: boolean;
  recentOrders?: RecentOrder[];
}) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      {isDraft && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <h2 className="text-sm font-semibold text-amber-900">ใบสั่งนี้ยังเป็นแบบร่าง</h2>
          <p className="text-xs text-amber-800 mt-0.5">
            กรอกฟอร์มให้ครบ → กด <b>&quot;บันทึก + ส่งเข้าระบบ&quot;</b> ที่ฟอร์มด้านล่าง — บันทึกและสร้าง Job เข้าสายผลิตในคลิกเดียว
          </p>
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
