// app/api/ai-quote/leads/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { claimLead, updateLead } from '@/lib/ai-quote/db';
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

  // Claiming a lead is a conditional, race-safe write (audit M4) — handled
  // apart from the COALESCE updateLead so two staff can't silently overwrite
  // each other's claim. 409 tells the loser someone already holds it.
  const claimUser = typeof body.assignedTo === 'string' ? body.assignedTo.trim() : '';
  if (claimUser) {
    const claimed = await claimLead(sid, claimUser);
    if (!claimed) return NextResponse.json({ error: 'มีคนหยิบงานนี้ไปแล้ว' }, { status: 409 });
  }

  // Apply the remaining (non-claim) fields, if any.
  if (body.leadStatus || body.customerName != null || body.customerContact != null) {
    await updateLead(sid, {
      leadStatus: body.leadStatus,
      customerName: body.customerName,
      customerContact: body.customerContact,
    });
  }
  return NextResponse.json({ ok: true });
}
