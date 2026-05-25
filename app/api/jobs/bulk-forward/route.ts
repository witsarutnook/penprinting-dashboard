import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { validateForwardTarget } from '@/lib/forward';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { mintJobIds } from '@/lib/id-allocation';
import { bulkForwardInPostgres, appendAuditToPostgres, type BulkForwardItem } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Bulk forward — all roles, 1-25 jobs per request (mirrors WP `BULK_FORWARD_MAX`
 * and Apps Script 30s execution limit).
 *
 * Each item carries its own source snapshot (frontend already has it on
 * screen) + target dept/staff. Server skips `loadAllFresh()` then allocates
 * sequential ids via `getNextIds(N)` (one round-trip) before sending the
 * batch to Apps Script `bulkForward`. Net Apps Script round-trips: 2 instead
 * of 3 (skips loadAllFresh).
 *
 * Trust model: same as /api/jobs/forward — client-supplied src.dept/staff
 * feeds workflow validation, which is best-effort. RESTRICTED_TARGETS admin
 * gate + session role check are server-authoritative.
 *
 * Request body: { items: [{ id, targetDept, targetStaff, srcJob: { name,
 *                  dept, staff, date, dateIn, orderId } }, ...] }
 * Response:     { ok, processed, succeeded: [{oldId, newId, name}],
 *                  failed: [{oldId, name, error}] }
 */
const MAX_BATCH = 25;

interface IncomingItem {
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

  const seen = new Set<number>();
  const cleaned: Array<{ id: number; targetDept: string; targetStaff: string; src: NonNullable<IncomingItem['srcJob']> }> = [];
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
    const src = it.srcJob;
    if (!src || !src.dept || !src.staff) {
      return NextResponse.json({ error: `id=${id} ขาด srcJob.dept/staff` }, { status: 400 });
    }
    const validationErr = validateForwardTarget(
      String(src.dept),
      String(src.staff),
      targetDept,
      targetStaff,
      isAdmin,
    );
    if (validationErr) {
      return NextResponse.json(
        { error: `id=${id} (${src.name || ''}): ${validationErr}` },
        { status: 400 },
      );
    }
    cleaned.push({ id, targetDept, targetStaff, src });
  }

  // Allocate N sequential ids in one round-trip via Postgres counter —
  // mintJobIds bumps `counters.nextId` by N atomically and returns the
  // reserved range [start, start+N-1].
  let allocatedIds: number[];
  try {
    allocatedIds = await mintJobIds(cleaned.length);
    if (allocatedIds.length !== cleaned.length) {
      throw new Error('mintJobIds returned unexpected count');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ขอ job ids ไม่สำเร็จ — ${msg}` }, { status: 502 });
  }

  const buildItems: Array<{ oldId: number; newJob: Record<string, unknown> }> = cleaned.map((it, idx) => ({
    oldId: it.id,
    newJob: {
      id: allocatedIds[idx],
      name: String(it.src.name || ''),
      date: toISODate(String(it.src.date || '')),
      dateIn: toISODate(String(it.src.dateIn || '')),
      staff: it.targetStaff,
      dept: it.targetDept,
      status: 'pending',
      orderId: it.src.orderId ? Number(it.src.orderId) : '',
      // Cowork cleared on forward — matches WP submitForward
    },
  }));

  if (phase2WriteEnabled('bulkForward')) {
    // Convert buildItems (Record<string, unknown> shape compatible with Apps
    // Script bulkForward) into the strict BulkForwardItem[] the helper needs.
    const phase2Items: BulkForwardItem[] = cleaned.map((it, idx) => ({
      oldId: it.id,
      newJob: {
        id: allocatedIds[idx],
        name: String(it.src.name || ''),
        date: toISODate(String(it.src.date || '')) || null,
        dateIn: toISODate(String(it.src.dateIn || '')) || null,
        staff: it.targetStaff,
        dept: it.targetDept,
        status: 'pending',
        orderId: it.src.orderId ? Number(it.src.orderId) : null,
      },
    }));
    const r = await bulkForwardInPostgres(phase2Items);
    // Audit per successful item — gives each new job's history tab its own
    // "ส่งต่องาน" entry (better than Apps Script's single batch entry).
    for (const s of r.succeeded) {
      await appendAuditToPostgres({
        action: 'bulkForward',
        role: session.role,
        user: session.user,
        targetId: s.newId,
        summary: `ส่งต่องาน "${s.name}" id=${s.oldId}→${s.newId}`,
      });
    }
    try {
      const { revalidatePath, revalidateTag } = await import('next/cache');
      revalidateTag('load-all'); // bust loadAll() snapshot cache
      revalidatePath('/board');
    } catch { /* ignore */ }
    return NextResponse.json({
      ok: true,
      processed: r.succeeded.length + r.failed.length,
      succeeded: r.succeeded,
      failed: r.failed,
    });
  }

  try {
    const result = await post<{
      ok?: boolean;
      processed?: number;
      succeeded?: Array<{ oldId: number; newId: number; name: string }>;
      failed?: Array<{ oldId?: number; name?: string; error?: string }>;
      error?: string;
    }>('bulkForward', { data: { items: buildItems } });

    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      ok: true,
      processed: result.processed || 0,
      succeeded: result.succeeded || [],
      failed: result.failed || [],
    });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
