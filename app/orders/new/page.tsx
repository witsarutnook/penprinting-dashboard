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
export default async function NewOrderPage({ searchParams }: { searchParams: SearchParams }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/new${searchParams.from ? `?from=${searchParams.from}` : ''}`);
  if (session.role !== 'admin' && session.role !== 'sales') {
    redirect('/board?dept=post');
  }

  // Fetch templates + (optionally) the source order for the duplicate flow.
  let templates: Template[] = [];
  let prefillFromOrder: Record<string, unknown> | null = null;
  let prefillSourceName: string | null = null;
  try {
    const data = await loadAll();
    templates = data.templates || [];

    if (searchParams.from) {
      const fromId = Number(searchParams.from);
      const src = Number.isFinite(fromId)
        ? data.orders.find((o) => Number(o.id) === fromId)
        : undefined;
      if (src) {
        const raw = (src.rawData && typeof src.rawData === 'object'
          ? src.rawData
          : (src.details || {})) as Record<string, unknown>;
        prefillFromOrder = raw;
        prefillSourceName = String(src.name || '');
      }
    }
  } catch {
    // ignore — show form without templates / prefill
  }

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4 max-w-4xl mx-auto">
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
      <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
        <OrderEntryClient
          defaultOrderer={session.user}
          templates={templates}
          prefill={prefillFromOrder}
        />
      </div>
    </DashboardShell>
  );
}
