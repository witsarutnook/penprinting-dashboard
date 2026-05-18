import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { validateForwardTarget } from '@/lib/forward';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { bulkForwardInPostgres, appendAuditToPostgres } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Forward (ส่งต่องาน) — all roles can forward (matches WP `canWorkflow` = true).
 * RESTRICTED_TARGETS (outsource, diecut_out) are admin only — gated by
 * `validateForwardTarget`.
 *
 * Strategy: client passes the source job snapshot it already has on screen
 * (frontend just clicked the card), so the server skips a `loadAllFresh()`
 * round-trip. We still call `getNextId` explicitly so this route works
 * regardless of Apps Script deploy state — write.ts has a forward-compat
 * server-side allocator that's dormant when newJob.id is supplied. Net
 * round-trips: 2 instead of 3 (skips loadAllFresh).
 *
 * Trust model: client-supplied dept/staff feeds `validateForwardTarget`,
 * which is workflow-advisory not security. The session role gate
 * (`requireSession`) and `RESTRICTED_TARGETS` admin check are server-side
 * and unaffected. `bulkForward` atomically verifies oldId existence in
 * the sheet — if another tab already moved the row, the new row is
 * appended anyway and we surface that as a "processed" success.
 *
 * Request body: { id, targetDept, targetStaff, srcJob: { name, dept, staff,
 *                  date, dateIn, orderId } }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: {
    id?: number | string;
    targetDept?: string;
    targetStaff?: string;
    srcJob?: {
      name?: string;
      dept?: string;
      staff?: string;
      date?: string;
      dateIn?: string;
      orderId?: number | string | null;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const oldId = Number(body.id);
  if (!oldId || !Number.isFinite(oldId)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }
  const targetDept = String(body.targetDept || '');
  const targetStaff = String(body.targetStaff || '');
  if (!targetDept || !targetStaff) {
    return NextResponse.json({ error: 'Missing target dept/staff' }, { status: 400 });
  }
  const src = body.srcJob;
  if (!src || !src.dept || !src.staff) {
    return NextResponse.json({ error: 'Missing srcJob (dept/staff required)' }, { status: 400 });
  }

  const validationErr = validateForwardTarget(
    String(src.dept),
    String(src.staff),
    targetDept,
    targetStaff,
    isAdmin,
  );
  if (validationErr) return NextResponse.json({ error: validationErr }, { status: 400 });

  // Allocate the new id explicitly — keeps backwards-compat with the
  // pre-v5.10.2 Apps Script that doesn't auto-allocate when newJob.id
  // is missing (would write a blank-id row).
  let nextId: number;
  try {
    const r = await post<{ nextId?: number; error?: string }>('getNextId', {});
    if (r.error || !r.nextId) {
      return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${r.error || 'unknown'}` }, { status: 502 });
    }
    nextId = Number(r.nextId);
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${msg}` }, { status: 502 });
  }

  const newJob = {
    id: nextId,
    name: String(src.name || ''),
    date: toISODate(String(src.date || '')),
    dateIn: toISODate(String(src.dateIn || '')),
    staff: targetStaff,
    dept: targetDept,
    status: 'pending',
    orderId: src.orderId ? Number(src.orderId) : '',
    // Cowork is intentionally cleared on forward — matches WP behavior
    // (submitForward at production-monitoring.js:1267 omits cowork).
  };

  // Single-item forward — reuses bulkForward semantics. Phase 2 path uses
  // bulkForwardInPostgres for consistency with /api/jobs/bulk-forward.
  if (phase2WriteEnabled('bulkForward')) {
    const r = await bulkForwardInPostgres([{ oldId, newJob }]);
    if (r.failed.length > 0) {
      return NextResponse.json({ error: r.failed[0].error }, { status: 502 });
    }
    const s = r.succeeded[0];
    if (!s) {
      return NextResponse.json({ error: 'ส่งต่อไม่สำเร็จ — no succeeded item' }, { status: 502 });
    }
    await appendAuditToPostgres({
      action: 'bulkForward',
      role: session.role,
      user: session.user,
      targetId: s.newId,
      summary: `ส่งต่องาน "${s.name}" id=${s.oldId}→${s.newId}`,
    });
    try {
      const { revalidatePath, revalidateTag } = await import('next/cache');
      revalidateTag('load-all'); // bust loadAll() snapshot cache
      revalidatePath('/board');
    } catch { /* ignore */ }
    return NextResponse.json({ ok: true, newId: s.newId });
  }

  try {
    const result = await post<{
      ok?: boolean;
      processed?: number;
      succeeded?: Array<{ oldId: number; newId: number; name: string }>;
      failed?: Array<{ oldId?: number; name?: string; error?: string }>;
      error?: string;
    }>('bulkForward', { data: { items: [{ oldId, newJob }] } });

    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    if (result.failed && result.failed.length > 0) {
      const f = result.failed[0];
      return NextResponse.json(
        { error: f.error || `ส่งต่อไม่สำเร็จ (id=${f.oldId})` },
        { status: 502 },
      );
    }
    if (!result.processed) {
      return NextResponse.json({ error: 'ส่งต่อไม่สำเร็จ — Apps Script ตอบ processed=0' }, { status: 502 });
    }
    return NextResponse.json({ ok: true, newId: nextId });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
