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

  let nextId: number;
  try {
    const snap = await loadAllFresh();
    nextId = Number(snap.nextId) || 100;
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่าน nextId ไม่ได้ — ${msg}` }, { status: 502 });
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
