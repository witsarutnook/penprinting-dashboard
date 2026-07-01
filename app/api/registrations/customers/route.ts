// app/api/registrations/customers/route.ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { listDistinctCustomers } from '@/lib/registrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ customers: await listDistinctCustomers() });
}
