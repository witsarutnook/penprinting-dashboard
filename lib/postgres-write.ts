import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * Phase 2 — Postgres-as-source-of-truth write handlers. Postgres writes
 * first (authoritative); the heal cron (lib/sync-to-sheet.ts) propagates
 * each change to Sheet so the admin Sheet UI keeps working.
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
 */

class PostgresWriteError extends Error {
  constructor(public action: string, public reason: string) {
    super(`Postgres write ${action} failed: ${reason}`);
    this.name = 'PostgresWriteError';
  }
}

interface AnyRow { [k: string]: unknown }

/** Post-insert read-back guard for the freshly-minted-ID write paths
 *  (§6 / R5 of migration-plan-id-allocation.md).
 *
 *  Every fresh-id INSERT uses `ON CONFLICT (id) DO NOTHING` for idempotent
 *  retries. If the Postgres counter ever mints a duplicate id, DO NOTHING
 *  swallows the INSERT silently and the route still returns success — the
 *  order/job vanishes with no error. Calling the INSERT with `RETURNING id`
 *  lets us tell the two cases apart:
 *   - `inserted.rows` non-empty → a real row was written, nothing to check.
 *   - empty → the id was already taken. A legitimate idempotent retry leaves
 *     an IDENTICAL row (same name + parent order); a minted-ID collision
 *     leaves a DIFFERENT row → throw loudly so the route surfaces it. */
async function assertNoIdCollision(
  op: string,
  table: 'orders' | 'jobs',
  inserted: { rows: unknown[] },
  id: number,
  attempted: { name: string; orderId?: number | null },
): Promise<void> {
  if (inserted.rows.length > 0) return; // row was freshly inserted — no conflict

  let existingName: string | null;
  let existingOrderId: number | null = null;
  if (table === 'orders') {
    const r = await sql<{ name: string | null }>`
      SELECT name FROM orders WHERE id = ${id}::bigint LIMIT 1
    `;
    existingName = r.rows[0]?.name ?? null;
  } else {
    const r = await sql<{ name: string | null; order_id: string | number | null }>`
      SELECT name, order_id FROM jobs WHERE id = ${id}::bigint LIMIT 1
    `;
    existingName = r.rows[0]?.name ?? null;
    const oid = r.rows[0]?.order_id;
    existingOrderId = oid == null ? null : Number(oid);
  }

  const nameMatches = existingName === attempted.name;
  const orderMatches = table === 'orders' || existingOrderId === (attempted.orderId ?? null);
  if (nameMatches && orderMatches) return; // identical row — idempotent retry, fine

  throw new PostgresWriteError(
    op,
    `ID collision on ${table.slice(0, -1)} ${id}: the minted ID was already in use and `
      + `ON CONFLICT DO NOTHING swallowed the write. `
      + `existing=${JSON.stringify({ name: existingName, orderId: existingOrderId })} `
      + `attempted=${JSON.stringify({ name: attempted.name, orderId: attempted.orderId ?? null })}`,
  );
}

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

// ─── createOrder (Phase 2 — atomic 2-table) ──────────────────────

export interface CreateOrderInput {
  /** Pre-allocated orderId from Apps Script `getNextOrderId` — keeps the
   *  per-month YYYYMM+seq pattern that Sheet UI / morning report expect. */
  orderId: number;
  order: {
    name: string;
    customer?: string | null;
    dateIn?: string | null;
    dateDue?: string | null;
    price?: string | number | null;
    assignDept?: string | null;
    assignStaff?: string | null;
    orderer?: string | null;
    status?: string;
    details?: Record<string, unknown> | null;
    rawData?: Record<string, unknown> | null;
  };
  /** Pre-allocated jobId via Apps Script `getNextId`. Null for draft mode. */
  jobId?: number | null;
  job?: {
    name: string;
    date?: string | null;
    dateIn?: string | null;
    staff: string;
    dept: string;
    status?: string;
  } | null;
}

export interface DuplicateOrderHit {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
}

/** Look up still-open orders with matching name+customer — only orders that
 *  are actually in progress (active job on the board, or a draft awaiting
 *  promote). Shipped/finished orders must NOT count: repeat orders from the
 *  same customer are routine and warning on them confuses staff (2026-06-11).
 *
 *  "Shipped" is checked via jobs (no non-tombstoned row left) instead of
 *  orders.status because status isn't reliably updated to 'shipped' — that
 *  state is derived from the shipped table.
 *
 *  Pure orphans (no row in jobs/shipped/cancelled at all — e.g. partial
 *  createOrder failure where the job INSERT threw) still count as open:
 *  a retry after that failure must keep warning instead of silently
 *  minting a second order (audit M1). Returns up to 5 candidates. */
