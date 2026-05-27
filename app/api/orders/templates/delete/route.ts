import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { deleteTemplateFromPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/** Delete an order-form template by id — admin + sales. */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'Missing template id' }, { status: 400 });

  try {
    await deleteTemplateFromPostgres(id);
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

  return NextResponse.json({ ok: true });
}
