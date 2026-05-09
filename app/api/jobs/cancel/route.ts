import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession, formatThaiDate } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Cancel a job — admin only (matches WP ROLE_REQUIREMENTS.cancelJob = ['admin']).
 *
 * Request body: { id, name, dept, staff, reason, orderId? }
 * → Apps Script payload (CANCELLED_HEADERS):
 *     { id, name, dept, staff, cancelledBy, cancelledAt, reason, orderId }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number; name?: string; dept?: string; staff?: string; reason?: string; orderId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  const reason = (body.reason || '').trim();
  if (!reason) return NextResponse.json({ error: 'กรุณาใส่เหตุผล' }, { status: 400 });

  // Build payload matching CANCELLED_HEADERS:
  // ['id','name','dept','staff','cancelledBy','cancelledAt','reason','orderId']
  const payload = {
    id: body.id,
    name: body.name || '',
    dept: body.dept || '',
    staff: body.staff || '',
    cancelledBy: session.user,
    cancelledAt: formatThaiDate(),
    reason,
    orderId: body.orderId || '',
  };

  try {
    const result = await post<{ ok?: boolean; error?: string }>('cancelJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
