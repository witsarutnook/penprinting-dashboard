import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Idempotent schema migration runner — admin only.
 *
 * Run this ONCE after Vercel Postgres is connected to apply the audit_log
 * schema (and any future PoC tables). Safe to re-run; uses CREATE IF NOT
 * EXISTS for tables and indexes.
 *
 * Why an HTTP endpoint vs a CLI script: the developer has a Mac with no
 * direct Postgres tools, and Vercel deployments don't have a shell.
 * Hitting GET /api/admin/db-migrate from a browser triggers the migration
 * inside a serverless function that can already see POSTGRES_URL.
 *
 * After Vercel Postgres is GA-released or if we want versioned migrations,
 * swap this for Drizzle Kit / @vercel/postgres-kysely.
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing — connect Vercel Postgres via Storage tab + redeploy' },
      { status: 500 },
    );
  }

  const applied: string[] = [];
  try {
    // ─── audit_log ──────────────────────────────────────────────
    // Mirrors Sheet `audit_log` (5 cols) with optional user_name added
    // for the per-user audit signing landed in v5.10.1.
    await sql`
      CREATE TABLE IF NOT EXISTS audit_log (
        id          BIGSERIAL PRIMARY KEY,
        timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        role        TEXT,
        user_name   TEXT,
        action      TEXT NOT NULL,
        target_id   BIGINT,
        summary     TEXT
      )
    `;
    applied.push('CREATE TABLE audit_log');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_target
        ON audit_log(target_id, timestamp DESC)
    `;
    applied.push('CREATE INDEX idx_audit_target');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_audit_action
        ON audit_log(action, timestamp DESC)
    `;
    applied.push('CREATE INDEX idx_audit_action');

    // Quick row count for confirmation.
    const { rows } = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count FROM audit_log
    `;

    return NextResponse.json({
      ok: true,
      applied,
      auditLogRowCount: rows[0]?.count ?? 0,
      hint: rows[0]?.count === 0
        ? 'Schema ready. Next: hit /api/admin/import-audit-log to seed from Apps Script'
        : `Schema ready. ${rows[0]?.count} rows already imported`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        applied,
      },
      { status: 500 },
    );
  }
}
