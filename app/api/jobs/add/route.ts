import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import {
  toISODate,
  bangkokTodayISO,
  validateJobInput,
  type JobPayload,
} from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { addJobToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Add a new job — admin + sales only (matches WP `PERM.canCreate`).
 *
 * Request body: { name, date, dateIn?, dept, staff, orderId? }
 * → Server fetches fresh `nextId` via loadAll, builds JOBS_HEADERS payload,
 *   calls Apps Script `addJob`. Apps Script bumps `nextId` config atomically.
 *
 * Note: addJob in Apps Script ROLE_REQUIREMENTS is open to all roles, but the
 * WP frontend gates create paths to admin+sales — we mirror that here.
 *
 * Phase 2 — when WRITE_ADD_JOB_TO_POSTGRES=1, Postgres is authoritative.
 * id allocation still goes through Apps Script getNextId (keeps Sheet's
 * nextId counter in sync + ids stay sequential for admin UI), but the
 * Sheet write is skipped — heal cron pushes setJobRow within 5 min. Eliminates
 * the legacy double-bump (addJob calls incrementConfig after getNextId
 * already bumped) so Phase 2 ids land contiguously instead of with gaps.
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: {
    name?: string;
    date?: string;
    dateIn?: string;
    dept?: string;
    staff?: string;
    orderId?: string | number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const v = validateJobInput(body);
  if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });

  const dept = body.dept as Dept;
  const staffId = String(body.staff);
  const validStaff = STAFF[dept]?.some((s) => s.id === staffId);
  if (!validStaff) {
    return NextResponse.json(
      { error: `ผู้รับงาน "${staffId}" ไม่ตรงกับแผนก "${dept}"` },
      { status: 400 },
    );
  }

  // Idempotency guard (auditor H1, 2026-05-08): when caller supplies an
  // orderId, reject if an active (non-cancelled) job already references
  // it. This closes the orphan-recovery double-tap window in the data-
  // audit modal — admin clicks "สร้าง Job" twice quickly before the
  // optimistic UI hides the row, otherwise we'd append two jobs for the
  // same orderId. Uses loadAllFresh (no cache) so the second call sees
  // the first call's row even within the same 60s ISR window.
  const orderIdNum = body.orderId ? Number(body.orderId) : null;
  if (orderIdNum && Number.isFinite(orderIdNum)) {
    try {
      const snap = await loadAllFresh();
      const existing = snap.jobs.find((j) => Number(j.orderId) === orderIdNum);
      if (existing) {
        return NextResponse.json(
          {
            error: `ใบสั่งงาน #${orderIdNum} มี Job #${existing.id} ผูกอยู่แล้ว — ` +
              `ไม่สามารถสร้างซ้ำได้ ถ้าต้องการเพิ่มงานอีกใบให้ใช้ "ส่งงานต่อ" บนการ์ดเดิม`,
            existingJobId: Number(existing.id),
          },
          { status: 409 },
        );
      }
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `ตรวจสอบงานซ้ำไม่ได้ — ${msg}` }, { status: 502 });
    }
  }

  // Atomic id allocation via Apps Script getNextId (LockService-protected).
  // Was reading snap.nextId from a fresh loadAll, which is still
  // race-prone — two concurrent "งานเดี่ยว" submits (or งานเดี่ยว +
  // promote-draft) could read the same counter and produce duplicate
  // ids. getNextId mints + bumps the counter inside one lock — same
  // pattern used by /api/jobs/forward, bulk-forward, forward-undo,
  // and orders/promote-draft (auditor C1r).
  let nextId: number;
  try {
    const idResult = await post<{ nextId?: number; error?: string }>('getNextId', {});
    if (idResult.error || typeof idResult.nextId !== 'number') {
      return NextResponse.json(
        { error: idResult.error || 'getNextId returned no id' },
        { status: 502 },
      );
    }
    nextId = idResult.nextId;
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `getNextId failed — ${msg}` }, { status: 502 });
  }

  const payload: JobPayload = {
    id: nextId,
    name: String(body.name).trim(),
    date: toISODate(body.date),
    dateIn: toISODate(body.dateIn) || bangkokTodayISO(),
    dept,
    staff: staffId,
    status: 'pending',
    orderId: body.orderId ? Number(body.orderId) : '',
  };

  if (phase2WriteEnabled('addJob')) {
    return phase2AddJob(payload);
  }

  try {
    const result = await post<{ ok?: boolean; id?: number; error?: string }>('addJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: payload.id });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2AddJob(payload: JobPayload): Promise<NextResponse> {
  try {
    await addJobToPostgres({
      id: payload.id as number,
      name: payload.name,
      date: payload.date ?? null,
      dateIn: payload.dateIn ?? null,
      dept: payload.dept,
      staff: payload.staff,
      status: payload.status,
      orderId: payload.orderId,
    });
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // Postgres write succeeded — heal cron pushes to Sheet via setJobRow
  // within 5 min. Bust /board + /orders caches so the next render shows
  // the new card immediately (Postgres-first reads see the new row).
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, id: payload.id });
}
