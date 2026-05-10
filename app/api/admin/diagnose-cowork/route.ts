import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { phase2WriteEnabled } from '@/lib/feature-flags';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Diagnostic — admin only. Returns the relevant Phase 2 setCowork state
 * for a given job id so we can pinpoint why /board cards aren't updating.
 *
 * Usage: GET /api/admin/diagnose-cowork?id=12345
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const url = new URL(req.url);
  const idParam = url.searchParams.get('id');
  const id = Number(idParam);

  const flags = {
    phase2_setCowork_enabled: phase2WriteEnabled('setCowork'),
    WRITE_COWORK_TO_POSTGRES_raw: process.env.WRITE_COWORK_TO_POSTGRES ?? null,
    READ_FROM_POSTGRES_raw: process.env.READ_FROM_POSTGRES ?? null,
    postgres_configured: isPostgresConfigured(),
  };

  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({
      flags,
      error: 'Pass ?id=<job id> to inspect a specific row',
    });
  }

  if (!isPostgresConfigured()) {
    return NextResponse.json({ flags, error: 'POSTGRES_URL missing' });
  }

  try {
    const r = await sql<{
      id: number;
      name: string;
      cowork: unknown;
      raw_cowork: unknown;
      phase2_dirty_at: string | null;
    }>`
      SELECT id, name, cowork, raw->'cowork' AS raw_cowork, phase2_dirty_at::text
      FROM jobs
      WHERE id = ${id}::bigint
    `;
    const row = r.rows[0] ?? null;
    return NextResponse.json({
      flags,
      jobId: id,
      found: row !== null,
      row,
      hint: row
        ? row.cowork == null && row.raw_cowork == null
          ? 'Both cowork and raw.cowork are null — Phase 2 UPDATE never ran or was overwritten'
          : row.phase2_dirty_at
          ? 'Row is dirty — heal cron should sync to Sheet within 5 min'
          : 'Row is clean — Phase 2 wrote + Sheet sync confirmed'
        : 'Job not in Postgres — would fall through to legacy Apps Script path',
    });
  } catch (err) {
    return NextResponse.json({
      flags,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
