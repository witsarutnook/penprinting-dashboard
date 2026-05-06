'use client';

import { useState } from 'react';
import { OrderForm } from '@/app/board/order-form';
import { IconFileText, IconArrowRight } from '@/lib/icons';
import Link from 'next/link';

/** Client wrapper that opens OrderForm in "always-open" mode for the
 *  dedicated /orders/new page. After save the user can either create
 *  another order or jump back to the Kanban. */
export function OrderEntryClient({ defaultOrderer }: { defaultOrderer: string }) {
  const [open, setOpen] = useState(true);

  if (open) {
    return (
      <OrderForm
        open={open}
        onClose={() => setOpen(false)}
        defaultOrderer={defaultOrderer}
      />
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-8 text-center space-y-4">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-100 text-stone-500 mx-auto">
        <IconFileText size={22} />
      </div>
      <h2 className="text-base font-semibold text-stone-800">ใบสั่งงานบันทึกแล้ว</h2>
      <div className="flex flex-wrap gap-2 justify-center pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark"
        >
          <IconFileText size={14} />
          สร้างใบสั่งใหม่
        </button>
        <Link
          href="/board?dept=post"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
        >
          ไปหน้า Kanban
          <IconArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}
