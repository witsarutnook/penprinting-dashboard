import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * Phase 2 — Postgres-as-source-of-truth write handlers.
 *
 * Difference vs lib/postgres-write-mirror.ts:
 *  - Mirror = Apps Script writes Sheet first, then mirror-to-Postgres.
 *    Sheet = source of truth. Postgres reflects state with ~ms lag.
 *  - This module = Postgres writes first (authoritative), then a
 *    best-effort Apps Script call propagates the change to Sheet so
 *    admin Sheet UI keeps working. Postgres = source of truth.
 *
 * Per-action rollout — controlled by lib/feature-flags.ts. Each action
 * has its own env var (e.g. WRITE_TEMPLATES_TO_POSTGRES=1) so we can
 * migrate one row type at a time and roll back instantly if anything
 * breaks. Default-off until verified per action.
 *
 * Failure mode contract:
 *  - Postgres write fails → propagate error to caller (user sees toast).
 *  - Apps Script Sheet sync fails → log to Sentry but DO NOT propagate.
 *    Sheet stays drifted; cron sync direction is reversed (Postgres →
 *    Sheet) for migrated tables, so drift heals on the next cron run
 *    once Apps Script is reachable again.
 *
 * Why not put these handlers in postgres-write-mirror.ts? Different
 * semantics — mirror is non-fatal best-effort, this module's writes
 * are authoritative. Two files keeps the mental model clean.
 */

class PostgresWriteError extends Error {
  constructor(public action: string, public reason: string) {
    super(`Postgres write ${action} failed: ${reason}`);
    this.name = 'PostgresWriteError';
  }
}

interface AnyRow { [k: string]: unknown }

// ─── templates ────────────────────────────────────────────────────

export interface AddTemplateInput {
  name: string;
  rawData?: Record<string, unknown> | string;
  createdBy?: string;
}

export interface AddTemplateResult {
  ok: true;
  id: number;
}

/** Insert a new template into Postgres with a Date.now() id (matches the
 *  Apps Script convention so legacy ids and new ids share the same shape).
 *  Caller is responsible for the best-effort Apps Script Sheet sync after
 *  this returns — see api.ts post() flow. */
export async function addTemplateToPostgres(input: AddTemplateInput): Promise<AddTemplateResult> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('addTemplate', 'POSTGRES_URL env var missing');
  }
  const name = String(input.name || '').trim();
  if (!name) throw new PostgresWriteError('addTemplate', 'Missing template name');

  const id = Date.now();
  const rawDataObj =
    typeof input.rawData === 'string'
      ? safeParseJson(input.rawData)
      : input.rawData || {};
  const rawDataStr = JSON.stringify(rawDataObj);
  const createdBy = input.createdBy != null ? String(input.createdBy) : null;
  const createdAt = new Date().toISOString();

  const raw = JSON.stringify({
    id,
    name,
    rawData: rawDataObj,
    createdBy,
    createdAt,
  });

  await sql`
    INSERT INTO templates (id, name, raw_data, created_by, created_at, raw)
    VALUES (${id}::bigint, ${name}, ${rawDataStr}::jsonb, ${createdBy}, ${createdAt}, ${raw}::jsonb)
  `;

  return { ok: true, id };
}

export interface DeleteTemplateResult {
  ok: true;
  found: boolean;
}

/** Delete a template by id from Postgres. `found=false` is a soft no-op —
 *  matches Sheet-side semantics where a missing row also returns "not
 *  found" rather than throwing. Caller can decide whether to surface that
 *  to the user. */
export async function deleteTemplateFromPostgres(id: number | string): Promise<DeleteTemplateResult> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('deleteTemplate', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('deleteTemplate', 'Invalid template id');
  }
  const r = await sql`DELETE FROM templates WHERE id = ${idNum}::bigint`;
  return { ok: true, found: (r.rowCount ?? 0) > 0 };
}

// ─── jobs ────────────────────────────────────────────────────────

export interface SetCoworkInput {
  id: number | string;
  cowork: unknown;  // typically string[] of staff names; null/empty clears
}

/** Phase 2 — atomic UPDATE of jobs.cowork + mark dirty so the heal cron
 *  knows to push the new state to Sheet.
 *
 *  Implementation note: read raw, merge in JS, write full row. Earlier
 *  attempt used jsonb_set inline but the dashboard cards read from
 *  `r.raw` (full snapshot) and we need ALL derived fields (e.g.
 *  `hasCowork`) to follow consistently — easier to just rewrite the
 *  whole raw column with a fresh snapshot than to chase per-field
 *  jsonb_set patches. The 2-statement cost (~30ms) is dwarfed by the
 *  client's network roundtrip. */
