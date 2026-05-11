import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession, formatThaiDate } from '@/lib/route-helpers';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { cancelJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

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

  if (phase2WriteEnabled('cancelJob')) {
    return phase2CancelJob(payload, session.role, session.user);
  }

  try {
    const result = await post<{ ok?: boolean; error?: string }>('cancelJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2CancelJob(
  payload: {
    id: number;
    name: string;
    dept: string;
    staff: string;
    cancelledBy: string;
    cancelledAt: string;
    reason: string;
    orderId: number | string;
  },
  role: string,
  user: string,
): Promise<NextResponse> {
  let found = false;
  try {
    const r = await cancelJobInPostgres({
      id: payload.id,
      name: payload.name,
      dept: payload.dept,
      staff: payload.staff,
      reason: payload.reason,
      cancelledBy: payload.cancelledBy,
      cancelledAt: payload.cancelledAt,
      orderId: payload.orderId,
    });
    found = r.found;
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Job not in Postgres yet — fall through to legacy Apps Script.
    try {
      const result = await post<{ ok?: boolean; error?: string }>('cancelJob', { data: payload });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, fallback: 'apps-script' });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  await appendAuditToPostgres({
    action: 'cancelJob',
    role,
    user,
    targetId: payload.id,
    data: { name: payload.name, reason: payload.reason },
  });

  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/board');
    revalidatePath('/cancelled');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
