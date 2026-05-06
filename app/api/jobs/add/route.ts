import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import {
  toISODate,
  bangkokTodayISO,
  validateJobInput,
  type JobPayload,
} from '@/lib/jobs';
import { STAFF, type Dept } from '@/lib/board';

/**
 * Add a new job — admin + sales only (matches WP `PERM.canCreate`).
 *
 * Request body: { name, date, dateIn?, dept, staff, orderId? }
 * → Server fetches fresh `nextId` via loadAll, builds JOBS_HEADERS payload,
 *   calls Apps Script `addJob`. Apps Script bumps `nextId` config atomically.
 *
 * Note: addJob in Apps Script ROLE_REQUIREMENTS is open to all roles, but the
 * WP frontend gates create paths to admin+sales — we mirror that here.
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

  try {
    const result = await post<{ ok?: boolean; id?: number; error?: string }>('addJob', { data: payload });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: payload.id });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
