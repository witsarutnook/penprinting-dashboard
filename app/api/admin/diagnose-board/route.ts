import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { loadAll } from '@/lib/api';
import { loadAllFromPostgres } from '@/lib/api-postgres';
import { computeBoard, coworkPrintStaffIds } from '@/lib/board';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Diagnostic — exercises the exact code path /board uses to render a job.
 * Returns the data at each layer so we can pinpoint where stale state
 * leaks in (or doesn't).
 *
 * Usage: GET /api/admin/diagnose-board?id=326
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: 'Pass ?id=<job id>' });
  }

  const result: Record<string, unknown> = {
    jobId: id,
    timestamp: new Date().toISOString(),
  };

  // Layer 1: direct Postgres SQL (same as diagnose-cowork)
  if (isPostgresConfigured()) {
    try {
      const r = await sql<{ cowork: unknown; raw_cowork: unknown; raw: unknown; phase2_dirty_at: string | null }>`
        SELECT cowork, raw->'cowork' AS raw_cowork, raw, phase2_dirty_at::text
        FROM jobs WHERE id = ${id}::bigint
      `;
      result.layer1_postgres_direct = r.rows[0] ?? { found: false };
    } catch (err) {
      result.layer1_postgres_direct = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Layer 2: loadAllFromPostgres (the function /board actually uses
  // when READ_FROM_POSTGRES=1 and the staleness check passes)
  try {
    const snap = await loadAllFromPostgres({ audit: false });
    const job = snap.jobs.find(j => Number(j.id) === id);
    result.layer2_loadAllFromPostgres = job ? {
      id: job.id,
      name: job.name,
      cowork: (job as unknown as Record<string, unknown>).cowork,
      typeof_cowork: typeof (job as unknown as Record<string, unknown>).cowork,
      isArray_cowork: Array.isArray((job as unknown as Record<string, unknown>).cowork),
      coworkPrintStaffIds: coworkPrintStaffIds((job as unknown as Record<string, unknown>).cowork),
    } : { found: false };
  } catch (err) {
    result.layer2_loadAllFromPostgres = {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : null,
    };
  }

  // Layer 3: loadAll (the wrapper /board calls — falls back to Apps Script
  // if Postgres throws PostgresStaleError)
  try {
    const snap = await loadAll();
    const job = snap.jobs.find(j => Number(j.id) === id);
    result.layer3_loadAll_wrapper = job ? {
      id: job.id,
      name: job.name,
      cowork: (job as unknown as Record<string, unknown>).cowork,
      typeof_cowork: typeof (job as unknown as Record<string, unknown>).cowork,
      coworkPrintStaffIds: coworkPrintStaffIds((job as unknown as Record<string, unknown>).cowork),
    } : { found: false };
  } catch (err) {
    result.layer3_loadAll_wrapper = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Layer 4: computeBoard (what /board page passes to Card)
  try {
    const snap = await loadAll();
    const board = computeBoard(snap, {});
    const found = board.allJobs.find(j => Number(j.id) === id);
    result.layer4_computeBoard = found ? {
      id: found.id,
      hasCowork: found.hasCowork,
      cowork: found.cowork,
      typeof_cowork: typeof found.cowork,
      isArray: Array.isArray(found.cowork),
      coworkInline: coworkPrintStaffIds(found.cowork),
    } : { found: false };
  } catch (err) {
    result.layer4_computeBoard = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Layer 5: sync_meta — is the cron sync healthy?
  if (isPostgresConfigured()) {
    try {
      const r = await sql<{ table_name: string; last_sync_at: string; ok: boolean; last_error: string | null; row_count: number }>`
        SELECT table_name, last_sync_at::text, ok, last_error, row_count
        FROM sync_meta
        ORDER BY table_name
      `;
      result.layer5_sync_meta = r.rows;
    } catch (err) {
      result.layer5_sync_meta = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  return NextResponse.json(result);
}
