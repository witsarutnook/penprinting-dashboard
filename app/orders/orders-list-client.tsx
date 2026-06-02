'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Job, Order } from '@/lib/types';
import { computeOrdersList } from '@/lib/orders-list';
import { resolvePerPage, resolvePage } from '@/lib/page-size';
import { useDeltaSync } from '@/lib/delta-sync';
import { OrdersBody } from './orders-body';

/**
 * Client-side `/orders` body. `useDeltaSync({ lists: true })` delta-polls
 * jobs/orders and refreshes the shipped/cancelled orderId sets.
 * `computeOrdersList` enriches + filters client-side, so changing a filter
 * or page re-runs locally off `useSearchParams` — no server round-trip, no
 * per-tick `router.refresh()` full re-render.
 */
export function OrdersListClient({
  initialJobs,
  initialOrders,
  initialShippedOrderIds,
  initialCancelledOrderIds,
  initialServerTime,
  role,
}: {
  initialJobs: Job[];
  initialOrders: Order[];
  initialShippedOrderIds: number[];
  initialCancelledOrderIds: number[];
  initialServerTime: string;
  role: 'admin' | 'sales' | 'staff';
}) {
  const { jobs, orders, shippedOrderIds, cancelledOrderIds } = useDeltaSync(
    {
      jobs: initialJobs,
      orders: initialOrders,
      shippedOrderIds: initialShippedOrderIds,
      cancelledOrderIds: initialCancelledOrderIds,
      serverTime: initialServerTime,
    },
    { lists: true },
  );

  const searchParams = useSearchParams();
  const { result, perPage, page, hasActiveFilter } = useMemo(() => {
    const query = (searchParams.get('q') || '').trim().toLowerCase();
    const statusFilter = searchParams.get('status') || '';
    const fromIso = (searchParams.get('from') || '').trim();
    const toIso = (searchParams.get('to') || '').trim();
    return {
      result: computeOrdersList(
        { jobs, orders, shippedOrderIds, cancelledOrderIds },
        { query, statusFilter, fromIso, toIso },
      ),
      perPage: resolvePerPage(searchParams.get('per') ?? undefined),
      page: resolvePage(searchParams.get('page') ?? undefined),
      hasActiveFilter: !!(query || statusFilter || fromIso || toIso),
    };
  }, [jobs, orders, shippedOrderIds, cancelledOrderIds, searchParams]);

  return (
    <OrdersBody
      result={result}
      role={role}
      perPage={perPage}
      page={page}
      hasActiveFilter={hasActiveFilter}
      errorMessage={null}
    />
  );
}
