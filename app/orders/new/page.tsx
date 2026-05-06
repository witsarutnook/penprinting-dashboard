import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { OrderEntryClient } from './client';

export const metadata: Metadata = {
  title: 'สั่งงาน — รับใบสั่งงาน',
};

/** Standalone order-entry page — pure form, no Kanban. Replaces the old
 *  pattern of creating orders from the /board toolbar. Sidebar item
 *  "สั่งงาน" links here. */
export default async function NewOrderPage() {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/orders/new');
  if (session.role !== 'admin' && session.role !== 'sales') {
    redirect('/board?dept=post');
  }

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4 max-w-4xl mx-auto">
          <h1 className="text-xl font-bold text-stone-900">สั่งงาน — รับใบสั่งงาน</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            กรอกข้อมูลครบแล้วกด &quot;สร้างใบสั่งงาน&quot; — ระบบจะสร้าง Job ให้อัตโนมัติพร้อม PIN ลูกค้า
          </p>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
        <OrderEntryClient defaultOrderer={session.user} />
      </div>
    </DashboardShell>
  );
}
