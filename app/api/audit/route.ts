import { NextResponse } from 'next/server';
import { getAuditByTarget, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

/** Fetch audit timeline for a single job/order on demand.
 *  Consumers:
 *    - /board card detail "ประวัติ" tab
 *    - /orders detail modal "ประวัติ" tab
 *
 *  Auth: any logged-in user — same gate as /api/orders/raw/[id]. The audit
 *  log shows action + role + timestamp + summary, not anything an in-team
 *  staff shouldn't see.
 *
 *  Either jobId or orderId required (or both — many job lifecycle audit
 *  entries are recorded against the orderId, not the jobId). 30s ISR cache
 *  matches loadOrder modal-reopen pattern.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  // Per-user rate limit — 60 req/min is plenty for human use of the
  // history tab (one fetch per modal open) but caps any runaway client
  // loop or compromised credential from burning Apps Script quota.
  const rate = await checkRateLimit(`audit:${session.user}`, { limit: 60, windowSec: 60 });
  if (!rate.ok) {
    return NextResponse.json(
      { error: `เรียกข้อมูลถี่เกินไป กรุณารออีก ${rate.retryIn} วินาที` },
      { status: 429, headers: { 'Retry-After': String(rate.retryIn) } },
    );
  }

  const url = new URL(req.url);
  const jobId = url.searchParams.get('jobId') || '';
  const orderId = url.searchParams.get('orderId') || '';
  if (!jobId && !orderId) {
    return NextResponse.json({ error: 'Missing jobId or orderId' }, { status: 400 });
  }

  try {
    const { entries } = await getAuditByTarget(jobId, orderId);
    return NextResponse.json({ entries });
  } catch (err) {
    if (err instanceof AppsScriptError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
