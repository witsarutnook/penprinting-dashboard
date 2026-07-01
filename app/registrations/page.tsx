import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import RegistrationsClient from './registrations-client';

export const dynamic = 'force-dynamic';

export default async function RegistrationsPage() {
  const session = await verifySession((await cookies()).get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/registrations');
  if (session.role !== 'admin') redirect('/board');
  return <RegistrationsClient />;
}
