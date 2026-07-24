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

    // M-jobs-add-guard-race (audit 2026-07-21): 1 active job per order,
    // enforced at the DB — the routes' SELECT pre-checks can't stop
    // concurrent INSERTs (no common row to lock). NULL order_id rows
    // (standalone jobs) never conflict. Guarded: existing duplicate active
    // rows would abort CREATE UNIQUE INDEX mid-migration, so scan first
    // and report instead of dying — fix via /data-doctor then rerun.
    const activeDupes = await sql<{ order_id: number }>`
      SELECT order_id FROM jobs
      WHERE phase2_deleted_at IS NULL AND order_id IS NOT NULL
      GROUP BY order_id HAVING COUNT(*) > 1
    `;
    if (activeDupes.rows.length === 0) {
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_active_order
          ON jobs(order_id) WHERE phase2_deleted_at IS NULL
      `;
      applied.push('CREATE UNIQUE INDEX uq_jobs_active_order');
    } else {
      const ids = activeDupes.rows.map((r) => r.order_id).join(', ');
      applied.push(
        `SKIPPED uq_jobs_active_order — orders with >1 active job: [${ids}] — แก้ด้วย /data-doctor แล้วรัน db-migrate ซ้ำ`,
      );
    }

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
    // Powers fullLists incremental polls from /shipped — without the index,
    // `WHERE imported_at > since` falls back to a seq scan on every poll.
    // Cheap (~ms) at current row counts but degrades as shipped grows.
    await sql`CREATE INDEX IF NOT EXISTS idx_shipped_imported ON shipped(imported_at)`;
    applied.push('CREATE INDEX idx_shipped_imported');

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
    // Powers fullLists incremental polls from /cancelled — see idx_shipped_imported.
    await sql`CREATE INDEX IF NOT EXISTS idx_cancelled_imported ON cancelled(imported_at)`;
    applied.push('CREATE INDEX idx_cancelled_imported');

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

    // ─── §12 Step 2F (2026-06-16): drop dead phase2_dirty_at ────────
    // phase2_dirty_at was the "needs push to Sheet" marker consumed by the
    // heal cron retired in §12. No operational reader survived: the
    // bump_updated_at triggers key off `raw` / `phase2_deleted_at`, NOT
    // this column (verified before drop), and nothing SELECTs/filters it.
    // Writers stopped touching it in the SAME release as this migration —
    // run this only AFTER that deploy is live, else in-flight writes from
    // the old bundle would error on the missing column.
    // Idempotent: a re-run finds the column already gone (rowCount 0) and
    // skips. DROP ... IF EXISTS keeps the index/column drops safe too.
    for (const table of ['jobs', 'orders', 'shipped', 'cancelled']) {
      const r = await sql.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'phase2_dirty_at' LIMIT 1`,
        [table],
      );
      if (r.rowCount === 1) {
        await sql.query(`DROP INDEX IF EXISTS idx_${table}_phase2_dirty`);
        await sql.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS phase2_dirty_at`);
        applied.push(`ALTER TABLE ${table} DROP phase2_dirty_at + partial index`);
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
    // PA-H2 / PA-M2 / PA-L1 perf items in AUDIT-BACKLOG). The
    // bump_updated_at triggers below advance the cursor only when `raw`
    // (real user-visible data) or the phase2_deleted_at tombstone changes,
    // so the client repaints only when it actually needs to.
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

    // ─── counters (Postgres-minted order/job ids) ──────────────────
    // Authoritative since Step 7 retire (2026-05-25). Key/value rows:
    // `nextId` (global job counter) + `orderCounter_YYYYMM` (per-month).
    // Created empty here — SEED separately via /api/admin/seed-id-counters.
    // See migration-plan-id-allocation.md.
    await sql`
      CREATE TABLE IF NOT EXISTS counters (
        key   TEXT PRIMARY KEY,
        value BIGINT NOT NULL
      )
    `;
    applied.push('CREATE TABLE counters');

    // ─── AI Quote Assistant (Phase 1a) ──────────────────────────────
    // ai_quote_sessions = the conversation + lead store (one row per chat).
    // ai_quotes = each compute_quote result produced in a session (history).
    await sql`
      CREATE TABLE IF NOT EXISTS ai_quote_sessions (
        id              SERIAL PRIMARY KEY,
        channel         TEXT NOT NULL DEFAULT 'dashboard',
        conversation    JSONB NOT NULL DEFAULT '[]'::jsonb,
        extracted_spec  JSONB,
        customer_name   TEXT,
        customer_contact TEXT,
        lead_status     TEXT NOT NULL DEFAULT 'ใหม่',
        assigned_to     TEXT,
        converted_order_id INTEGER,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    applied.push('ai_quote_sessions table');

    await sql`
      CREATE TABLE IF NOT EXISTS ai_quotes (
        id           SERIAL PRIMARY KEY,
        session_id   INTEGER NOT NULL REFERENCES ai_quote_sessions(id) ON DELETE CASCADE,
        product_type TEXT NOT NULL,
        spec         JSONB NOT NULL,
        result       JSONB NOT NULL,
        unit_price   NUMERIC NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    applied.push('ai_quotes table');

    await sql`CREATE INDEX IF NOT EXISTS idx_ai_quotes_session ON ai_quotes(session_id)`;
    applied.push('idx_ai_quotes_session');

    // /quote-logs list orders by updated_at DESC on every page view
    // (L-quotelogs-order-by-no-index — added 2026-07-24 while the table is
    // still small, so the sort never degrades as sessions reach thousands).
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ai_quote_sessions_updated
      ON ai_quote_sessions(updated_at DESC)`;
    applied.push('idx_ai_quote_sessions_updated');

    // ─── ai_quote_turn_flags (quote-logs 2026-07-20) ────────────────
    // Tag "AI ตอบผิด" ระดับข้อความ — snapshot role+text กัน turn_index drift
    // (dashboard history โดน trim ที่ 40 turns ได้). ลบ session → flags ตามไป.
    await sql`
      CREATE TABLE IF NOT EXISTS ai_quote_turn_flags (
        id            SERIAL PRIMARY KEY,
        session_id    INTEGER NOT NULL REFERENCES ai_quote_sessions(id) ON DELETE CASCADE,
        turn_index    INTEGER NOT NULL,
        turn_role     TEXT NOT NULL,
        turn_text     TEXT NOT NULL,
        note          TEXT,
        flagged_by    TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(session_id, turn_index)
      )`;
    applied.push('ai_quote_turn_flags table');
    await sql`CREATE INDEX IF NOT EXISTS idx_turn_flags_session ON ai_quote_turn_flags(session_id)`;
    applied.push('idx_turn_flags_session');

    // ─── slip_checks (LINE OA slip-verify metrics) ──────────────────
    // One row per inbound image to the LINE webhook. Lets us measure
    // Thunder quota use: thunder_called=true rows == Thunder API calls.
    // Vercel runtime logs retain only a short window, so persist here to
    // report received-vs-slip counts over weeks. Written best-effort —
    // a failure here never blocks the customer's reply.
    await sql`
      CREATE TABLE IF NOT EXISTS slip_checks (
        id                 BIGSERIAL PRIMARY KEY,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        channel            TEXT,
        looks_like_slip    BOOLEAN NOT NULL,
        thunder_called     BOOLEAN NOT NULL,
        thunder_success    BOOLEAN,
        is_duplicate       BOOLEAN,
        is_account_matched BOOLEAN,
        amount             NUMERIC
      )`;
    applied.push('CREATE TABLE slip_checks');

    await sql`CREATE INDEX IF NOT EXISTS idx_slip_checks_created ON slip_checks(created_at DESC)`;
    applied.push('idx_slip_checks_created');

    // Diagnosability columns (2026-07-23 slip incident): the Haiku pre-filter's
    // raw answer + the full Thunder response per event. Proves WHY a silent
    // drop happened (prefilter_answer) and pins the live Thunder response
    // contract (raw — e.g. whether isAccountMatched is ever present) without
    // relying on Vercel's short log window.
    await sql`ALTER TABLE slip_checks ADD COLUMN IF NOT EXISTS prefilter_answer TEXT`;
    applied.push('slip_checks.prefilter_answer column');
    await sql`ALTER TABLE slip_checks ADD COLUMN IF NOT EXISTS raw JSONB`;
    applied.push('slip_checks.raw column');

    // ─── customer_registrations (LINE group / web token → customer name set) ───
    // ผูก identity (กลุ่ม LINE ของลูกค้า หรือลิงก์ web เฉพาะตัว) เข้ากับชุดชื่อลูกค้า
    // ที่ตรงกับ orders.raw->>'customer' — ใช้ค้นงาน active ทั้งหมดของลูกค้ารายนั้น.
    await sql`
      CREATE TABLE IF NOT EXISTS customer_registrations (
        id            SERIAL PRIMARY KEY,
        customers     TEXT[]      NOT NULL,
        line_group_id TEXT        UNIQUE,
        web_token     TEXT        NOT NULL UNIQUE,
        note          TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_by    TEXT
      )`;
    applied.push('CREATE TABLE customer_registrations');

    await sql`CREATE INDEX IF NOT EXISTS idx_custreg_group ON customer_registrations(line_group_id)`;
    applied.push('idx_custreg_group');

    // กัน seq scan ตอน query orders by customer (loadActiveJobsByCustomer)
    await sql`CREATE INDEX IF NOT EXISTS idx_orders_customer_norm ON orders (LOWER(TRIM(raw->>'customer')))`;
    applied.push('idx_orders_customer_norm');

    // ─── ai_quote_line_modes (Phase 1b-B — LINE customer AI-quote mode) ───
    // 1 row per LINE user. Mode fields are nullable — NULL last_activity_at
    // = not in mode; the same row carries the 24h out-of-mode hint gate
    // (last_hint_at), which must survive mode exits. Expiry is lazy (no
    // cron): modeActive() in lib/ai-quote/line-mode.ts checks the 30-min
    // idle window on the next inbound message.
    // HINT-1 (2026-07-10) adds a third axis: last_staff_reply_at — the 48h
    // staff-conversation suppression window (also cleared-mode takeover marker).
    await sql`
      CREATE TABLE IF NOT EXISTS ai_quote_line_modes (
        channel_user_id     TEXT PRIMARY KEY,
        entered_at          TIMESTAMPTZ,
        last_activity_at    TIMESTAMPTZ,
        session_id          INTEGER REFERENCES ai_quote_sessions(id) ON DELETE SET NULL,
        rounds_no_quote     INT NOT NULL DEFAULT 0,
        last_hint_at        TIMESTAMPTZ,
        last_staff_reply_at TIMESTAMPTZ
      )`;
    applied.push('CREATE TABLE ai_quote_line_modes');

    // M5 owner binding: LINE-channel sessions store their webhook-verified
    // owner; loadSession({ channel, channelUserId }) filters on it (mismatch → not found).
    await sql`ALTER TABLE ai_quote_sessions ADD COLUMN IF NOT EXISTS line_user_id TEXT`;
    applied.push('ai_quote_sessions.line_user_id column');

    // HINT-1 (2026-07-10): staff-activity suppression — staff replied from the
    // Page inbox (Messenger message_echoes) → suppress the out-of-mode hint
    // 48h + clear the mode (takeover). NULL on purpose — no DEFAULT NOW()
    // backfill (that would suppress every existing customer at ALTER time).
    await sql`ALTER TABLE ai_quote_line_modes ADD COLUMN IF NOT EXISTS last_staff_reply_at TIMESTAMPTZ`;
    applied.push('ai_quote_line_modes.last_staff_reply_at column');

    // Quick row counts for confirmation.
    const counts: Record<string, number> = {};
    for (const t of ['audit_log', 'jobs', 'orders', 'shipped', 'cancelled', 'templates', 'ai_quote_sessions', 'ai_quotes', 'ai_quote_turn_flags', 'slip_checks', 'customer_registrations', 'ai_quote_line_modes']) {
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
      hint: 'Schema + indexes ready (idempotent rerun-safe). Postgres is authoritative post-§12 — no Sheet import step; data already lives here.',
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
