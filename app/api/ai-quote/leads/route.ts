// app/api/ai-quote/leads/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { listLeads, createLead, saveQuote } from '@/lib/ai-quote/db';
import { sanitizeHistory } from '@/lib/ai-quote/run';
import type { SaveLeadRequest } from '@/lib/ai-quote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ leads: await listLeads() });
}

// Explicit "save as lead" (no-auto-save): persist the whole chat + quotes +
// customer info as a new lead. Called when staff clicks "บันทึกเป็น lead".
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => ({}))) as SaveLeadRequest;
  const conversation = sanitizeHistory(body.conversation);
  if (conversation.length === 0) return NextResponse.json({ error: 'ยังไม่มีบทสนทนาให้บันทึก' }, { status: 400 });

  const id = await createLead({
    conversation,
    customerName: body.customerName?.trim() || null,
    customerContact: body.customerContact?.trim() || null,
    assignedTo: session.user, // auto-assign — the saver owns the lead
  });
  for (const q of body.quotes ?? []) {
    await saveQuote(id, { productType: q.productType, spec: q.spec, result: q.result, unitPrice: q.unitPrice });
  }
  return NextResponse.json({ sessionId: id });
}
