import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { addTemplateToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

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

  let id: number;
  try {
    const r = await addTemplateToPostgres({
      name,
      rawData: body.rawData || {},
      createdBy: session.user,
    });
    id = r.id;
  } catch (err) {
    const msg =
      err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all');
    revalidatePath('/orders/new');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, id });
}
