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

  // Atomically allocate N ids in ONE round-trip via the getNextIds Apps
  // Script action (introduced v5.10.0 — auditor M-bulk-forward-N-roundtrips).
  // Previously this looped getNextId N times — 25 items × ~300-500ms per
  // round-trip routinely flirted with the Vercel 10s function timeout on
  // a slow Sheet day. doPost wraps everything in LockService so a single
  // batched call is just as race-safe as N sequential calls.
  //
  // Backwards-compat: if the Apps Script side hasn't been redeployed yet
  // (getNextIds returns "Unknown action"), fall back to the per-item loop
  // so the dashboard keeps working until clasp push lands.
  let allocatedIds: number[];
  try {
    const r = await post<{ ids?: number[]; error?: string }>('getNextIds', { count: cleaned.length });
    if (!Array.isArray(r.ids) || r.ids.length !== cleaned.length) {
      throw new Error('getNextIds returned unexpected shape');
    }
    allocatedIds = r.ids.map(Number);
  } catch (errBatch) {
    // Fall back to per-item allocation — slower but compatible with the
    // pre-v5.10.0 Apps Script.
    console.warn('[bulk-forward] getNextIds unavailable, falling back to N×getNextId:', errBatch);
    allocatedIds = [];
    try {
      for (let i = 0; i < cleaned.length; i++) {
        const single = await post<{ nextId?: number; error?: string }>('getNextId', {});
        if (single.error || !single.nextId) {
          return NextResponse.json(
            { error: `ขอ job id ไม่สำเร็จ — ${single.error || 'no id returned'}` },
            { status: 502 },
          );
        }
        allocatedIds.push(Number(single.nextId));
      }
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `ขอ job ids ไม่สำเร็จ — ${msg}` }, { status: 502 });
    }
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