export async function findDuplicateOrdersInPostgres(
  name: string,
  customer: string,
): Promise<DuplicateOrderHit[]> {
  if (!isPostgresConfigured()) return [];
  const n = String(name || '').trim().toLowerCase();
  const c = String(customer || '').trim().toLowerCase();
  if (!n || !c) return [];
  const r = await sql<DuplicateOrderHit>`
    SELECT o.id, o.name, o.customer, COALESCE(o.date_in, '') AS "dateIn"
    FROM orders o
    WHERE LOWER(o.name) = ${n}
      AND LOWER(o.customer) = ${c}
      AND LOWER(COALESCE(o.status, '')) != 'cancelled'
      AND (
        LOWER(COALESCE(o.status, '')) = 'draft'
        OR EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.order_id = o.id
            AND j.phase2_deleted_at IS NULL
        )
        OR (
          NOT EXISTS (SELECT 1 FROM jobs j2 WHERE j2.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM shipped s WHERE s.order_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM cancelled c2 WHERE c2.order_id = o.id)
        )
      )
    ORDER BY o.id DESC
    LIMIT 5
  `;
  return r.rows;
}

/** Phase 2 — atomic-ish INSERT of order (always) + job (optional non-draft).
 *  Both rows carry phase2_dirty_at = NOW() so the heal cron pushes them to
 *  Sheet via setOrderRow + setJobRow within 5 min.
 *
 *  ON CONFLICT (id) DO NOTHING — idempotent retries. Worst-case partial
 *  failure (order succeeded, job INSERT threw): caller surfaces error +
 *  manual retry hits ON CONFLICT DO NOTHING for the order, then succeeds
 *  for the new job. */
export async function createOrderInPostgres(input: CreateOrderInput): Promise<{
  ok: true;
  orderId: number;
  jobId: number | null;
}> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('createOrder', 'POSTGRES_URL env var missing');
  }
  const orderIdNum = Number(input.orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    throw new PostgresWriteError('createOrder', 'Invalid orderId');
  }
  const name = String(input.order.name || '').trim();
  if (!name) throw new PostgresWriteError('createOrder', 'Missing order name');

  const o = input.order;
  const customer = o.customer != null ? String(o.customer) : null;
  const dateIn = o.dateIn != null ? String(o.dateIn) : null;
  const dateDue = o.dateDue != null ? String(o.dateDue) : null;
  const price = o.price != null ? String(o.price) : null;
  const assignDept = o.assignDept != null ? String(o.assignDept) : null;
  const assignStaff = o.assignStaff != null ? String(o.assignStaff) : null;
  const orderer = o.orderer != null ? String(o.orderer) : null;
  const status = String(o.status || 'sent');
  const details = o.details ?? null;
  const rawData = o.rawData ?? null;

  const orderRaw = {
    id: orderIdNum,
    name,
    customer,
    dateIn,
    dateDue,
    price,
    assignDept,
    assignStaff,
    orderer,
    status,
    details,
    rawData,
  };
  const detailsJson = details != null ? JSON.stringify(details) : null;
  const rawDataJson = rawData != null ? JSON.stringify(rawData) : null;
  const orderRawJson = JSON.stringify(orderRaw);

  const orderInsert = await sql<{ id: number }>`
    INSERT INTO orders
      (id, name, customer, date_in, date_due, price, assign_dept, assign_staff,
       orderer, status, details, raw_data, raw, phase2_dirty_at)
    VALUES
      (${orderIdNum}::bigint, ${name}, ${customer}, ${dateIn}, ${dateDue},
       ${price}, ${assignDept}, ${assignStaff}, ${orderer}, ${status},
       ${detailsJson}::jsonb, ${rawDataJson}::jsonb, ${orderRawJson}::jsonb,
       NOW())
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  await assertNoIdCollision('createOrder', 'orders', orderInsert, orderIdNum, { name });

  let jobIdOut: number | null = null;
  if (input.job) {
    // job provided → jobId is required. Catches caller bugs early instead
    // of silently dropping the job row.
    const jobIdNum = Number(input.jobId);
    if (!Number.isFinite(jobIdNum) || jobIdNum <= 0) {
      throw new PostgresWriteError('createOrder', 'Invalid jobId');
    }
    const j = input.job;
    const jName = String(j.name || '').trim();
    if (!jName) throw new PostgresWriteError('createOrder', 'Missing job name');

    const jDate = j.date != null ? String(j.date) : null;
    const jDateIn = j.dateIn != null ? String(j.dateIn) : null;
    const jStaff = String(j.staff);
    const jDept = String(j.dept);
    const jStatus = String(j.status || 'pending');

    const jobRaw = {
      id: jobIdNum,
      name: jName,
      date: jDate,
      dateIn: jDateIn,
      staff: jStaff,
      dept: jDept,
      status: jStatus,
      orderId: orderIdNum,
    };
    const jobRawJson = JSON.stringify(jobRaw);

    const jobInsert = await sql<{ id: number }>`
      INSERT INTO jobs
        (id, order_id, name, date, date_in, staff, dept, status, cowork, raw, phase2_dirty_at)
      VALUES
        (${jobIdNum}::bigint, ${orderIdNum}::bigint, ${jName}, ${jDate}, ${jDateIn},
         ${jStaff}, ${jDept}, ${jStatus}, ${null}::jsonb, ${jobRawJson}::jsonb, NOW())
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    await assertNoIdCollision('createOrder', 'jobs', jobInsert, jobIdNum, { name: jName, orderId: orderIdNum });
    jobIdOut = jobIdNum;
  }

  return { ok: true, orderId: orderIdNum, jobId: jobIdOut };
}

