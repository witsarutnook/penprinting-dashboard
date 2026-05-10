import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Shadow audit endpoint — Postgres version of /api/audit.
 *
 * PoC: kept side-by-side with the Apps Script endpoint so /admin/bench-audit
 * can measure the latency delta on the same query shape. Same auth gate,
 * same params, same response shape — only the data source differs.
 *
 * Once the PoC validates and we commit to migration, this becomes the
 * primary /api/audit and the Apps Script version is dropped.
 */
export interface AuditEntry {
  timestamp: string;
  role: string;
  action: string;
  targetId: string;
  summary: string;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing' },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const jobIdRaw = url.searchParams.get('jobId') || '';
  const orderIdRaw = url.searchParams.get('orderId') || '';
  if (!jobIdRaw && !orderIdRaw) {
    return NextResponse.json({ error: 'Missing jobId or orderId' }, { status: 400 });
  }

  const jobId = jobIdRaw ? Number(jobIdRaw) : null;
  const orderId = orderIdRaw ? Number(orderIdRaw) : null;

  try {
    // Match either jobId or orderId in target_id column. Mirrors the Apps
    // Script `getAuditByTarget` semantics: a job's audit timeline includes
    // both job-level events (target_id = jobId) and order-level events
    // (target_id = orderId) since order lifecycle is recorded against the
    // order row.
    const { rows } = await sql<{
      timestamp: Date;
      role: string | null;
      action: string;
      target_id: string | null;
      summary: string | null;
    }>`
      SELECT timestamp, role, action, target_id::text AS target_id, summary
      FROM audit_log
      WHERE
        (${jobId}::bigint IS NOT NULL AND target_id = ${jobId})
        OR (${orderId}::bigint IS NOT NULL AND target_id = ${orderId})
      ORDER BY timestamp ASC
      LIMIT 200
    `;

    const entries: AuditEntry[] = rows.map(r => ({
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp || ''),
      role: r.role || '',
      action: r.action,
      targetId: r.target_id || '',
      summary: r.summary || '',
    }));

    return NextResponse.json({ entries });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
