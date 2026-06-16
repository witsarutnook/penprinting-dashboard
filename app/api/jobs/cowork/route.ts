import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { STAFF } from '@/lib/board';
import { setCoworkInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Set the co-work list (collaborators) for a job — all roles, mirrors WP
 * `setCowork`. Co-work is a workflow attachment (designer asks another for
 * help, multi-station job), not data edit, so it stays open like reassign.
 *
 * Post-§12: Postgres is the sole source of truth. The write goes directly
 * to Postgres (via setCoworkInPostgres) and is authoritative immediately.
 * No Apps Script call, no Sheet sync, no heal cron. /board reads from
 * Postgres so the cowork chip lands instantly.
 *
 * Request body: { id, cowork: Array<{ dept, staff }> }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  let body: {
    id?: number | string;
    cowork?: Array<string | { dept?: string; staff?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

  // Accept both shapes: WP-format string[] of print staff ids, or legacy
  // {dept,staff}[]. Output: string[] of print staff ids only — matches WP
  // storage convention so cowork data round-trips between v2 and WP.
  const list = Array.isArray(body.cowork) ? body.cowork : [];
  const validPrint = new Set(STAFF.print.map((s) => s.id));
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    let staff = '';
    if (typeof entry === 'string') {
      staff = entry.trim();
    } else if (entry && typeof entry === 'object') {
      const dept = String(entry.dept || '').trim();
      // Reject any non-print dept entry — WP only fans out print
      if (dept && dept !== 'print') {
        return NextResponse.json({ error: `co-work รองรับเฉพาะแผนกพิมพ์ — รับ ${dept}` }, { status: 400 });
      }
      staff = String(entry.staff || '').trim();
    }
    if (!staff) continue;
    if (!validPrint.has(staff)) {
      return NextResponse.json({ error: `เครื่อง "${staff}" ไม่ใช่ผู้รับงานในแผนกพิมพ์` }, { status: 400 });
    }
    if (seen.has(staff)) continue;
    seen.add(staff);
    cleaned.push(staff);
  }

  return setCowork(id, cleaned, session.role, session.user);
}

async function setCowork(id: number, cleaned: string[], role: string, user: string): Promise<NextResponse> {
  let found = false;
  try {
    const r = await setCoworkInPostgres({ id, cowork: cleaned });
    found = r.found;
  } catch (err) {
    const msg =
      err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (!found) {
    // Phase 4.2 close-out — no Apps Script fallback (Sheet-only write would
    // never reach Postgres = silent data loss). 409 → client refreshes.
    return NextResponse.json(
      { error: 'งานนี้ไม่อยู่ในระบบแล้ว — refresh หน้าแล้วลองใหม่' },
      { status: 409 },
    );
  }

  // Postgres write succeeded — authoritative, no downstream sync.
  // Card on /board re-renders from Postgres and sees the new cowork
  // immediately.
  await appendAuditToPostgres({
    action: 'setCowork',
    role,
    user,
    targetId: id,
    cowork: cleaned,
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, count: cleaned.length });
}
