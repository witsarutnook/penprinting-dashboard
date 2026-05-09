import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession, formatThaiDate } from '@/lib/route-helpers';

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

  try {
    const result = await post<{ ok?: boolean; error?: string }>('moveToShipped', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
