// app/quote-assistant/page.tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { QuoteAssistantClient } from './quote-assistant-client';

export const metadata: Metadata = { title: 'ผู้ช่วยตีราคา (AI)' };

export default async function QuoteAssistantPage() {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/quote-assistant');
  if (session.role !== 'admin' && session.role !== 'sales') redirect('/board');
  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="pl-4 pr-12 sm:pl-6 sm:pr-6 py-3 flex items-center gap-2">
          <h1 className="text-xl font-bold text-stone-900">ผู้ช่วยตีราคา (AI)</h1>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-3xl mx-auto">
        <QuoteAssistantClient />
      </div>
    </DashboardShell>
  );
}
