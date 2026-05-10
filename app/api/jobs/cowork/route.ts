import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF } from '@/lib/board';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { setCoworkInPostgres, markRowClean, PostgresWriteError } from '@/lib/postgres-write';

export const maxDuration = 30;

/**
 * Set the co-work list (collaborators) for a job — all roles, mirrors WP
 * `setCowork`. Co-work is a workflow attachment (designer asks another for
 * help, multi-station job), not data edit, so it stays open like reassign.
 *
 * Apps Script overwrites the `cowork` column of the job row — pass empty
 * array (or null) to clear all collaborators.
 *
 * Phase 2 — when WRITE_COWORK_TO_POSTGRES=1, Postgres is authoritative.
 * Path: UPDATE Postgres + mark phase2_dirty_at → best-effort Apps Script
 * setCowork → on success markRowClean. If Apps Script fails, the row
 * stays dirty and the heal cron `/api/cron/sync-to-sheet` retries via
 * `setJobRow` until Sheet catches up. The from-Sheet cron skips dirty
 * rows so the Phase 2 update doesn't get clobbered while waiting.
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
    return phase2SetCowork(id, cleaned);
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

async function phase2SetCowork(id: number, cleaned: string[]): Promise<NextResponse> {
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
    // cron hasn't synced yet. Mark dirty was a no-op in this case (UPDATE
    // affected 0 rows). Fall through to legacy Apps Script path so the
    // user's intent still lands on Sheet, then the next cron pulls it.
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

  // Best-effort inline Sheet sync — fast path. On success we clear the
  // dirty marker so the heal cron doesn't re-process this row. On failure
  // the row stays dirty and the heal cron retries via setJobRow within
  // 5 minutes. Sentry breadcrumb for observability.
  try {
    const result = await post<{ ok?: boolean; error?: string }>('setCowork', {
      id, cowork: cleaned,
    });
    if (result.error) {
      // Apps Script returned an error response — leave row dirty for heal cron
      try {
        const Sentry = await import('@sentry/nextjs');
        Sentry.addBreadcrumb({
          category: 'phase2-sheet-sync',
          level: 'warning',
          message: `setCowork inline sync failed (will retry via heal cron): ${result.error}`,
          data: { jobId: id },
        });
      } catch { /* ignore */ }
    } else {
      await markRowClean('jobs', id);
    }
  } catch (err) {
    // Apps Script unreachable — row stays dirty, heal cron retries
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, {
        tags: { layer: 'phase2-sheet-sync', action: 'setCowork' },
        extra: { jobId: id },
      });
    } catch { /* ignore */ }
  }

  // Cache bust — only /board uses cowork data
  try {
    const { revalidatePath } = await import('next/cache');
    revalidatePath('/board');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, count: cleaned.length });
}
