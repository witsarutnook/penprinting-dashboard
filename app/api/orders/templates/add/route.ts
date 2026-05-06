import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

/** Save a new order-form template (preset) — admin + sales. */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: { name?: string; rawData?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = String(body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'กรุณาระบุชื่อ template' }, { status: 400 });
  if (name.length > 80) {
    return NextResponse.json({ error: 'ชื่อ template ยาวเกินไป (≤80 ตัว)' }, { status: 400 });
  }

  try {
    const r = await post<{ ok?: boolean; id?: number; error?: string }>('addTemplate', {
      data: { name, rawData: body.rawData || {}, createdBy: session.user },
    });
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: r.id });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
