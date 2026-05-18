import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF } from '@/lib/board';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { setCoworkInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Set the co-work list (collaborators) for a job — all roles, mirrors WP
 * `setCowork`. Co-work is a workflow attachment (designer asks another for
 * help, multi-station job), not data edit, so it stays open like reassign.
 *
 * Apps Script overwrites the `cowork` column of the job row — pass empty
 * array (or null) to clear all collaborators.
 *
 * Phase 2 — when WRITE_COWORK_TO_POSTGRES=1, Postgres is authoritative
 * and the inline Apps Script Sheet sync is dropped. /board reads from
 * Postgres so the new cowork chip lands instantly (~300ms perceived vs
 * ~1.8s with inline sync). The heal cron `/api/cron/sync-to-sheet`
 * pushes phase2_dirty_at rows to Sheet within 5 min via setJobRow.
 * The from-Sheet cron skips dirty rows so Phase 2 state survives until
 * Sheet catches up. Trade: admin Sheet UI sees up to 5 min stale cowork
 * — acceptable because no external system (LINE webhook, morning report)
 * reads cowork from Sheet.
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

  if (phase2WriteEnabled('setCowork')) {
    return phase2SetCowork(id, cleaned, session.role, session.user);
  }

  try {
    const result = await post<{ ok?: boolean; error?: string }>('setCowork', {
      id,
      cowork: cleaned,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, count: cleaned.length });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function phase2SetCowork(id: number, cleaned: string[], role: string, user: string): Promise<NextResponse> {
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
    // Job id not in Postgres — could be an older row that the from-Sheet
    // cron hasn't synced yet, or a fresh job from a sibling tab whose
    // mirror hasn't propagated. Fall through to legacy Apps Script path
    // (synchronous) so the user's intent still lands on Sheet — the next
    // from-Sheet cron will pick it up into Postgres.
    try {
      const result = await post<{ ok?: boolean; error?: string }>('setCowork', {
        id, cowork: cleaned,
      });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, count: cleaned.length, fallback: 'apps-script' });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  // Postgres write succeeded — the row carries phase2_dirty_at NOT NULL,
  // so the heal cron will push it to Sheet via setJobRow within 5 min.
  // No inline Apps Script call here — that's where the perceived ~1.5s
  // latency was coming from. Card on /board re-renders from Postgres
  // (Phase 1 read mirror) which already sees the new cowork.
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
