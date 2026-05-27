import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import {
  cancelOrderInPostgres,
  appendAuditToPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Soft-cancel an order — admin only. The order row stays with
 * status='cancelled' (audit/customer history preserved); shows under the
 * red ยกเลิก badge on /orders.
 *
 * Cascade: any active job(s) referencing this order get cancelled
 * atomically in the same transaction.
 *
 * Body: { id }
 * Returns: { ok, cancelledJobs: [jobIds] } on success
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }

  try {
    const r = await cancelOrderInPostgres({
      orderId: id,
      reason: `ใบสั่งงาน #${id} ถูกยกเลิก (cascade)`,
      cancelledBy: `${session.role}:${session.user}`,
      cancelledAt: new Date().toISOString(),
    });
    if (!r.found) {
      return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
    }
    await appendAuditToPostgres({
      action: 'cancelOrder',
      role: session.role,
      user: session.user,
      targetId: id,
      summary: `ยกเลิกใบสั่งงาน #${id} — cascade ${r.cancelledJobs.length} งาน`,
    });
    try {
      const { revalidatePath, revalidateTag } = await import('next/cache');
      revalidateTag('load-all');
      revalidatePath('/board');
      revalidatePath('/orders');
      revalidatePath('/cancelled');
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, cancelledJobs: r.cancelledJobs });
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
