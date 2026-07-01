// app/api/registrations/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { listRegistrations, createRegistration } from '@/lib/registrations';
import { appendAuditToPostgres } from '@/lib/postgres-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  return NextResponse.json({ registrations: await listRegistrations() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const body = (await req.json().catch(() => ({}))) as {
    customers?: unknown; lineGroupId?: unknown; note?: unknown;
  };
  const customers = Array.isArray(body.customers)
    ? body.customers.map((c) => String(c).trim()).filter(Boolean)
    : [];
  if (customers.length === 0) {
    return NextResponse.json({ error: 'ต้องเลือกลูกค้าอย่างน้อย 1 ราย' }, { status: 400 });
  }
  const lineGroupId = body.lineGroupId ? String(body.lineGroupId).trim() : null;
  const note = body.note ? String(body.note).trim() : null;

  try {
    const reg = await createRegistration({ customers, lineGroupId, note, createdBy: `${session.role}:${session.user}` });
    await appendAuditToPostgres({
      action: 'createRegistration',
      role: session.role,
      user: session.user,
      targetId: reg.id,
      summary: `ลงทะเบียน track ลูกค้า: ${customers.join(', ')}${lineGroupId ? ` (กลุ่ม ${lineGroupId})` : ''}`,
    });
    return NextResponse.json({ registration: reg });
  } catch (err) {
    // line_group_id UNIQUE violation → กลุ่มนี้ถูกผูกไว้แล้ว
    const msg = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json({ error: 'กลุ่ม LINE นี้ถูกผูกกับลูกค้ารายอื่นแล้ว' }, { status: 409 });
    }
    console.error('[registrations] create failed:', msg);
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ' }, { status: 500 });
  }
}
