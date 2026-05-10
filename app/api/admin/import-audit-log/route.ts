import { NextResponse } from 'next/server';
import { loadAllWithAudit, AppsScriptError } from '@/lib/api';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 60;

/**
 * One-time audit_log import — admin only.
 *
 * Pulls the most recent ~500 audit rows from Apps Script (loadAllWithAudit)
 * and bulk-inserts into Postgres `audit_log`. PoC reset behavior: truncates
 * table first, then bulk inserts in chunks of 100 via multi-row VALUES.
 *
 * Why bulk: the previous per-row `INSERT ... WHERE NOT EXISTS` did 500
 * sequential round-trips × ~50-100ms each = 25-50s = past the function
 * timeout. Multi-row VALUES collapses to ~5 round-trips → ~500ms.
 *
 * Re-running this endpoint is safe — TRUNCATE always brings the table
 * back to a known-good state. For a real migration we'd want incremental
 * sync (timestamp watermark, ON CONFLICT DO NOTHING), but PoC scope is
 * "fast and predictable, not robust".
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
    return NextResponse.json({ ok: true, fetched: 0, inserted: 0 });
  }

  // Reset: truncate so re-running the endpoint gives a fresh, predictable state.
  // RESTART IDENTITY resets the BIGSERIAL counter so ids stay small + readable.
  try {
    await sql`TRUNCATE TABLE audit_log RESTART IDENTITY`;
  } catch (err) {
    return NextResponse.json(
      { error: `TRUNCATE failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // Bulk insert in chunks of 100 — 500 rows = 5 round-trips total.
  const CHUNK = 100;
  let inserted = 0;
  const errors: { chunkStart: number; msg: string }[] = [];

  for (let chunkStart = 0; chunkStart < auditRows.length; chunkStart += CHUNK) {
    const chunk = auditRows.slice(chunkStart, chunkStart + CHUNK);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const r of chunk) {
      const tsIso = r.timestamp || new Date().toISOString();
      const role = r.role || null;
      const action = r.action || 'unknown';
      const targetIdNum = r.targetId ? Number(String(r.targetId).replace(/[^\d]/g, '')) : null;
      const targetId = Number.isFinite(targetIdNum) && targetIdNum ? targetIdNum : null;
      const summary = r.summary || null;

      placeholders.push(
        `($${paramIdx}::timestamptz, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}::bigint, $${paramIdx + 4})`,
      );
      paramIdx += 5;
      values.push(tsIso, role, action, targetId, summary);
    }

    try {
      const query = `INSERT INTO audit_log (timestamp, role, action, target_id, summary) VALUES ${placeholders.join(', ')}`;
      const res = await sql.query(query, values);
      inserted += res.rowCount || 0;
    } catch (err) {
      errors.push({
        chunkStart,
        msg: err instanceof Error ? err.message : String(err),
      });
      if (errors.length >= 3) break;
    }
  }

  const { rows: countRows } = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count FROM audit_log
  `;

  return NextResponse.json({
    ok: errors.length === 0,
    fetched: auditRows.length,
    inserted,
    totalAfter: countRows[0]?.count ?? 0,
    chunks: Math.ceil(auditRows.length / CHUNK),
    errors,
    hint: 'Now hit /admin/bench-audit to compare Sheet vs Postgres latency',
  });
}
