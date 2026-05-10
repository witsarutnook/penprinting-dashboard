import { NextResponse } from 'next/server';
import { loadAllFresh, AppsScriptError } from '@/lib/api';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 60;

/**
 * One-time jobs import — admin only.
 *
 * Pulls all jobs from Apps Script (loadAllFresh, audit=0) and bulk-inserts
 * into Postgres `jobs`. PoC reset behaviour: TRUNCATE first then INSERT
 * in chunks of 100 via multi-row VALUES — same shape as import-audit-log.
 *
 * The `raw` JSONB column captures the full Sheet row so we don't have to
 * chase schema drift during PoC. Real migration would model every column.
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

  let jobsRows;
  try {
    const data = await loadAllFresh();
    jobsRows = data.jobs || [];
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Apps Script fetch failed: ${msg}` }, { status: 502 });
  }

  if (jobsRows.length === 0) {
    return NextResponse.json({ ok: true, fetched: 0, inserted: 0 });
  }

  try {
    await sql`TRUNCATE TABLE jobs`;
  } catch (err) {
    return NextResponse.json(
      { error: `TRUNCATE failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const CHUNK = 100;
  let inserted = 0;
  const errors: { chunkStart: number; msg: string }[] = [];

  for (let chunkStart = 0; chunkStart < jobsRows.length; chunkStart += CHUNK) {
    const chunk = jobsRows.slice(chunkStart, chunkStart + CHUNK);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    for (const j of chunk) {
      const id = Number(j.id);
      if (!Number.isFinite(id)) continue;
      const orderId = j.orderId != null ? Number(j.orderId) : null;
      const name = String(j.name || '');
      const date = j.date != null ? String(j.date) : null;
      const dateIn = j.dateIn != null ? String(j.dateIn) : null;
      const staff = j.staff != null ? String(j.staff) : null;
      const dept = j.dept != null ? String(j.dept) : null;
      const status = j.status != null ? String(j.status) : null;
      const cowork = j.cowork != null ? JSON.stringify(j.cowork) : null;
      const raw = JSON.stringify(j);

      placeholders.push(
        `($${paramIdx}::bigint, $${paramIdx + 1}::bigint, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}::jsonb, $${paramIdx + 9}::jsonb)`,
      );
      paramIdx += 10;
      values.push(id, orderId, name, date, dateIn, staff, dept, status, cowork, raw);
    }

    if (placeholders.length === 0) continue;

    try {
      const query = `INSERT INTO jobs (id, order_id, name, date, date_in, staff, dept, status, cowork, raw) VALUES ${placeholders.join(', ')}`;
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
    SELECT COUNT(*)::int AS count FROM jobs
  `;

  return NextResponse.json({
    ok: errors.length === 0,
    fetched: jobsRows.length,
    inserted,
    totalAfter: countRows[0]?.count ?? 0,
    chunks: Math.ceil(jobsRows.length / CHUNK),
    errors,
    hint: 'Now revisit /admin/bench-audit — second bench section will appear with loadAll comparison',
  });
}