// ─── updateOrder (single UPDATE on orders) ──────────────────────

export interface UpdateOrderInput {
  id: number;
  name?: string;
  customer?: string;
  dateIn?: string | null;
  dateDue?: string | null;
  price?: string | number | null;
  assignDept?: string;
  assignStaff?: string;
  orderer?: string;
  status?: string;
  details?: Record<string, unknown> | null;
  rawData?: Record<string, unknown> | null;
}

/** Phase 2 — single UPDATE on orders with merge-into-raw + dirty mark.
 *  Mirrors updateJobInPostgres for the orders table. Returns found:false
 *  for row-missing fallback to legacy. */
export async function updateOrderInPostgres(input: UpdateOrderInput): Promise<{ ok: true; found: boolean }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('updateOrder', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('updateOrder', 'Invalid order id');
  }

  const cur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM orders WHERE id = ${idNum}::bigint LIMIT 1`;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }
  const oldRaw = (cur.rows[0]?.raw && typeof cur.rows[0].raw === 'object') ? cur.rows[0].raw : {};

  const merged: AnyRow = { ...oldRaw, id: idNum };
  if (input.name !== undefined) merged.name = String(input.name);
  if (input.customer !== undefined) merged.customer = String(input.customer);
  if (input.dateIn !== undefined) merged.dateIn = input.dateIn == null ? null : String(input.dateIn);
  if (input.dateDue !== undefined) merged.dateDue = input.dateDue == null ? null : String(input.dateDue);
  if (input.price !== undefined) merged.price = input.price == null ? null : String(input.price);
  if (input.assignDept !== undefined) merged.assignDept = String(input.assignDept);
  if (input.assignStaff !== undefined) merged.assignStaff = String(input.assignStaff);
  if (input.orderer !== undefined) merged.orderer = String(input.orderer);
  if (input.status !== undefined) merged.status = String(input.status);
  if (input.details !== undefined) merged.details = input.details;
  if (input.rawData !== undefined) merged.rawData = input.rawData;

  const name = String(merged.name || '');
  const customer = merged.customer != null ? String(merged.customer) : null;
  const dateIn = merged.dateIn != null ? String(merged.dateIn) : null;
  const dateDue = merged.dateDue != null ? String(merged.dateDue) : null;
  const price = merged.price != null ? String(merged.price) : null;
  const assignDept = merged.assignDept != null ? String(merged.assignDept) : null;
  const assignStaff = merged.assignStaff != null ? String(merged.assignStaff) : null;
  const orderer = merged.orderer != null ? String(merged.orderer) : null;
  const status = merged.status != null ? String(merged.status) : null;
  const detailsJson = merged.details != null ? JSON.stringify(merged.details) : null;
  const rawDataJson = merged.rawData != null ? JSON.stringify(merged.rawData) : null;
  const newRawJson = JSON.stringify(merged);

  await sql`
    UPDATE orders SET
      name = ${name},
      customer = ${customer},
      date_in = ${dateIn},
      date_due = ${dateDue},
      price = ${price},
      assign_dept = ${assignDept},
      assign_staff = ${assignStaff},
      orderer = ${orderer},
      status = ${status},
      details = ${detailsJson}::jsonb,
      raw_data = ${rawDataJson}::jsonb,
      raw = ${newRawJson}::jsonb,
      phase2_dirty_at = NOW()
    WHERE id = ${idNum}::bigint
  `;
  return { ok: true, found: true };
}

/** Cascade rename — update matching jobs when order name/dateDue changes.
 *  Returns { cascaded, failedJobIds } matching legacy route behavior. */
export async function cascadeRenameJobsInPostgres(
  orderId: number,
  oldName: string,
  newName: string,
  newDateDue: string | null,
  applyNameChange: boolean,
  applyDateChange: boolean,
): Promise<{ cascaded: number; failedJobIds: number[] }> {
  if (!isPostgresConfigured() || (!applyNameChange && !applyDateChange)) {
    return { cascaded: 0, failedJobIds: [] };
  }
  // Match jobs by orderId + oldName (matches legacy filter in route.ts).
  const matching = await sql<{ id: number; raw: AnyRow | null }>`
    SELECT id, raw FROM jobs
    WHERE order_id = ${orderId}::bigint
      AND name = ${oldName}
      AND phase2_deleted_at IS NULL
  `;

  let cascaded = 0;
  const failedJobIds: number[] = [];
  for (const row of matching.rows) {
    try {
      await updateJobInPostgres({
        id: row.id,
        name: applyNameChange ? newName : undefined,
        date: applyDateChange ? newDateDue : undefined,
      });
      cascaded++;
    } catch {
      failedJobIds.push(row.id);
    }
  }
  return { cascaded, failedJobIds };
}

// ─── moveToShipped / cancelJob (atomic 2-table — Phase 2 tombstone) ──

export interface MoveToShippedInput {
  id: number;
  /** Display name — for the shipped row (also used in audit summary). */
  name: string;
  shippedDate: string;
  orderId?: number | string | null;
}

/** Phase 2 — atomic-ish move of jobs row → shipped:
 *  1. INSERT row into shipped (phase2_dirty_at=NOW())
 *  2. Mark jobs.phase2_deleted_at=NOW() (tombstone — heal cron will delete
 *     the Sheet row + hard-delete the Postgres row once that's done)
 *  /board reads filter `phase2_deleted_at IS NULL` so the job hides instantly.
 *  Returns { ok, found } where found=false means the job wasn't in Postgres
 *  (caller falls through to legacy Apps Script). */
export async function moveToShippedInPostgres(input: MoveToShippedInput): Promise<{
  ok: true;
  found: boolean;
}> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('moveToShipped', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('moveToShipped', 'Invalid job id');
  }

  // Need to verify the job exists in Postgres before tombstoning. Returning
  // found:false lets the route fall back to legacy Apps Script (matches the
  // setCowork/updateJob row-missing fallback contract).
  const cur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM jobs WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL LIMIT 1`;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }

  const orderIdRaw = input.orderId == null || input.orderId === '' ? null : Number(input.orderId);
  const orderId = Number.isFinite(orderIdRaw) && orderIdRaw !== 0 ? orderIdRaw : null;
  const name = String(input.name || '').trim();
  const shippedDate = String(input.shippedDate || '');

  const shippedRaw = {
    id: idNum,
    orderId,
    name,
    shippedDate,
  };
  const shippedRawJson = JSON.stringify(shippedRaw);

  await sql`
    INSERT INTO shipped (id, order_id, name, shipped_date, raw, phase2_dirty_at)
    VALUES (${idNum}::bigint, ${orderId}::bigint, ${name}, ${shippedDate}, ${shippedRawJson}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      name = EXCLUDED.name,
      shipped_date = EXCLUDED.shipped_date,
      raw = EXCLUDED.raw,
      phase2_dirty_at = NOW()
  `;
  await sql`UPDATE jobs SET phase2_deleted_at = NOW() WHERE id = ${idNum}::bigint`;

  return { ok: true, found: true };
}

