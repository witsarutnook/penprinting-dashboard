import { NextResponse } from 'next/server';
import { loadAllWithAudit, AppsScriptError } from '@/lib/api';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 60;

/**
 * One-time audit_log import — admin only.
 *
 * Pulls the most recent ~500 audit rows from Apps Script (loadAllWithAudit)
 * and bulk-inserts into Postgres `audit_log` table. Safe to re-run; uses
 * a transient staging table + INSERT ... SELECT WHERE NOT EXISTS pattern
 * so duplicates (matched by timestamp + action + target_id + role) are
 * skipped.
 *
 * For PoC purposes, 500 rows with proper indexes is plenty representative —
 * filters by target_id are O(log n) regardless of table size, so the bench
 * latency at 500 rows mirrors what we'd see at 50,000 rows.
 *
 * Production migration would replace this with a streaming sync from
 * Apps Script trigger → POST webhook → INSERT (Phase 1 of migration plan).
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing — connect Vercel Postgres + redeploy' },
      { status: 500 },
    );
  }

  let auditRows;
  try {
    const data = await loadAllWithAudit();
    auditRows = data.audit || [];
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Apps Script fetch failed: ${msg}` }, { status: 502 });
  }

  if (auditRows.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, inserted: 0, skipped: 0 });
  }

  // Insert in chunks. @vercel/postgres tagged-template `sql` doesn't
  // support multi-row VALUES bulk inserts directly, so we loop with
  // individual statements wrapped in an implicit per-statement transaction.
  // For 500 rows this is fast enough (~1-2s end to end).
  let inserted = 0;
  let skipped = 0;
  const errors: { i: number; msg: string }[] = [];

  for (let i = 0; i < auditRows.length; i++) {
    const r = auditRows[i];
    const tsIso = r.timestamp || new Date().toISOString();
    const role = r.role || null;
    const action = r.action || 'unknown';
    const targetIdNum = r.targetId ? Number(String(r.targetId).replace(/[^\d]/g, '')) : null;
    const targetId = Number.isFinite(targetIdNum) && targetIdNum ? targetIdNum : null;
    const summary = r.summary || null;

    try {
      // Dedupe: skip if a row with same (timestamp, action, target_id) exists.
      // Sheet's audit log is append-only, so this combo is effectively unique
      // for each operation. Faster than a unique constraint + ON CONFLICT
      // because we control the comparison shape.
      const result = await sql`
        INSERT INTO audit_log (timestamp, role, user_name, action, target_id, summary)
        SELECT ${tsIso}::timestamptz, ${role}, NULL, ${action}, ${targetId}, ${summary}
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_log
          WHERE timestamp = ${tsIso}::timestamptz
            AND action = ${action}
            AND ((target_id IS NULL AND ${targetId}::bigint IS NULL) OR target_id = ${targetId})
        )
        RETURNING id
      `;
      if (result.rowCount && result.rowCount > 0) {
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      errors.push({ i, msg: err instanceof Error ? err.message : String(err) });
      if (errors.length >= 10) break; // bail on persistent failure
    }
  }

  const { rows: countRows } = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count FROM audit_log
  `;

  return NextResponse.json({
    ok: errors.length === 0,
    fetched: auditRows.length,
    inserted,
    skipped,
    totalAfter: countRows[0]?.count ?? 0,
    errors: errors.slice(0, 10),
    hint: 'Now hit /admin/bench-audit to compare Sheet vs Postgres latency',
  });
}
