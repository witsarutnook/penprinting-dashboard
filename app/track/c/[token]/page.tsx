import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { loadRegistrationByToken } from '@/lib/registrations';
import { loadActiveJobsByCustomer } from '@/lib/customer-track';
import { checkRateLimit } from '@/lib/rate-limit';
import CustomerTrackClient from './client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Rate-limit by token + IP (fails open if KV not configured).
  const h = await headers();
  const ip = h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await checkRateLimit(`custtrack:token:${token}`, { limit: 60, windowSec: 600 });
  const rlIp = await checkRateLimit(`custtrack:ip:${ip}`, { limit: 120, windowSec: 600 });
  if (!rl.ok || !rlIp.ok) {
    return <main className="mx-auto max-w-xl p-6 text-center text-gray-600">ตรวจสอบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่</main>;
  }

  const reg = await loadRegistrationByToken(token);
  if (!reg) notFound();

  const jobs = await loadActiveJobsByCustomer(reg.customers);
  return <CustomerTrackClient jobs={jobs} customerLabel={reg.customers[0] ?? ''} />;
}
