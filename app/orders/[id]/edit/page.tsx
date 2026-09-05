import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadOrder, loadOrderLockState, loadRecentOrdersSlim, type RecentOrderSlim } from '@/lib/api';
import { orderLockReason, orderLockMessage, orderLockLabel, type OrderLockReason } from '@/lib/order-lock';
import { PostgresReadError } from '@/lib/api-postgres';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { OrderEditClient } from './client';
import type { OrderSummary } from '@/lib/board';
import Link from 'next/link';
import { IconArrowLeft, IconFileText } from '@/lib/icons';

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
  // Edit-lock (2026-09-05): shipped / cancelled orders render a panel, not
  // the form. Decided server-side from the same query /api/orders/update
  // uses (`loadOrderLockState` → `orderLockReason`), mirroring the /orders
  // table's canEdit rule — so /archive rows, stale bookmarks and hand-typed
  // URLs can no longer reach the form.
  let lockReason: OrderLockReason | null = null;
  try {
    // Slim bootstrap (PERF-H1, ported from /orders/new — this page was the
    // one loadAll() holdout, audit L-edit-page-loadall): two targeted,
    // coalesced reads instead of the full every-order snapshot — the ONE
    // order being edited (with rawData for prefill) + the slim recent-orders
    // list (id/name/customer/hasRawData) for autocomplete + "ดึงงานล่าสุด".
    const [lookup, recent, lock] = await Promise.all([
      loadOrder(id, { orderOnly: true }),
      loadRecentOrdersSlim(),
      loadOrderLockState(id),
    ]);
    const o = lookup.order as unknown as Record<string, unknown>;
    // Lock null = the orders row vanished between the two reads → treat as
    // missing (404), same as the API's lock path (audit L7).
    if (!lock) missing = true;
    else lockReason = orderLockReason(lock, lock.shipped, lock.cancelled);
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
      errorMessage = err instanceof Error ? err.message : String(err);
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

  if (lockReason && initial) {
    const pill = lockReason === 'cancelled'
      ? 'bg-red-50 text-red-700'
      : 'bg-emerald-50 text-emerald-700';
    const listHref = lockReason === 'cancelled' ? '/cancelled' : '/shipped';
    const listLabel = lockReason === 'cancelled' ? 'รายการยกเลิก' : 'รายการจัดส่งแล้ว';
    return (
      <DashboardShell user={session.user} role={session.role}>
        <header className="border-b border-stone-100 bg-white">
          <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto flex items-center gap-3 flex-wrap">
            <Link
              href="/orders"
              className="text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 text-sm"
              aria-label="กลับไปหน้ารายการใบสั่งงาน"
            >
              <IconArrowLeft size={16} />
              ใบสั่งงาน
            </Link>
            <span className="text-stone-300">·</span>
            <h1 className="text-xl font-bold text-stone-900 min-w-0 truncate">ใบสั่งงาน #{id}</h1>
            <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${pill}`}>
              {orderLockLabel(lockReason)}
            </span>
          </div>
        </header>
        <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
          <section
            aria-labelledby="order-locked-title"
            className="rounded-2xl border border-stone-200 bg-white p-6 max-w-2xl"
          >
            <h2 id="order-locked-title" className="text-lg font-bold text-stone-900">
              {orderLockMessage(lockReason)}
            </h2>
            <p className="text-sm text-stone-700 mt-2 break-words">
              #{id} — {initial.name || '(ไม่มีชื่อ)'}
              {initial.customer ? ` · ${initial.customer}` : ''}
            </p>
            <p className="text-sm text-stone-500 mt-3">
              ใบสั่งงานที่{orderLockLabel(lockReason)}ถูกล็อคไว้เพื่อรักษาประวัติงานและ Job ที่ผูกอยู่
              ถ้าต้องทำงานนี้อีกครั้ง ให้ใช้ &quot;สั่งซ้ำ&quot; จากหน้ารายการใบสั่งงานเพื่อเปิดใบใหม่แทน
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
              <Link
                href="/orders"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-700"
              >
                <IconArrowLeft size={14} />
                กลับไปรายการใบสั่งงาน
              </Link>
              <Link
                href={`/orders/${id}/print`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50"
              >
                <IconFileText size={14} />
                ดูใบสั่งงาน
              </Link>
              <Link
                href={listHref}
                className="inline-flex items-center px-4 py-2 rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50"
              >
                {listLabel}
              </Link>
            </div>
          </section>
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
