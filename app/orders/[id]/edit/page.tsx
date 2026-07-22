import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadOrder, loadRecentOrdersSlim, AppsScriptError, type RecentOrderSlim } from '@/lib/api';
import { PostgresReadError } from '@/lib/api-postgres';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { OrderEditClient } from './client';
import type { OrderSummary } from '@/lib/board';
import Link from 'next/link';
import { IconArrowLeft } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'แก้ไขใบสั่งงาน',
};

export default async function EditOrderPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/${params.id}/edit`);
  // Edit = admin only. Sales can create new orders + promote drafts but
  // cannot mutate existing orders' fields (staff can't either).
  if (session.role !== 'admin') {
    redirect('/orders');
  }

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) notFound();

  let initial: OrderSummary | null = null;
  // Slim: rawData NOT included — fetched lazily via /api/orders/raw/[id]
  let recentOrders: RecentOrderSlim[] = [];
  let errorMessage: string | null = null;
  let missing = false;
  try {
    // Slim bootstrap (PERF-H1, ported from /orders/new — this page was the
    // one loadAll() holdout, audit L-edit-page-loadall): two targeted,
    // coalesced reads instead of the full every-order snapshot — the ONE
    // order being edited (with rawData for prefill) + the slim recent-orders
    // list (id/name/customer/hasRawData) for autocomplete + "ดึงงานล่าสุด".
    const [lookup, recent] = await Promise.all([
      loadOrder(id, { orderOnly: true }),
      loadRecentOrdersSlim(),
    ]);
    const o = lookup.order as unknown as Record<string, unknown>;
    initial = {
      id: Number(o.id),
      name: String(o.name || ''),
      customer: String(o.customer || ''),
      dateIn: String(o.dateIn || ''),
      dateDue: String(o.dateDue || ''),
      price: o.price as OrderSummary['price'],
      assignDept: String(o.assignDept || ''),
      assignStaff: String(o.assignStaff || ''),
      orderer: String(o.orderer || ''),
      status: String(o.status || ''),
      details: (o.details && typeof o.details === 'object') ? (o.details as Record<string, unknown>) : null,
      rawData: (o.rawData && typeof o.rawData === 'object') ? (o.rawData as Record<string, unknown>) : null,
    };
    recentOrders = recent;
  } catch (err) {
    // Row-not-found → the 404 page. Thrown OUTSIDE the try (below): the old
    // code called notFound() inside it, so Next's control-flow throw was
    // swallowed by this catch and rendered as the error banner instead.
    if (err instanceof PostgresReadError && err.message.includes('not found')) {
      missing = true;
    } else {
      errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    }
  }
  if (missing) notFound();

  if (errorMessage) {
    return (
      <DashboardShell user={session.user} role={session.role}>
        <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-amber-900 font-semibold">โหลดไม่สำเร็จ</h2>
            <p className="text-sm text-amber-800 mt-2 font-mono">{errorMessage}</p>
          </div>
        </div>
      </DashboardShell>
    );
  }

  const isDraft = String(initial?.status || '').toLowerCase() === 'draft';

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto flex items-center gap-3">
          <Link
            href="/orders"
            className="text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 text-sm"
            aria-label="กลับไปหน้ารายการใบสั่งงาน"
          >
            <IconArrowLeft size={16} />
            ใบสั่งงาน
          </Link>
          <span className="text-stone-300">·</span>
          <h1 className="text-xl font-bold text-stone-900">
            {isDraft ? `แบบร่าง #${id}` : `แก้ไขใบสั่งงาน #${id}`}
          </h1>
          {isDraft && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800">DRAFT</span>
          )}
        </div>
      </header>
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        {initial && (
          <OrderEditClient
            initial={initial}
            defaultOrderer={session.user}
            isDraft={isDraft}
            recentOrders={recentOrders}
          />
        )}
      </div>
    </DashboardShell>
  );
}
