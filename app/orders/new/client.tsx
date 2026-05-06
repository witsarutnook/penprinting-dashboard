'use client';

import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';
import type { Template } from '@/lib/types';

/** Inline order-entry on /orders/new — no modal, scrolls with the page.
 *  After save the user is redirected to the Kanban. */
export function OrderEntryClient({
  defaultOrderer, templates = [],
}: {
  defaultOrderer: string;
  templates?: Template[];
}) {
  const router = useRouter();
  return (
    <OrderForm
      open
      inline
      onClose={() => router.push('/board?dept=post')}
      defaultOrderer={defaultOrderer}
      templates={templates}
      canManageTemplates
    />
  );
}