export interface CancelJobInput {
  id: number;
  name: string;
  /** Optional pre-fetched fields. If absent, picks from raw. */
  dept?: string;
  staff?: string;
  reason: string;
  cancelledBy: string;
  cancelledAt: string;
  orderId?: number | string | null;
}

/** Phase 2 — atomic-ish move of jobs row → cancelled. Same shape as
 *  moveToShippedInPostgres, different target table. */
export async function cancelJobInPostgres(input: CancelJobInput): Promise<{
  ok: true;
  found: boolean;
}> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('cancelJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('cancelJob', 'Invalid job id');
  }

  const cur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM jobs WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL LIMIT 1`;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }
  const oldRaw = (cur.rows[0]?.raw && typeof cur.rows[0].raw === 'object') ? cur.rows[0].raw : {};

  const orderIdRaw = input.orderId == null || input.orderId === '' ? null : Number(input.orderId);
  const orderId = Number.isFinite(orderIdRaw) && orderIdRaw !== 0 ? orderIdRaw : null;
  const name = String(input.name || '').trim();
  const dept = input.dept != null ? String(input.dept) : (oldRaw.dept != null ? String(oldRaw.dept) : null);
  const staff = input.staff != null ? String(input.staff) : (oldRaw.staff != null ? String(oldRaw.staff) : null);
  const reason = String(input.reason || '');
  const cancelledBy = String(input.cancelledBy || '');
  const cancelledAt = String(input.cancelledAt || '');

  const cancelledRaw = {
    id: idNum,
    orderId,
    name,
    dept,
    staff,
    cancelledBy,
    cancelledAt,
    reason,
  };
  const cancelledRawJson = JSON.stringify(cancelledRaw);

  await sql`
    INSERT INTO cancelled
      (id, order_id, name, dept, staff, cancelled_by, cancelled_at, reason, raw, phase2_dirty_at)
    VALUES
      (${idNum}::bigint, ${orderId}::bigint, ${name}, ${dept}, ${staff},
       ${cancelledBy}, ${cancelledAt}, ${reason}, ${cancelledRawJson}::jsonb, NOW())
    ON CONFLICT (id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      name = EXCLUDED.name,
      dept = EXCLUDED.dept,
      staff = EXCLUDED.staff,
      cancelled_by = EXCLUDED.cancelled_by,
      cancelled_at = EXCLUDED.cancelled_at,
      reason = EXCLUDED.reason,
      raw = EXCLUDED.raw,
      phase2_dirty_at = NOW()
  `;
  await sql`UPDATE jobs SET phase2_deleted_at = NOW() WHERE id = ${idNum}::bigint`;

  return { ok: true, found: true };
}

// ─── deleteJob (Phase 2 — tombstone) ─────────────────────────────

/** Phase 2 — soft-delete a job via the tombstone column. The heal cron's
 *  healJobsTombstone pushes deleteJobByIdRow to Sheet, then hard-DELETEs
 *  the Postgres row. /board reads filter `phase2_deleted_at IS NULL` so the
 *  card disappears instantly. Returns `found:false` (route falls through to
 *  legacy Apps Script) when the row isn't in the Postgres mirror yet —
 *  matches the moveToShipped/cancelJob row-missing contract. */
export async function deleteJobInPostgres(id: number | string): Promise<{ ok: true; found: boolean }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('deleteJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('deleteJob', 'Invalid job id');
  }

  const cur = await sql<{ id: number }>`
    SELECT id FROM jobs WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL LIMIT 1
  `;
  if (cur.rows.length === 0) {
    return { ok: true, found: false };
  }

  await sql`UPDATE jobs SET phase2_deleted_at = NOW() WHERE id = ${idNum}::bigint`;
  return { ok: true, found: true };
}

// ─── restoreJob (Phase 2 — cancelled → jobs) ─────────────────────

export interface RestoreJobInput {
  id: number | string;
  name: string;
  dept: string;
  staff: string;
  status?: string;
  /** '' / null → orphan (no parent order). */
  orderId?: number | string | null;
  date?: string | null;
  dateIn?: string | null;
}

/** Phase 2 — restore a cancelled job: upsert the jobs row + delete the
 *  cancelled row in Postgres.
 *
 *  The route also calls Apps Script `restoreJob` (which atomically deletes
 *  the cancelled row + appends the jobs row on the Sheet, and writes the
 *  audit entry) — so the restored jobs row is intentionally NOT marked
 *  `phase2_dirty_at`: the Sheet is already in sync, no heal needed.
 *
 *  The ON CONFLICT branch clears `phase2_deleted_at` AND `phase2_dirty_at`:
 *  if the prior cancel's jobs tombstone hasn't been heal-pruned yet, the
 *  upsert would otherwise leave the restored job hidden from /board (which
 *  filters `phase2_deleted_at IS NULL`). */
export async function restoreJobInPostgres(input: RestoreJobInput): Promise<{ ok: true }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('restoreJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(input.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('restoreJob', 'Invalid job id');
  }
  const name = String(input.name || '').trim();
  if (!name) throw new PostgresWriteError('restoreJob', 'Missing job name');

  const orderIdRaw = input.orderId === '' || input.orderId == null ? null : Number(input.orderId);
  const orderId = Number.isFinite(orderIdRaw) && orderIdRaw !== 0 ? orderIdRaw : null;
  const date = input.date == null ? null : String(input.date);
  const dateIn = input.dateIn == null ? null : String(input.dateIn);
  const dept = String(input.dept);
  const staff = String(input.staff);
  const status = String(input.status || 'pending');

  const raw = { id: idNum, name, date, dateIn, dept, staff, status, orderId };
  const rawJson = JSON.stringify(raw);

  await sql`
    INSERT INTO jobs
      (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
    VALUES
      (${idNum}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn},
       ${staff}, ${dept}, ${status}, ${null}::jsonb, ${rawJson}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      name = EXCLUDED.name,
      date = EXCLUDED.date,
      date_in = EXCLUDED.date_in,
      staff = EXCLUDED.staff,
      dept = EXCLUDED.dept,
      status = EXCLUDED.status,
      cowork = EXCLUDED.cowork,
      raw = EXCLUDED.raw,
      phase2_deleted_at = NULL,
      phase2_dirty_at = NULL
  `;
  await sql`DELETE FROM cancelled WHERE id = ${idNum}::bigint`;
  return { ok: true };
}

// ─── promoteDraft (atomic draft→sent + addJob) ────────────────────

export interface PromoteDraftInput {
  /** Pre-allocated job id from Apps Script getNextId. */
  jobId: number;
  orderId: number;
  job: {
    name: string;
    date?: string | null;
    dateIn?: string | null;
    staff: string;
    dept: string;
  };
}

/** Phase 2 promoteDraft — INSERT new job + flip orders.status='sent'.
 *  Verifies order exists + status='draft' before mutating. */
export async function promoteDraftInPostgres(input: PromoteDraftInput): Promise<{
  ok: true;
  orderId: number;
  jobId: number;
  found: boolean;
}> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('promoteDraft', 'POSTGRES_URL env var missing');
  }
  const orderIdNum = Number(input.orderId);
  const jobIdNum = Number(input.jobId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    throw new PostgresWriteError('promoteDraft', 'Invalid orderId');
  }
  if (!Number.isFinite(jobIdNum) || jobIdNum <= 0) {
    throw new PostgresWriteError('promoteDraft', 'Invalid jobId');
  }

  // Verify order exists (don't require status=draft — let caller decide;
  // matches Apps Script lenient semantics).
  const cur = await sql<{ raw: AnyRow | null; status: string | null }>`
    SELECT raw, status FROM orders WHERE id = ${orderIdNum}::bigint LIMIT 1
  `;
  if (cur.rows.length === 0) {
    return { ok: true, orderId: orderIdNum, jobId: jobIdNum, found: false };
  }
  const oldOrderRaw = (cur.rows[0]?.raw && typeof cur.rows[0].raw === 'object') ? cur.rows[0].raw : {};

  const j = input.job;
  const jName = String(j.name || '').trim();
  if (!jName) throw new PostgresWriteError('promoteDraft', 'Missing job name');
  const jDate = j.date != null ? String(j.date) : null;
  const jDateIn = j.dateIn != null ? String(j.dateIn) : null;
  const jStaff = String(j.staff);
  const jDept = String(j.dept);

  const jobRaw = {
    id: jobIdNum,
    name: jName,
    date: jDate,
    dateIn: jDateIn,
    staff: jStaff,
    dept: jDept,
    status: 'pending',
    orderId: orderIdNum,
  };
  const jobRawJson = JSON.stringify(jobRaw);

  const jobInsert = await sql<{ id: number }>`
    INSERT INTO jobs
      (id, order_id, name, date, date_in, staff, dept, status, cowork, raw, phase2_dirty_at)
    VALUES
      (${jobIdNum}::bigint, ${orderIdNum}::bigint, ${jName}, ${jDate}, ${jDateIn},
       ${jStaff}, ${jDept}, 'pending', ${null}::jsonb, ${jobRawJson}::jsonb, NOW())
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  await assertNoIdCollision('promoteDraft', 'jobs', jobInsert, jobIdNum, { name: jName, orderId: orderIdNum });

  // Flip order status draft→sent + mark dirty.
  const newOrderRaw = { ...oldOrderRaw, status: 'sent' };
  const newOrderRawJson = JSON.stringify(newOrderRaw);
  await sql`
    UPDATE orders SET
      status = 'sent',
      raw = ${newOrderRawJson}::jsonb,
      phase2_dirty_at = NOW()
    WHERE id = ${orderIdNum}::bigint
  `;

  return { ok: true, orderId: orderIdNum, jobId: jobIdNum, found: true };
}

// ─── cancelOrder (cascade-cancel jobs + flip order status) ────────

export interface CancelOrderInput {
  orderId: number;
  reason: string;
  cancelledBy: string;
  cancelledAt: string;
}

/** Phase 2 cancelOrder — for every active job of the order:
 *  INSERT cancelled (with phase2_dirty_at) + tombstone job (phase2_deleted_at).
 *  Then flip orders.status='cancelled' + dirty mark.
 *  Returns { cancelledJobs: [id...] } so caller can report cascade count. */
export async function cancelOrderInPostgres(input: CancelOrderInput): Promise<{
  ok: true;
  orderId: number;
  cancelledJobs: number[];
  found: boolean;
}> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('cancelOrder', 'POSTGRES_URL env var missing');
  }
  const orderIdNum = Number(input.orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    throw new PostgresWriteError('cancelOrder', 'Invalid orderId');
  }

  // Verify order exists.
  const orderCur = await sql<{ raw: AnyRow | null }>`SELECT raw FROM orders WHERE id = ${orderIdNum}::bigint LIMIT 1`;
  if (orderCur.rows.length === 0) {
    return { ok: true, orderId: orderIdNum, cancelledJobs: [], found: false };
  }
  const oldOrderRaw = (orderCur.rows[0]?.raw && typeof orderCur.rows[0].raw === 'object') ? orderCur.rows[0].raw : {};

  // Find all active (non-tombstoned) jobs for this order.
  const jobs = await sql<{ id: number; raw: AnyRow | null }>`
    SELECT id, raw FROM jobs
    WHERE order_id = ${orderIdNum}::bigint AND phase2_deleted_at IS NULL
  `;

  const cancelledJobIds: number[] = [];
  for (const row of jobs.rows) {
    const jraw = (row.raw && typeof row.raw === 'object') ? row.raw : {};
    try {
      await cancelJobInPostgres({
        id: row.id,
        name: String(jraw.name || ''),
        dept: jraw.dept != null ? String(jraw.dept) : undefined,
        staff: jraw.staff != null ? String(jraw.staff) : undefined,
        reason: input.reason,
        cancelledBy: input.cancelledBy,
        cancelledAt: input.cancelledAt,
        orderId: orderIdNum,
      });
      cancelledJobIds.push(row.id);
    } catch {
      // Continue — best-effort cascade. Caller surfaces count via return.
    }
  }

  // Flip order status to cancelled.
  const newOrderRaw = { ...oldOrderRaw, status: 'cancelled' };
  const newOrderRawJson = JSON.stringify(newOrderRaw);
  await sql`
    UPDATE orders SET
      status = 'cancelled',
      raw = ${newOrderRawJson}::jsonb,
      phase2_dirty_at = NOW()
    WHERE id = ${orderIdNum}::bigint
  `;

  return { ok: true, orderId: orderIdNum, cancelledJobs: cancelledJobIds, found: true };
}

