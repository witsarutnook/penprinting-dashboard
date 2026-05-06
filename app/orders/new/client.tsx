'use client';

import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';

/** Inline order-entry on /orders/new — no modal, scrolls with the page.
 *  After save the user is redirected to the Kanban. */
export function OrderEntryClient({ defaultOrderer }: { defaultOrderer: string }) {
  const router = useRouter();
  return (
    <OrderForm
      open
      inline
      onClose={() => router.push('/board?dept=post')}
      defaultOrderer={defaultOrderer}
    />
  );
}
