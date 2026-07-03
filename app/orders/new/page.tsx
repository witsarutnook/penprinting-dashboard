import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { loadAll } from '@/lib/api';
import type { Template } from '@/lib/types';
import { OrderEntryClient } from './client';

export const metadata: Metadata = {
  title: 'สั่งงาน — รับใบสั่งงาน',
};

interface SearchParams {
  /** Duplicate flow — /orders/new?from=ID prefills the form from another order's rawData. */
  from?: string;
}

/** Standalone order-entry page — pure form, no Kanban. Replaces the old
 *  pattern of creating orders from the /board toolbar. Sidebar item
 *  "สั่งงาน" links here. */
export default async function NewOrderPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/new${searchParams.from ? `?from=${searchParams.from}` : ''}`);
  if (session.role !== 'admin' && session.role !== 'sales') {
    redirect('/board?dept=post');
  }

  // Fetch templates + recentOrders (for autocomplete + ดึงงานล่าสุด button)
  // + (optionally) the source order for the duplicate flow.
  // recentOrders is the SLIM shape: id + customer + name + hasRawData flag.
  // The full rawData is fetched on demand via /api/orders/raw/[id] when the
  // user clicks "ดึงงานล่าสุด" — keeps page payload small (M2 from auditor).
  let templates: Template[] = [];
  let recentOrders: Array<{
    id: number; name: string; customer: string; hasRawData: boolean;
  }> = [];
  let prefillFromOrder: Record<string, unknown> | null = null;
  let prefillSourceName: string | null = null;
  try {
    const data = await loadAll();
    templates = data.templates || [];

    recentOrders = [...data.orders]
      .sort((a, b) => Number(b.id) - Number(a.id))
      .slice(0, 1000)
      .map((o) => ({
        id: Number(o.id),
        name: String(o.name || ''),
        customer: String(o.customer || ''),
        hasRawData: !!(o.rawData && typeof o.rawData === 'object'),
      }));

    if (searchParams.from) {
      const fromId = Number(searchParams.from);
      const src = Number.isFinite(fromId)
        ? data.orders.find((o) => Number(o.id) === fromId)
        : undefined;
      if (src) {
        const raw = (src.rawData && typeof src.rawData === 'object'
          ? src.rawData
          : (src.details || {})) as Record<string, unknown>;
        // Carry the canonical name + customer over the rawData copy — the
        // duplicate flow reads them via orderFormFromRaw, but the rawData
        // snapshot can be stale if the source order was renamed after
        // creation (same reason the edit path overrides with OrderSummary
        // fields). Keeps "สั่งซ้ำ" showing the order's current name/customer.
        prefillFromOrder = {
          ...raw,
          name: String(src.name || ''),
          customer: String(src.customer || ''),
        };
        prefillSourceName = String(src.name || '');
      }
    }
  } catch {
    // ignore — show form without templates / prefill
  }

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto">
          <h1 className="text-xl font-bold text-stone-900">
            {prefillFromOrder
              ? `สั่งซ้ำจาก #${searchParams.from} ${prefillSourceName ? `— ${prefillSourceName}` : ''}`
              : 'สั่งงาน — รับใบสั่งงาน'}
          </h1>
          <p className="text-xs text-stone-500 mt-0.5">
            {prefillFromOrder
              ? 'ตรวจ spec แล้วใส่กำหนดส่งใหม่ก่อนยืนยัน — ระบบจะสร้างใบสั่งใหม่ + Job + PIN'
              : 'กรอกข้อมูลครบแล้วกด "สร้างใบสั่งงาน" — ระบบจะสร้าง Job ให้อัตโนมัติพร้อม PIN ลูกค้า'}
          </p>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
        <OrderEntryClient
          defaultOrderer={session.user}
          templates={templates}
          prefill={prefillFromOrder}
          recentOrders={recentOrders}
        />
      </div>
    </DashboardShell>
  );
}