export async function setCoworkInPostgres(input: SetCoworkInput): Promise<{ ok: true; found: boolean }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('setCowork', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('setCowork', 'Invalid job id');
  }

  // Read current raw snapshot (from a cron or earlier write). If the row
  // doesn't exist in Postgres yet the route falls through to legacy.
  const cur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM jobs WHERE id = ${idNum}::bigint LIMIT 1`;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }
  const oldRaw = (cur.rows[0]?.raw && typeof cur.rows[0].raw === 'object') ? cur.rows[0].raw : {};
  const cowork = input.cowork == null ? null : input.cowork;
  const newRaw = { ...oldRaw, cowork };
  const coworkJson = cowork == null ? null : JSON.stringify(cowork);
  const newRawJson = JSON.stringify(newRaw);

  await sql`
    UPDATE jobs
    SET cowork = ${coworkJson}::jsonb,
        raw = ${newRawJson}::jsonb,
        phase2_dirty_at = NOW()
    WHERE id = ${idNum}::bigint
  `;
  return { ok: true, found: true };
}

export interface UpdateJobInput {
  id: number | string;
  name?: string;
  date?: string | null;
  dateIn?: string | null;
  dept?: string;
  staff?: string;
  status?: string;
  /** '' or null → orphan (no parent order), otherwise number-coerced. */
  orderId?: string | number | null;
  /** Pass through unchanged when undefined; pass [] (or null) to clear. */
  cowork?: unknown;
}

/** Phase 2 — atomic UPDATE of a job's editable fields + mark dirty. The
 *  caller (route) is responsible for input validation; this function
 *  trusts the payload but defends against missing rows by returning
 *  `found:false` so the route can fall through to the legacy Apps Script
 *  path (matches the setCoworkInPostgres contract).
 *
 *  The merge strategy preserves any raw fields not in `UpdateJobInput`
 *  (e.g. `notes`, `assignedAt`, future schema extensions) so a Phase 2
 *  edit can't accidentally erase data the v2 form doesn't surface yet.
 *
 *  After this returns, the row carries `phase2_dirty_at = NOW()`. The
 *  heal cron (`/api/cron/sync-to-sheet`, every 5 min) will push the new
 *  state to Sheet via `setJobRow` and clear the dirty marker on success. */
export async function updateJobInPostgres(input: UpdateJobInput): Promise<{ ok: true; found: boolean }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('updateJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('updateJob', 'Invalid job id');
  }

  const cur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM jobs WHERE id = ${idNum}::bigint LIMIT 1`;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }

  const oldRaw = (cur.rows[0]?.raw && typeof cur.rows[0].raw === 'object') ? cur.rows[0].raw : {};
  const merged: AnyRow = { ...oldRaw, id: idNum };
  if (input.name !== undefined) merged.name = String(input.name);
  if (input.date !== undefined) merged.date = input.date == null ? null : String(input.date);
  if (input.dateIn !== undefined) merged.dateIn = input.dateIn == null ? null : String(input.dateIn);
  if (input.dept !== undefined) merged.dept = String(input.dept);
  if (input.staff !== undefined) merged.staff = String(input.staff);
  if (input.status !== undefined) merged.status = String(input.status);
  if (input.orderId !== undefined) {
    const oid = input.orderId === '' || input.orderId == null ? null : Number(input.orderId);
    merged.orderId = Number.isFinite(oid) && oid !== 0 ? oid : null;
  }
  if (input.cowork !== undefined) merged.cowork = input.cowork;

  const orderId = merged.orderId != null ? Number(merged.orderId) : null;
  const name = String(merged.name || '');
  const date = merged.date != null ? String(merged.date) : null;
  const dateIn = merged.dateIn != null ? String(merged.dateIn) : null;
  const staff = merged.staff != null ? String(merged.staff) : null;
  const dept = merged.dept != null ? String(merged.dept) : null;
  const status = merged.status != null ? String(merged.status) : null;
  const coworkJson = merged.cowork == null ? null : JSON.stringify(merged.cowork);
  const newRawJson = JSON.stringify(merged);

  await sql`
    UPDATE jobs SET
      order_id = ${orderId}::bigint,
      name = ${name},
      date = ${date},
      date_in = ${dateIn},
      staff = ${staff},
      dept = ${dept},
      status = ${status},
      cowork = ${coworkJson}::jsonb,
      raw = ${newRawJson}::jsonb,
      phase2_dirty_at = NOW()
    WHERE id = ${idNum}::bigint
  `;
  return { ok: true, found: true };
}

