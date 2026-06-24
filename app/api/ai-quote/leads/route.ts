// app/api/ai-quote/leads/route.ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { listLeads } from '@/lib/ai-quote/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ leads: await listLeads() });
}