// ─── bulkForward (Phase 2 — multi-row tombstone + insert) ─────────

export interface BulkForwardItem {
  oldId: number;
  newJob: {
    id: number;
    name: string;
    date?: string | null;
    dateIn?: string | null;
    staff: string;
    dept: string;
    status?: string;
    orderId?: number | string | null;
    /** Pass-through cowork. Forward callers omit it (cowork cleared on
     *  forward); forward-undo passes the pre-forward snapshot's cowork to
     *  restore attached collaborators. */
    cowork?: unknown;
  };
}

export interface BulkForwardResult {
  ok: true;
  succeeded: Array<{ oldId: number; newId: number; name: string }>;
  failed: Array<{ oldId: number; name: string; error: string }>;
}

/** Phase 2 multi-row forward. For each item:
 *  1. Verify oldId exists in Postgres (not tombstoned). If missing, add to
 *     failed[] — caller can fall back to legacy bulkForward Apps Script for
 *     just those items.
 *  2. INSERT newJob (with phase2_dirty_at=NOW(), ON CONFLICT DO NOTHING)
 *  3. Tombstone oldJob (UPDATE jobs SET phase2_deleted_at=NOW())
 *
 *  Best-effort per item — one item's failure doesn't block the others.
 *  Mirrors the Apps Script `bulkForward` semantic from write.ts. */