export interface AddJobInput {
  /** Pre-allocated id (typically from Apps Script getNextId). Required —
   *  Phase 2 deliberately keeps id allocation in Apps Script so the Sheet
   *  nextId counter stays accurate and ids stay sequential for admin UI. */
  id: number;
  name: string;
  date?: string | null;
  dateIn?: string | null;
  dept: string;
  staff: string;
  status?: string;
  /** '' / null → standalone job (orphan, no parent order). */
  orderId?: string | number | null;
}

/** Phase 2 — atomic INSERT into jobs + mark dirty. The caller (route) is
 *  responsible for input validation and pre-allocating `id` via Apps Script
 *  getNextId so Sheet's nextId counter stays in sync.
 *
 *  Skips the legacy Apps Script `addJob` round-trip (which appends to Sheet
 *  + bumps nextId AGAIN, causing id gaps). The heal cron pushes the new
 *  row to Sheet via `setJobRow` within 5 min, which doesn't touch nextId.
 *  Net result: cleaner sequential ids + ~600ms saved per add.
 *
 *  New jobs start with cowork=null (the form doesn't surface cowork on add)
 *  and phase2_dirty_at=NOW() so the heal cron sees them. */
export async function addJobToPostgres(input: AddJobInput): Promise<{ ok: true; id: number }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('addJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('addJob', 'Invalid job id');
  }
  const name = String(input.name || '').trim();
  if (!name) {
    throw new PostgresWriteError('addJob', 'Missing job name');
  }

  const orderIdRaw = input.orderId === '' || input.orderId == null ? null : Number(input.orderId);
  const orderId = Number.isFinite(orderIdRaw) && orderIdRaw !== 0 ? orderIdRaw : null;
  const date = input.date == null ? null : String(input.date);
  const dateIn = input.dateIn == null ? null : String(input.dateIn);
  const dept = String(input.dept);
  const staff = String(input.staff);
  const status = String(input.status || 'pending');

  const raw = {
    id: idNum,
    name,
    date,
    dateIn,
    dept,
    staff,
    status,
    orderId,
  };
  const rawJson = JSON.stringify(raw);

  await sql`
    INSERT INTO jobs
      (id, order_id, name, date, date_in, staff, dept, status, cowork, raw, phase2_dirty_at)
    VALUES
      (${idNum}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn},
       ${staff}, ${dept}, ${status}, ${null}::jsonb, ${rawJson}::jsonb, NOW())
  `;
  return { ok: true, id: idNum };
}

// ─── dirty row helpers ───────────────────────────────────────────

export type DirtyTable = 'jobs' | 'orders' | 'shipped' | 'cancelled';

/** Clear phase2_dirty_at after Apps Script Sheet sync confirms. Sheet now
 *  matches Postgres for this row, so the next from-Sheet cron can treat
 *  it normally (overwrite if Sheet drifts). */
export async function markRowClean(table: DirtyTable, id: number | string): Promise<void> {
  if (!isPostgresConfigured()) return;
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) return;
  // Tablename can't be parameterised in the @vercel/postgres tagged-template
  // helper, so build the query string. table is constrained by the union
  // type above so this isn't a SQL-injection vector.
  await sql.query(
    `UPDATE ${table} SET phase2_dirty_at = NULL WHERE id = $1::bigint`,
    [idNum],
  );
}

/** Re-mark a row as dirty (e.g. heal cron retry after transient Sheet
 *  failure). Idempotent — sets timestamp to NOW() regardless of prior
 *  value. */
export async function markRowDirty(table: DirtyTable, id: number | string): Promise<void> {
  if (!isPostgresConfigured()) return;
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) return;
  await sql.query(
    `UPDATE ${table} SET phase2_dirty_at = NOW() WHERE id = $1::bigint`,
    [idNum],
  );
}

// ─── small util ───────────────────────────────────────────────────

function safeParseJson(s: string): AnyRow {
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as AnyRow) : {};
  } catch {
    return {};
  }
}

export { PostgresWriteError };
