import { NextResponse } from 'next/server';
import { post, loadOrderAndJobs, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { allSettledLimit } from '@/lib/concurrency';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import {
  cancelOrderInPostgres,
  appendAuditToPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Soft-cancel an order — admin only. Replacement for the previous hard-
 * delete UX (user feedback 2026-05-07: "เอาเป็นแค่ ยกเลิกพอ"). The
 * order row stays in the orders sheet with status='cancelled' so the
 * audit trail + customer history are preserved; the orders list shows
 * it under the red ยกเลิก badge.
 *
 * Cascade: any active job(s) referencing this order get cancelled with
 * reason "ใบสั่งงาน #<id> ถูกยกเลิก". No orphan window — Apps Script
 * `cancelOrder` (v5.10.4+) does cascade + status flip in a single lock.
 * Falls back to multi-call flow when the action isn't available yet
 * (Apps Script not redeployed); legacy path stays atomic per-job but
 * has a small partial-failure window.
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

  // ── Phase 2 path ────────────────────────────────────────────────
  // Atomic Postgres-side cancel: tombstone all active jobs + INSERT cancelled
  // rows + flip order status. No Apps Script call. Heal cron pushes the
  // cancelled rows + jobs deletions to Sheet within 5 min.
  if (phase2WriteEnabled('cancelOrder')) {
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
        const { revalidatePath } = await import('next/cache');
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

  // ── Fast path: atomic Apps Script action (v5.10.4+) ──
  // Single round-trip: cascade-cancel jobs + flip order status, all in
  // one LockService scope. No orphan possible because both halves are
  // in the same Sheet write. Falls through to the legacy multi-call
  // flow on "Unknown action" (older Apps Script deploy) — that flow
  // also handles cascade but has a small partial-failure window where
  // jobs are cancelled but order status update fails.
  try {
    const r = await post<{ ok?: boolean; orderId?: number; cancelledJobs?: number[]; error?: string }>(
      'cancelOrder',
      {
        data: {
          id,
          reason: `ใบสั่งงาน #${id} ถูกยกเลิก (cascade)`,
          cancelledBy: `${session.role}:${session.user}`,
          cancelledAt: new Date().toISOString(),
        },
      },
    );
    if (r.error) {
      // Real error from atomic action — surface it. (Don't fall through;
      // a logical error like "already cancelled" should propagate.)
      return NextResponse.json({ error: r.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, cancelledJobs: r.cancelledJobs || [] });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    // Only fall back if Apps Script doesn't recognize the action —
    // network/lock errors should surface immediately (don't double-try).
    if (!/Unknown action/i.test(msg)) {
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    // Fall through to legacy multi-call flow below.
  }

  // Postgres-first lookup — closes Phase 2 stale-read recurrence
  // (2026-05-14). loadOrderAndJobs returns { order, jobs } pre-filtered to
  // this orderId; jobs feed the cascade-cancel loop below.
  let snap: Awaited<ReturnType<typeof loadOrderAndJobs>>;
  try {
    snap = await loadOrderAndJobs(id);
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  if (!snap.order) {
    return NextResponse.json({ error: `ไม่พบใบสั่งงาน #${id}` }, { status: 404 });
  }
  const currentStatus = String(snap.order.status || '').toLowerCase();
  if (currentStatus === 'cancelled') {
    return NextResponse.json({ error: `ใบสั่งงาน #${id} ถูกยกเลิกอยู่แล้ว` }, { status: 400 });
  }

  // Step 1: cascade-cancel attached jobs with bounded concurrency.
  // Apps Script handles each cancelJob as an independent Sheet write
  // protected by its own LockService — safe to fire concurrently — but
  // each holds the lock for ~600ms. Firing 8+ in parallel can push the
  // 9th past Apps Script's `LockService.waitLock(10000)` window.
  // Cap at 3 (auditor M5, 2026-05-08): keeps most of the parallelism
  // win while bounding the lock-wait queue. This path is dormant when
  // the atomic v5.10.4+ Apps Script is live; only fires on outage /
  // pre-redeploy preview deploys.
  const attachedJobs = snap.jobs.map((j) => ({
    id: Number(j.id),
    dept: String(j.dept || ''),
    staff: String(j.staff || ''),
    name: String(j.name || ''),
  }));

  const cancelOutcomes = await allSettledLimit(
    attachedJobs.map((j) => () =>
      post<{ ok?: boolean; error?: string }>('cancelJob', {
        data: {
          id: j.id,
          name: j.name,
          dept: j.dept,
          staff: j.staff,
          orderId: id,
          reason: `ใบสั่งงาน #${id} ถูกยกเลิก (cascade)`,
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

  // Bail if any cascade failed — leaving an order at cancelled while jobs
  // still reference it active would split the Kanban from the orders list.
  if (cancelFailed.length > 0) {
    return NextResponse.json(
      {
        error: `ยกเลิก Job ที่ผูกอยู่ไม่สำเร็จ ${cancelFailed.length} งาน — ` +
          `ไม่ได้ยกเลิกใบสั่ง #${id} เพื่อกันข้อมูลไม่สอดคล้อง. ` +
          `Job ที่ค้าง: ${cancelFailed.map((f) => f.id).join(', ')}`,
        cancelFailed,
        cancelledIds,
      },
      { status: 502 },
    );
  }

  // Step 2: flip the order's status to cancelled (preserve every other field).
  const existing = snap.order as unknown as Record<string, unknown>;
  const orderPayload = {
    id,
    name: String(existing.name || ''),
    customer: String(existing.customer || ''),
    dateIn: String(existing.dateIn || ''),
    dateDue: String(existing.dateDue || ''),
    price: existing.price ?? '',
    assignDept: String(existing.assignDept || ''),
    assignStaff: String(existing.assignStaff || ''),
    orderer: String(existing.orderer || ''),
    status: 'cancelled',
    details: existing.details ?? {},
    rawData: existing.rawData ?? {},
  };
  try {
    const r = await post<{ ok?: boolean; error?: string }>('updateOrder', { data: orderPayload });
    if (r.error) {
      return NextResponse.json({
        error: r.error,
        warning: cancelledIds.length > 0
          ? `ยกเลิก Job ${cancelledIds.length} งานสำเร็จแล้วแต่ปรับสถานะใบสั่งไม่สำเร็จ — โปรดเปลี่ยน status ของ #${id} เป็น "cancelled" ด้วยมือใน Sheet`
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
