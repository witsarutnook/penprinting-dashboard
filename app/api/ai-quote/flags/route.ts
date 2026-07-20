// app/api/ai-quote/flags/route.ts — tag/untag ข้อความ AI ว่าตอบผิด (/quote-logs, admin)
// Snapshot ของ turn มาจาก DB ฝั่ง server ใน flagTurn — client ส่งแค่ index.
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { flagTurn, unflagTurn } from '@/lib/ai-quote/logs';
import { appendAuditToPostgres } from '@/lib/postgres-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseIds(body: Record<string, unknown>): { sessionId: number; turnIndex: number } | null {
  const sessionId = Number(body.sessionId);
  const turnIndex = Number(body.turnIndex);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return null;
  if (!Number.isInteger(turnIndex) || turnIndex < 0) return null;
  return { sessionId, turnIndex };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = parseIds(body);
  if (!ids) return NextResponse.json({ error: 'sessionId/turnIndex ไม่ถูกต้อง' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null;

  const result = await flagTurn(ids.sessionId, ids.turnIndex, note, session.user);
  if (result === 'not-found') return NextResponse.json({ error: 'ไม่พบ session' }, { status: 404 });
  if (result === 'not-assistant') return NextResponse.json({ error: 'tag ได้เฉพาะข้อความ AI' }, { status: 422 });
  if (result === 'duplicate') return NextResponse.json({ error: 'ข้อความนี้ tag แล้ว' }, { status: 409 });

  await appendAuditToPostgres({
    action: 'flagAiTurn',
    role: session.role,
    user: session.user,
    targetId: ids.sessionId,
    summary: `🚩 tag AI ตอบผิด — session #${ids.sessionId} turn ${ids.turnIndex}${note ? ` (${note.slice(0, 80)})` : ''}`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = parseIds(body);
  if (!ids) return NextResponse.json({ error: 'sessionId/turnIndex ไม่ถูกต้อง' }, { status: 400 });

  const removed = await unflagTurn(ids.sessionId, ids.turnIndex);
  if (!removed) return NextResponse.json({ error: 'ไม่พบ tag' }, { status: 404 });

  await appendAuditToPostgres({
    action: 'unflagAiTurn',
    role: session.role,
    user: session.user,
    targetId: ids.sessionId,
    summary: `ลบ tag AI ตอบผิด — session #${ids.sessionId} turn ${ids.turnIndex}`,
  });
  return NextResponse.json({ ok: true });
}
