// app/api/ai-quote/leads/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { updateLead } from '@/lib/ai-quote/db';
import type { LeadStatus } from '@/lib/ai-quote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID: LeadStatus[] = ['ใหม่', 'กำลังติดตาม', 'ปิดการขาย', 'ไม่สนใจ', 'escalated', 'abandoned'];

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;
  const { id } = await props.params;
  const sid = Number(id);
  if (!sid) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { leadStatus?: LeadStatus; assignedTo?: string; customerName?: string; customerContact?: string };
  if (body.leadStatus && !VALID.includes(body.leadStatus)) return NextResponse.json({ error: 'bad status' }, { status: 422 });
  await updateLead(sid, body);
  return NextResponse.json({ ok: true });
}
