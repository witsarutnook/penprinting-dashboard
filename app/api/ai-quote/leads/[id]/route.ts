// app/api/ai-quote/leads/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { claimLead, updateLead, deleteLead, releaseLead, loadConversation } from '@/lib/ai-quote/db';
import type { LeadStatus } from '@/lib/ai-quote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID: LeadStatus[] = ['ใหม่', 'กำลังติดตาม', 'ปิดการขาย', 'ไม่สนใจ', 'escalated', 'abandoned'];

// Lazy transcript for the /quote-leads expand — the list endpoint is slim
// (L-listleads-eager-conversation), so the full conversation fetches here,
// one lead at a time, only when staff actually opens a row.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;
  const { id } = await props.params;
  const sid = Number(id);
  if (!sid) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const conversation = await loadConversation(sid);
  if (conversation === null) return NextResponse.json({ error: 'ไม่พบ lead นี้' }, { status: 404 });
  return NextResponse.json({ conversation });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;
  const { id } = await props.params;
  const sid = Number(id);
  if (!sid) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { leadStatus?: LeadStatus; assignedTo?: string; customerName?: string; customerContact?: string; release?: boolean };
  if (body.leadStatus && !VALID.includes(body.leadStatus)) return NextResponse.json({ error: 'bad status' }, { status: 422 });

  // Release owner (คืนงาน): admin can release any; others only their own.
  if (body.release) {
    await releaseLead(sid, session.role === 'admin' ? undefined : session.user);
    return NextResponse.json({ ok: true });
  }

  // Claiming a lead is a conditional, race-safe write (audit M4) — handled
  // apart from the COALESCE updateLead so two staff can't silently overwrite
  // each other's claim. 409 tells the loser someone already holds it.
  // Server-authoritative owner (audit L-leadclaim-body-owner): body.assignedTo
  // is only the *intent* signal ("หยิบงาน") — the recorded owner is always the
  // verified session user, same rule as reassign (38c6593).
  const wantsClaim = typeof body.assignedTo === 'string' && body.assignedTo.trim() !== '';
  if (wantsClaim) {
    const claimed = await claimLead(sid, session.user);
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

// Hard-delete a lead (clear test/junk sessions). Destructive → admin only,
// matching the /api/jobs/delete convention. ai_quotes rows cascade-delete.
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const { id } = await props.params;
  const sid = Number(id);
  if (!sid) return NextResponse.json({ error: 'bad id' }, { status: 400 });
  await deleteLead(sid);
  return NextResponse.json({ ok: true });
}
