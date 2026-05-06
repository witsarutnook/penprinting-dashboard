import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { validateForwardTarget } from '@/lib/forward';

/**
 * Bulk forward — all roles, 1-25 jobs per request (mirrors WP `BULK_FORWARD_MAX`
 * and Apps Script 30s execution limit).
 *
 * Each item gets its own target dept/staff so admin can mix-and-match. Server
 * validates each via FW_TARGETS, allocates sequential nextIds from one fresh
 * loadAll, then sends ONE Apps Script bulkForward call (atomic in one
 * LockService — no partial-state race).
 *
 * Request body: { items: [{ id, targetDept, targetStaff }, ...] }
 * Response:     { ok, processed, failed: [{ oldId, name, error }] }
 */
const MAX_BATCH = 25;

interface IncomingItem {
  id?: number | string;
  targetDept?: string;
  targetStaff?: string;
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const isAdmin = session.role === 'admin';

  let body: { items?: IncomingItem[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ error: 'ไม่มีงานที่เลือก' }, { status: 400 });
  if (items.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `ส่งต่อได้สูงสุด ${MAX_BATCH} งาน/ครั้ง — เลือก ${items.length} งาน` },
      { status: 400 },
    );
  }

  // De-dup — same job shouldn't be queued twice in one batch (would race in Apps Script).
  const seen = new Set<number>();
  const cleaned: Array<{ id: number; targetDept: string; targetStaff: string }> = [];
  for (const it of items) {
    const id = Number(it.id);
    if (!id || !Number.isFinite(id)) {
      return NextResponse.json({ error: `id ไม่ถูกต้อง: ${it.id}` }, { status: 400 });
    }
    if (seen.has(id)) {
      return NextResponse.json({ error: `งาน id=${id} ซ้ำใน batch` }, { status: 400 });
    }
    seen.add(id);
    const targetDept = String(it.targetDept || '');
    const targetStaff = String(it.targetStaff || '');
    if (!targetDept || !targetStaff) {
      return NextResponse.json({ error: `id=${id} ขาด targetDept/targetStaff` }, { status: 400 });
    }
    cleaned.push({ id, targetDept, targetStaff });
  }

  // One snapshot → resolve every source job + allocate sequential IDs.
  let snap;
  try {
    snap = await loadAllFresh();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  const jobsById = new Map<number, (typeof snap.jobs)[number]>();
  snap.jobs.forEach((j) => jobsById.set(Number(j.id), j));

  // Atomically allocate ONE id PER item from Apps Script LockService.
  // Pre-allocating N ids client-side from a cached snap.nextId is racy —
  // a concurrent forward could grab `a+1` while we're using `[a, a+1, …]`
  // in our batch. Calling getNextId N times guarantees unique ids even
  // under concurrency at the cost of N round-trips. Bulk-forward is
  // admin-only + rare (cap 25) so this trade-off is acceptable.
  // Reported by auditor C1 (2026-05-06).
  const allocatedIds: number[] = [];
  try {
    for (let i = 0; i < cleaned.length; i++) {
      const r = await post<{ nextId?: number; error?: string }>('getNextId', {});
      if (r.error || !r.nextId) {
        return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${r.error || 'unknown'}` }, { status: 502 });
      }
      allocatedIds.push(Number(r.nextId));
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${msg}` }, { status: 502 });
  }
  const buildItems: Array<{ oldId: number; newJob: Record<string, unknown> }> = [];

  for (const it of cleaned) {
    const src = jobsById.get(it.id);
    if (!src) {
      return NextResponse.json(
        { error: `ไม่พบงาน id=${it.id} (อาจถูกลบ/ส่งต่อโดยคนอื่นแล้ว)` },
        { status: 404 },
      );
    }
    const validationErr = validateForwardTarget(
      String(src.dept),
      String(src.staff),
      it.targetDept,
      it.targetStaff,
      isAdmin,
    );
    if (validationErr) {
      return NextResponse.json(
        { error: `id=${it.id} (${src.name || ''}): ${validationErr}` },
        { status: 400 },
      );
    }
    buildItems.push({
      oldId: it.id,
      newJob: {
        id: allocatedIds[buildItems.length],
        name: src.name,
        date: toISODate(src.date),
        dateIn: toISODate(src.dateIn),
        staff: it.targetStaff,
        dept: it.targetDept,
        status: 'pending',
        orderId: src.orderId ? Number(src.orderId) : '',
        // Cowork cleared on forward — matches WP submitForward
      },
    });
  }

  try {
    const result = await post<{
      ok?: boolean;
      processed?: number;
      failed?: Array<{ oldId?: number; name?: string; error?: string }>;
      error?: string;
    }>('bulkForward', { data: { items: buildItems } });

    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      ok: true,
      processed: result.processed || 0,
      failed: result.failed || [],
    });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
