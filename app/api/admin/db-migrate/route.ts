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

    // ─── Phase 2 audit_log source column ──────────────────────────
    // Distinguishes entries written by the from-Sheet cron ('sheet') from
    // entries written directly by Phase 2 routes ('postgres'). Cron-side
    // refresh deletes only WHERE source='sheet' so Phase 2 entries survive
    // — without this, every TRUNCATE wiped Phase 2 audit visibility.
    {
      const r = await sql.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'audit_log' AND column_name = 'source' LIMIT 1`,
      );
      if (r.rowCount === 0) {
        await sql.query(`ALTER TABLE audit_log ADD COLUMN source TEXT NOT NULL DEFAULT 'sheet'`);
        await sql.query(`CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log(source)`);
        applied.push('ALTER TABLE audit_log ADD source + index');
      }
    }

    // ─── Phase 2 dirty-row tracking ─────────────────────────────
    // phase2_dirty_at = NOT NULL means "row was just written by Phase 2,
    // Sheet is behind and needs heal-cron sync to catch up". The from-
    // Sheet cron must skip these rows (else it would overwrite Phase 2's
    // newer state with Sheet's stale state). The to-Sheet heal cron picks
    // up dirty rows, calls Apps Script setRow, marks clean on success.
    //
    // ALTER IF NOT EXISTS — Postgres doesn't have it, so use information_schema check
    for (const table of ['jobs', 'orders', 'shipped', 'cancelled']) {
      const r = await sql.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'phase2_dirty_at' LIMIT 1`,
        [table],
      );
      if (r.rowCount === 0) {
        await sql.query(`ALTER TABLE ${table} ADD COLUMN phase2_dirty_at TIMESTAMPTZ`);
        await sql.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_phase2_dirty
             ON ${table}(phase2_dirty_at) WHERE phase2_dirty_at IS NOT NULL`,
        );
        applied.push(`ALTER TABLE ${table} ADD phase2_dirty_at + partial index`);
      }
    }

    // ─── Phase 2 tombstone tracking (jobs only for now) ─────────────
    // moveToShipped / cancelJob need to DELETE the row from jobs in Sheet
    // after the row has been moved to shipped/cancelled in Postgres. The
    // tombstone column marks the row as "Sheet still has it but should not
    // — heal cron must call deleteJobByIdRow on Apps Script". On success
    // the row is hard-DELETED from Postgres. Until then, from-Sheet cron
    // skips ids that are tombstoned (else Sheet would re-insert them).
    {
      const r = await sql.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = 'jobs' AND column_name = 'phase2_deleted_at' LIMIT 1`,
      );
      if (r.rowCount === 0) {
        await sql.query(`ALTER TABLE jobs ADD COLUMN phase2_deleted_at TIMESTAMPTZ`);
        await sql.query(
          `CREATE INDEX IF NOT EXISTS idx_jobs_phase2_deleted
             ON jobs(phase2_deleted_at) WHERE phase2_deleted_at IS NOT NULL`,
        );
        applied.push('ALTER TABLE jobs ADD phase2_deleted_at + partial index');
      }
    }

    // ─── Delta-fetch cursor (updated_at) ────────────────────────────
    // Board auto-sync uses `WHERE updated_at > ${lastSync}` to send only
    // changed rows instead of re-rendering the whole board every tick (the
    // PA-H2 / PA-M2 / PA-L1 perf items in AUDIT-BACKLOG). Triggers bump
    // updated_at on real data changes (raw JSONB or tombstone flip) but
    // SKIP housekeeping writes (heal-cron clearing phase2_dirty_at), so
    // the cursor only advances when the client actually needs to repaint.
    //
    // Why not reuse phase2_dirty_at: that column clears back to NULL after
    // a successful Sheet sync — it's a "needs heal" signal, not a "what
    // changed for the user" signal. Delta-fetch needs the latter.
    //
    // Phase 4.2 close-out (2026-05-18 cutover) makes this cursor
    // authoritative: jobs/orders/shipped/cancelled cron is OFF, dual-write
    // mirror is gone, Postgres is sole source of truth. No Sheet edits can
    // leak past the cursor.
    for (const table of ['jobs', 'orders', 'shipped', 'cancelled']) {
      const r = await sql.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'updated_at' LIMIT 1`,
        [table],
      );
      if (r.rowCount === 0) {
        // ADD COLUMN with NOT NULL DEFAULT NOW(): existing rows backfill to
        // ALTER time (one timestamp for the batch — fine, the client will
        // bootstrap with a full snapshot on first load anyway).
        await sql.query(
          `ALTER TABLE ${table} ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,
        );
        await sql.query(
          `CREATE INDEX IF NOT EXISTS idx_${table}_updated_at ON ${table}(updated_at)`,
        );
        applied.push(`ALTER TABLE ${table} ADD updated_at + index`);
      }
    }

    // ─── Bump triggers ──────────────────────────────────────────────
    // Two trigger functions because jobs has a phase2_deleted_at column the
    // others don't. plpgsql resolves column references at first call per
    // table — referencing jobs.phase2_deleted_at in a function attached to
    // orders/shipped/cancelled would error on first row. Split per-table.
    //
    // CREATE OR REPLACE so re-running the migration updates the body in
    // place (no DROP/CREATE dance).
    await sql.query(`
      CREATE OR REPLACE FUNCTION bump_updated_at_jobs()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.raw IS DISTINCT FROM NEW.raw
           OR OLD.phase2_deleted_at IS DISTINCT FROM NEW.phase2_deleted_at THEN
          NEW.updated_at := NOW();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    applied.push('CREATE FUNCTION bump_updated_at_jobs');

    await sql.query(`
      CREATE OR REPLACE FUNCTION bump_updated_at_raw()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.raw IS DISTINCT FROM NEW.raw THEN
          NEW.updated_at := NOW();
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    applied.push('CREATE FUNCTION bump_updated_at_raw');

    // Attach triggers. DROP IF EXISTS first so the migration is rerunnable
    // — Postgres has no CREATE TRIGGER IF NOT EXISTS pre-v14 and the syntax
    // varies; drop-then-create is the portable form.
    for (const [table, fn] of [
      ['jobs', 'bump_updated_at_jobs'],
      ['orders', 'bump_updated_at_raw'],
      ['shipped', 'bump_updated_at_raw'],
      ['cancelled', 'bump_updated_at_raw'],
    ] as const) {
      await sql.query(`DROP TRIGGER IF EXISTS trg_bump_updated_at ON ${table}`);
      await sql.query(`
        CREATE TRIGGER trg_bump_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION ${fn}()
      `);
      applied.push(`CREATE TRIGGER trg_bump_updated_at ON ${table}`);
    }

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