export async function bulkForwardInPostgres(items: BulkForwardItem[]): Promise<BulkForwardResult> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('bulkForward', 'POSTGRES_URL env var missing');
  }
  const succeeded: BulkForwardResult['succeeded'] = [];
  const failed: BulkForwardResult['failed'] = [];

  for (const item of items) {
    const oldIdNum = Number(item.oldId);
    const newIdNum = Number(item.newJob.id);
    const name = String(item.newJob.name || '').trim();

    if (!Number.isFinite(oldIdNum) || oldIdNum <= 0) {
      failed.push({ oldId: item.oldId, name, error: 'Invalid oldId' });
      continue;
    }
    if (!Number.isFinite(newIdNum) || newIdNum <= 0) {
      failed.push({ oldId: oldIdNum, name, error: 'Invalid newId' });
      continue;
    }
    if (!name) {
      failed.push({ oldId: oldIdNum, name: '', error: 'Missing job name' });
      continue;
    }

    try {
      // Row-missing check — Phase 1.7 straggler not yet in mirror.
      const cur = await sql<{ id: number }>`
        SELECT id FROM jobs
        WHERE id = ${oldIdNum}::bigint AND phase2_deleted_at IS NULL
        LIMIT 1
      `;
      if (cur.rows.length === 0) {
        failed.push({
          oldId: oldIdNum,
          name,
          error: 'Job not in Postgres mirror — wait for sync or retry',
        });
        continue;
      }

      // Build new job row.
      const orderIdRaw = item.newJob.orderId == null || item.newJob.orderId === ''
        ? null
        : Number(item.newJob.orderId);
      const orderId = Number.isFinite(orderIdRaw) && orderIdRaw !== 0 ? orderIdRaw : null;
      const date = item.newJob.date != null ? String(item.newJob.date) : null;
      const dateIn = item.newJob.dateIn != null ? String(item.newJob.dateIn) : null;
      const staff = String(item.newJob.staff);
      const dept = String(item.newJob.dept);
      const status = String(item.newJob.status || 'pending');
      // cowork — forward callers omit it (cleared on forward); forward-undo
      // passes the pre-forward snapshot's cowork to restore collaborators.
      const cowork = item.newJob.cowork ?? null;
      const coworkJson = cowork == null ? null : JSON.stringify(cowork);

      const newRaw = {
        id: newIdNum,
        name,
        date,
        dateIn,
        dept,
        staff,
        status,
        orderId,
        ...(cowork != null ? { cowork } : {}),
      };
      const newRawJson = JSON.stringify(newRaw);

      // INSERT new (with dirty mark) + tombstone old. Two statements, not
      // transactional — retries hit ON CONFLICT DO NOTHING + the tombstone
      // UPDATE is idempotent (NOW() override is fine).
      const jobInsert = await sql<{ id: number }>`
        INSERT INTO jobs
          (id, order_id, name, date, date_in, staff, dept, status, cowork, raw, phase2_dirty_at)
        VALUES
          (${newIdNum}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn},
           ${staff}, ${dept}, ${status}, ${coworkJson}::jsonb, ${newRawJson}::jsonb, NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      // Throw lands in the per-item catch below → collision item goes to
      // failed[] and the old job is NOT tombstoned (next statement skipped).
      await assertNoIdCollision('bulkForward', 'jobs', jobInsert, newIdNum, { name, orderId });
      await sql`UPDATE jobs SET phase2_deleted_at = NOW() WHERE id = ${oldIdNum}::bigint`;

      succeeded.push({ oldId: oldIdNum, newId: newIdNum, name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push({ oldId: oldIdNum, name, error: msg });
    }
  }

  return { ok: true, succeeded, failed };
}

// ─── Phase 2 audit ───────────────────────────────────────────────

export interface AuditInput {
  /** Action name — matches Apps Script audit.ts switch (addJob/updateJob/setCowork/etc) */
  action: string;
  role: string;
  user?: string;
  /** Target id (job/order id) — string or number, normalised to bigint or null */
  targetId?: number | string | null;
  /** Pre-formatted summary. If omitted, generated from action + data via
   *  the same convention as Apps Script appendAudit (audit.ts). */
  summary?: string;
  /** Action body — used for summary generation. Mirrors the body shape
   *  Apps Script doPost passes to appendAudit (data + cowork). */
  data?: { name?: string; dept?: string; staff?: string; reason?: string; [k: string]: unknown };
  cowork?: unknown;
}

/** Format actor as "role:user" when user differs from role — mirrors the
 *  Apps Script appendAudit convention so v2-written and Sheet-written
 *  entries display identically in the history tab. */
function formatActor(role: string, user?: string): string {
  if (!user || user === role) return role;
  return `${role}:${user}`;
}

/** Generate the summary text for an audit entry. Mirrors the switch in
 *  Apps Script audit.ts so Phase 2 audit entries render the same as their
 *  legacy Apps Script counterparts in the v2 history tab. */
function generateAuditSummary(input: AuditInput): string {
  if (input.summary) return input.summary;
  const d = input.data || {};
  const targetId = String(input.targetId ?? '');
  switch (input.action) {
    case 'addJob':        return `เพิ่มงาน "${d.name || ''}" → ${d.dept || ''}/${d.staff || ''}`;
    case 'updateJob':     return `อัพเดตงาน "${d.name || ''}" → ${d.dept || ''}/${d.staff || ''}`;
    case 'deleteJob':     return `ลบงาน id=${targetId}`;
    case 'moveToShipped': return `จัดส่งงาน "${d.name || ''}"`;
    case 'addOrder':      return `สร้างใบสั่งงาน "${d.name || ''}" (ลูกค้า: ${(d.customer as string) || '-'})`;
    case 'updateOrder':   return `แก้ไขใบสั่งงาน #${targetId}`;
    case 'deleteOrder':   return `ลบใบสั่งงาน #${targetId}`;
    case 'setCowork':     return `ตั้ง Co-work job=${targetId}: ${JSON.stringify(input.cowork || [])}`;
    case 'cancelJob':     return `ยกเลิก "${d.name || ''}" — เหตุผล: ${d.reason || ''}`;
    case 'restoreJob':    return `กู้คืน "${d.name || ''}" → ${d.dept || ''}/${d.staff || ''}`;
    default:              return input.action;
  }
}

