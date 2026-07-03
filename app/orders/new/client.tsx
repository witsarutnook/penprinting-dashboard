'use client';

import { useRouter } from 'next/navigation';
import { OrderForm } from '@/app/board/order-form';
import type { Template } from '@/lib/types';

interface RecentOrder {
  id: number;
  name: string;
  customer: string;
  hasRawData: boolean;
}

/** Inline order-entry on /orders/new — no modal, scrolls with the page.
 *  After save the user is redirected to the Kanban.
 *
 *  When a `prefill` rawData is passed (duplicate flow via ?from=ID), the
 *  OrderForm is rendered with `initialPrefill`, which carries over the full
 *  spec including the job name + customer and only resets the dates. */
export function OrderEntryClient({
  defaultOrderer, templates = [], prefill = null, recentOrders = [],
}: {
  defaultOrderer: string;
  templates?: Template[];
  prefill?: Record<string, unknown> | null;
  recentOrders?: RecentOrder[];
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
      initialPrefill={prefill}
      recentOrders={recentOrders}
    />
  );
}
