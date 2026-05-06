import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { OrderEditClient } from './client';
import type { OrderSummary } from '@/lib/board';
import Link from 'next/link';
import { IconArrowLeft } from '@/lib/icons';

export const metadata: Metadata = {
  title: 'แก้ไขใบสั่งงาน',
};

export default async function EditOrderPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies();
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
  let recentOrders: Array<{
    id: number; name: string; customer: string; hasRawData: boolean;
  }> = [];
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    const o = data.orders.find((x) => Number(x.id) === id);
    if (!o) notFound();
    initial = {
      id: Number(o.id),
      name: String(o.name || ''),
      customer: String(o.customer || ''),
      dateIn: String(o.dateIn || ''),
      dateDue: String(o.dateDue || ''),
      price: o.price,
      assignDept: String(o.assignDept || ''),
      assignStaff: String(o.assignStaff || ''),
      orderer: String(o.orderer || ''),
      status: String(o.status || ''),
      details: (o.details && typeof o.details === 'object') ? (o.details as Record<string, unknown>) : null,
      rawData: (o.rawData && typeof o.rawData === 'object') ? (o.rawData as Record<string, unknown>) : null,
    };
    // Pass recent orders for autocomplete + ดึงล่าสุด button (slim)
    recentOrders = [...data.orders]
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 1000)
      .map((x) => ({
        id: Number(x.id),
        name: String(x.name || ''),
        customer: String(x.customer || ''),
        hasRawData: !!(x.rawData && typeof x.rawData === 'object'),
      }));
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }

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
