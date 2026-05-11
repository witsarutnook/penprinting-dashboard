import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Diagnostic for the 2026-05-11 Phase 2 audit-log issue.
 *
 * Surfaces:
 *  - audit_log table column list (proves whether `source` column exists)
 *  - row counts grouped by source (Phase 2 entries vs Sheet entries)
 *  - last 10 audit rows (sanity check the cron + Phase 2 writes)
 *  - rows for a specific target_id when ?id= passed
 *  - sync_meta state for audit_log
 *  - which Phase 2 write flags are currently set
 *
 * Usage: GET /api/admin/diagnose-audit?id=479
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'Postgres not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const targetIdRaw = url.searchParams.get('id');
  const targetId = targetIdRaw ? Number(targetIdRaw) : null;

  // 1. Schema — column list of audit_log
  const colCheck = await sql.query(
    `SELECT column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'audit_log'
     ORDER BY ordinal_position`,
  );
  const columns = (colCheck.rows as Array<{ column_name: string; data_type: string; column_default: string | null }>).map(c => ({
    name: c.column_name,
    type: c.data_type,
    default: c.column_default,
  }));
  const hasSource = columns.some(c => c.name === 'source');

  // 2. Row counts (totals + by-source if column exists)
  const totalR = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM audit_log`;
  const total = totalR.rows[0]?.count ?? 0;

  const countBySource: Record<string, number> = {};
  if (hasSource) {
    try {
      const r = await sql.query(
        `SELECT source, COUNT(*)::int AS count FROM audit_log GROUP BY source`,
      );
      for (const row of r.rows as Array<{ source: string; count: number }>) {
        countBySource[row.source] = row.count;
      }
    } catch (e) {
      countBySource.__error = (e as Error).message as unknown as number;
    }
  }

  // 3. Last 10 rows (any source)
  let recentRows: unknown[] = [];
  try {
    const cols = hasSource
      ? `timestamp, role, action, target_id, summary, source`
      : `timestamp, role, action, target_id, summary`;
    const r = await sql.query(
      `SELECT ${cols} FROM audit_log ORDER BY timestamp DESC LIMIT 10`,
    );
    recentRows = r.rows;
  } catch (e) {
    recentRows = [{ __error: (e as Error).message }];
  }

  // 4. Rows for a specific target_id (if provided)
  let targetRows: unknown[] = [];
  if (targetId && Number.isFinite(targetId)) {
    try {
      const r = await sql.query(
        `SELECT * FROM audit_log WHERE target_id = $1::bigint ORDER BY timestamp DESC LIMIT 20`,
        [targetId],
      );
      targetRows = r.rows;
    } catch (e) {
      targetRows = [{ __error: (e as Error).message }];
    }
  }

  // 5. sync_meta state
  const meta = await sql`SELECT * FROM sync_meta WHERE table_name = 'audit_log'`;

  // 6. Phase 2 flag state
  const flags = {
    WRITE_COWORK_TO_POSTGRES: process.env.WRITE_COWORK_TO_POSTGRES === '1',
    WRITE_UPDATE_JOB_TO_POSTGRES: process.env.WRITE_UPDATE_JOB_TO_POSTGRES === '1',
    WRITE_ADD_JOB_TO_POSTGRES: process.env.WRITE_ADD_JOB_TO_POSTGRES === '1',
    WRITE_TEMPLATES_TO_POSTGRES: process.env.WRITE_TEMPLATES_TO_POSTGRES === '1',
    READ_FROM_POSTGRES: process.env.READ_FROM_POSTGRES === '1',
  };

  return NextResponse.json({
    schemaCheck: {
      hasSource,
      columns,
    },
    rowCounts: {
      total,
      bySource: countBySource,
    },
    recentRows,
    targetRows,
    syncMeta: meta.rows[0] || null,
    flags,
    hint: hasSource
      ? 'source column EXISTS — if Phase 2 audit entries missing, check appendAuditToPostgres call path'
      : '🚨 source column MISSING — code 48a3127 not deployed yet, OR db-migrate ALTER skip query matched a false positive',
  });
}
