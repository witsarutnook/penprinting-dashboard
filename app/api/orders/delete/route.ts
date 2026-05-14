import { NextResponse } from 'next/server';
import { post, loadOrderAndJobs, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { allSettledLimit } from '@/lib/concurrency';

export const maxDuration = 30;

/** Permanently delete an order — admin only.
 *  Cascade: any active job(s) referencing this order are auto-cancelled
 *  with reason "ใบสั่งงานถูกลบ" so the Kanban doesn't end up with orphan
 *  cards (monitoring.md §8 recurring failure mode).
 *
 *  Fast path: Apps Script `deleteOrderCascade` (v5.10.4+) does cascade
 *  + delete in one lock — no orphan window. Falls back to multi-call
 *  flow when the action isn't available yet.
 *
 *  Behaviour:
 *  - body.cascade=false → behave as before (just delete the order row,
 *    no atomic fast path needed).
 *  - default (cascade=true) → atomic cascade if available, multi-call
 *    fallback otherwise. */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string; cascade?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing order id' }, { status: 400 });
  }
  const cascade = body.cascade !== false; // default true

  // ── Fast path: atomic Apps Script action (v5.10.4+) ──
  // Only when cascade=true (the default + 99% of callers). cascade=false
  // skips this and uses the plain `deleteOrder` action below.
  if (cascade) {
    try {
      const r = await post<{ ok?: boolean; orderId?: number; cancelledJobs?: number[]; error?: string }>(
        'deleteOrderCascade',
        {
          data: {
            id,
            reason: `ใบสั่งงาน #${id} ถูกลบ (cascade)`,
            cancelledBy: `${session.role}:${session.user}`,
            cancelledAt: new Date().toISOString(),
          },
        },
      );
      if (r.error) {
        return NextResponse.json({ error: r.error }, { status: 400 });
      }
      return NextResponse.json({ ok: true, cancelledJobs: r.cancelledJobs || [] });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      if (!/Unknown action/i.test(msg)) {
        return NextResponse.json({ error: msg }, { status: 502 });
      }
      // Fall through to legacy multi-call flow below.
    }
  }

  // Find attached jobs (if cascading) — Postgres-first via loadOrderAndJobs
  // (2026-05-14 refactor; closes the same Phase 2 stale-read pattern that
  // hit /api/orders/update).
  let attachedJobs: Array<{ id: number; dept: string; staff: string; name: string }> = [];
  if (cascade) {
    let snap: Awaited<ReturnType<typeof loadOrderAndJobs>>;
    try {
      snap = await loadOrderAndJobs(id);
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
    }
    attachedJobs = snap.jobs.map((j) => ({
      id: Number(j.id),
      dept: String(j.dept || ''),
      staff: String(j.staff || ''),
      name: String(j.name || ''),
    }));
  }

  // Step 1: cascade-cancel each attached job with bounded concurrency.
  // Cap at 3 (auditor M5, 2026-05-08) — same reasoning as orders/cancel:
  // each cancelJob holds an Apps Script lock ~600ms; firing many at
  // once risks tail timeouts past the 10s waitLock window. Dormant
  // path (atomic v5.10.4+ deleteOrderCascade is the default) but kept
  // safe for outage / preview-deploy fallback.
  const cancelOutcomes = await allSettledLimit(
    attachedJobs.map((j) => () =>
      post<{ ok?: boolean; error?: string }>('cancelJob', {
        data: {
          id: j.id,
          name: j.name,
          dept: j.dept,
          staff: j.staff,
          orderId: id,
          reason: `ใบสั่งงาน #${id} ถูกลบ (cascade)`,
          cancelledBy: `${session.role}:${session.user}`,
          cancelledAt: new Date().toISOString(),
        },
      }),
    ),
    3,
  );

  const cancelledIds: number[] = [];
  const cancelFailed: Array<{ id: number; error: string }> = [];
  cancelOutcomes.forEach((outcome, idx) => {
    const j = attachedJobs[idx];
    if (outcome.status === 'rejected') {
      const reason = outcome.reason;
      const msg = reason instanceof AppsScriptError ? reason.message
        : reason instanceof Error ? reason.message : String(reason);
      cancelFailed.push({ id: j.id, error: msg });
    } else if (outcome.value.error) {
      cancelFailed.push({ id: j.id, error: outcome.value.error });
    } else {
      cancelledIds.push(j.id);
    }
  });

  // If any cascade-cancel failed, abort the order delete to avoid an
  // inconsistent state (jobs left referencing a missing order).
  if (cancelFailed.length > 0) {
    return NextResponse.json(
      {
        error: `ยกเลิก Job ที่ผูกอยู่ไม่สำเร็จ ${cancelFailed.length} งาน — ` +
          `ไม่ได้ลบใบสั่ง #${id} เพื่อกันข้อมูลไม่สอดคล้อง. ` +
          `Job ที่ค้าง: ${cancelFailed.map((f) => f.id).join(', ')}`,
        cancelFailed,
        cancelledIds,
      },
      { status: 502 },
    );
  }

  // Step 2: delete the order row
  try {
    const r = await post<{ ok?: boolean; error?: string }>('deleteOrder', { id });
    if (r.error) {
      return NextResponse.json({
        error: r.error,
        warning: cancelledIds.length > 0
          ? `ยกเลิก Job ${cancelledIds.length} งานสำเร็จแล้วแต่ลบใบสั่งไม่สำเร็จ — โปรดลบ #${id} ด้วยมือใน Sheet`
          : undefined,
        cancelledIds,
      }, { status: 400 });
    }
    return NextResponse.json({ ok: true, cancelledJobs: cancelledIds });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, cancelledIds }, { status: 502 });
  }
}
