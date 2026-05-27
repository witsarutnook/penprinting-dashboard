import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import {
  toISODate,
  bangkokTodayISO,
  validateJobInput,
  type JobPayload,
} from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';
import { mintJobId } from '@/lib/id-allocation';
import { addJobToPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';
import { sql } from '@/lib/postgres';

export const maxDuration = 30;

/**
 * Add a new job — admin + sales only.
 *
 * Request body: { name, date, dateIn?, dept, staff, orderId? }
 * id allocation atomic via mintJobId (Postgres counter UPDATE...RETURNING).
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
  // orderId, reject if an active (non-cancelled) job already references it —
  // closes the orphan-recovery double-tap window in the data-audit modal.
  const orderIdNum = body.orderId ? Number(body.orderId) : null;
  if (orderIdNum && Number.isFinite(orderIdNum)) {
    try {
      const r = await sql<{ id: number }>`
        SELECT id FROM jobs
        WHERE order_id = ${orderIdNum}::bigint AND phase2_deleted_at IS NULL
        LIMIT 1
      `;
      const existing = r.rows[0];
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
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `ตรวจสอบงานซ้ำไม่ได้ — ${msg}` }, { status: 502 });
    }
  }

  // Atomic id allocation via Postgres counter row's UPDATE...RETURNING —
  // two concurrent submits never get the same id (row lock serializes minters).
  let nextId: number;
  try {
    nextId = await mintJobId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `id allocation failed — ${msg}` }, { status: 502 });
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

  return addJob(payload, session.role, session.user);
}

async function addJob(payload: JobPayload, role: string, user: string): Promise<NextResponse> {
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
  await appendAuditToPostgres({
    action: 'addJob',
    role,
    user,
    targetId: payload.id as number,
    data: {
      name: payload.name,
      dept: payload.dept,
      staff: payload.staff,
    },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, id: payload.id });
}
