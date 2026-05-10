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

    // ─── jobs ───────────────────────────────────────────────────
    // Phase 1.5 PoC: mirror Sheet `jobs` to bench loadAll-shaped queries
    // against /board's actual hot path (filter + JSON serialise of ~200 rows
    // × 30+ cols), not just the small audit_log shape.
    //
    // Schema mirrors the Job type (lib/types.ts) — minimal explicit columns
    // for filter/index needs, raw JSONB for everything else so we don't have
    // to chase Sheet schema drift during PoC.
    await sql`
      CREATE TABLE IF NOT EXISTS jobs (
        id          BIGINT PRIMARY KEY,
        order_id    BIGINT,
        name        TEXT NOT NULL,
        date        TEXT,
        date_in     TEXT,
        staff       TEXT,
        dept        TEXT,
        status      TEXT,
        cowork      JSONB,
        raw         JSONB,
        imported_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    applied.push('CREATE TABLE jobs');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_jobs_dept_status
        ON jobs(dept, status)
    `;
    applied.push('CREATE INDEX idx_jobs_dept_status');

    await sql`
      CREATE INDEX IF NOT EXISTS idx_jobs_order_id
        ON jobs(order_id)
    `;
    applied.push('CREATE INDEX idx_jobs_order_id');

    // ─── orders ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS orders (
        id            BIGINT PRIMARY KEY,
        name          TEXT NOT NULL,
        customer      TEXT,
        date_in       TEXT,
        date_due      TEXT,
        price         TEXT,
        assign_dept   TEXT,
        assign_staff  TEXT,
        orderer       TEXT,
        status        TEXT,
        details       JSONB,
        raw_data      JSONB,
        raw           JSONB,
        imported_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    applied.push('CREATE TABLE orders');

    await sql`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`;
    applied.push('CREATE INDEX idx_orders_status');
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(LOWER(customer))`;
    applied.push('CREATE INDEX idx_orders_customer');

    // ─── shipped ────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS shipped (
        id            BIGINT PRIMARY KEY,
        order_id      BIGINT,
        name          TEXT,
        shipped_date  TEXT,
        raw           JSONB,
        imported_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    applied.push('CREATE TABLE shipped');
    await sql`CREATE INDEX IF NOT EXISTS idx_shipped_order ON shipped(order_id)`;
    applied.push('CREATE INDEX idx_shipped_order');

    // ─── cancelled ──────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS cancelled (
        id            BIGINT PRIMARY KEY,
        order_id      BIGINT,
        name          TEXT,
        dept          TEXT,
        staff         TEXT,
        cancelled_by  TEXT,
        cancelled_at  TEXT,
        reason        TEXT,
        raw           JSONB,
        imported_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    applied.push('CREATE TABLE cancelled');
    await sql`CREATE INDEX IF NOT EXISTS idx_cancelled_order ON cancelled(order_id)`;
    applied.push('CREATE INDEX idx_cancelled_order');

    // ─── templates ──────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS templates (
        id            BIGINT PRIMARY KEY,
        name          TEXT NOT NULL,
        raw_data      JSONB,
        created_by    TEXT,
        created_at    TEXT,
        raw           JSONB,
        imported_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    applied.push('CREATE TABLE templates');

    // ─── sync_meta ──────────────────────────────────────────────
    // Tracks last successful sync per table — UI surfaces this so admin
    // knows whether Postgres reads are stale. Cron updates after each
    // successful TRUNCATE+INSERT pass.
    await sql`
      CREATE TABLE IF NOT EXISTS sync_meta (
        table_name    TEXT PRIMARY KEY,
        last_sync_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        row_count     INT,
        ok            BOOLEAN DEFAULT TRUE,
        last_error    TEXT
      )
    `;
    applied.push('CREATE TABLE sync_meta');

    // Quick row counts for confirmation.
    const counts: Record<string, number> = {};
    for (const t of ['audit_log', 'jobs', 'orders', 'shipped', 'cancelled', 'templates']) {
      try {
        const r = await sql.query(`SELECT COUNT(*)::int AS count FROM ${t}`);
        counts[t] = (r.rows[0] as { count?: number })?.count ?? 0;
      } catch {
        counts[t] = -1;
      }
    }

    return NextResponse.json({
      ok: true,
      applied,
      counts,
      hint: 'Schema ready. Next: hit /api/admin/sync-all to import all tables in one shot',
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
