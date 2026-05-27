import { NextResponse } from 'next/server';
import { requireSession, formatThaiDate } from '@/lib/route-helpers';
import { moveToShippedInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Move a job to shipped — all roles (matches WP — moveToShipped NOT in ROLE_REQUIREMENTS).
 *
 * Request body: { id, name, orderId? }
 * → Apps Script payload (SHIPPED_HEADERS):
 *     { id, name, shippedDate, orderId }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  let body: { id?: number; name?: string; orderId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });

  const payload = {
    id: body.id,
    name: body.name || '',
    shippedDate: formatThaiDate(),
    orderId: body.orderId || '',
  };

  return moveToShipped(payload, session.role, session.user);
}

async function moveToShipped(
  payload: { id: number; name: string; shippedDate: string; orderId: number | string },
  role: string,
  user: string,
): Promise<NextResponse> {
  let found = false;
  try {
    const r = await moveToShippedInPostgres({
      id: payload.id,
      name: payload.name,
      shippedDate: payload.shippedDate,
      orderId: payload.orderId,
    });
    found = r.found;
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Phase 4.2 close-out — no Apps Script fallback (Sheet-only write would
    // never reach Postgres = silent data loss). 409 → client refreshes.
    return NextResponse.json(
      { error: 'งานนี้ไม่อยู่ในระบบแล้ว — refresh หน้าแล้วลองใหม่' },
      { status: 409 },
    );
  }

  await appendAuditToPostgres({
    action: 'moveToShipped',
    role,
    user,
    targetId: payload.id,
    data: { name: payload.name },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/shipped');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