/** Insert an audit_log entry tagged source='postgres' so the from-Sheet
 *  cron's `DELETE WHERE source='sheet'` doesn't wipe it. Used by Phase 2
 *  routes that bypass Apps Script (where the legacy doPost-side appendAudit
 *  fires automatically). Never throws — audit failure must not break the
 *  user's mutation, mirroring the Apps Script try/catch pattern.
 *
 *  Logs the actual error to Vercel logs + Sentry so silent failures don't
 *  hide a genuine schema/permission issue (the 2026-05-11 bug). */
export async function appendAuditToPostgres(input: AuditInput): Promise<void> {
  if (!isPostgresConfigured()) return;
  try {
    const targetIdNum = input.targetId != null && String(input.targetId).trim()
      ? Number(String(input.targetId).replace(/[^\d]/g, ''))
      : null;
    const targetId = Number.isFinite(targetIdNum) && targetIdNum ? targetIdNum : null;
    const actor = formatActor(input.role, input.user);
    const summary = generateAuditSummary(input);
    await sql`
      INSERT INTO audit_log
        (timestamp, role, user_name, action, target_id, summary, source)
      VALUES
        (NOW(), ${actor}, ${input.user || null}, ${input.action},
         ${targetId}::bigint, ${summary}, 'postgres')
    `;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[phase2-audit] appendAuditToPostgres failed for action=${input.action}:`, msg);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, { tags: { layer: 'phase2-audit', action: input.action } });
    } catch { /* ignore */ }
  }
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
