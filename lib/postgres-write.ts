import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * §12 (2026-05-27) — Postgres is the SOLE source of truth. These handlers
 * write directly to Postgres and return. There is NO Sheet sync, NO heal
 * cron, NO feature-flag env vars (lib/sync-to-sheet.ts, lib/feature-flags.ts,
 * and all /api/cron/sync-* routes were deleted in §12).
 *
 * ID allocation (§7, 2026-05-25) — the `id` / `orderId` / `jobId` values
 * received by these handlers are minted from the Postgres `counters` table,
 * NOT from Apps Script getNextId / getNextOrderId (both retired in §7).
 *
 * Schema note (§12 Step 2F, 2026-06-16 — phase2_dirty_at removed): the
 * `phase2_dirty_at` "needs push to Sheet" marker (consumed by the retired
 * heal cron) had no operational reader post-§12 and was dropped from
 * jobs/orders/shipped/cancelled together with its partial index and the
 * markRowClean / markRowDirty helpers. Writers no longer touch it.
 *
 * Legacy column still present in the schema:
 *  - `phase2_deleted_at` — LIVE soft-delete tombstone. /board and other
 *    reads filter `phase2_deleted_at IS NULL` so setting it hides the row
 *    instantly. Post-§12 nothing hard-deletes tombstoned rows; soft-delete
 *    is now permanent.
 *
 * Failure mode: Postgres write fails → propagate error to caller (user
 * sees a toast). No downstream sync to worry about.
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
 *  id shape used throughout the schema). Write is authoritative — no
 *  downstream sync after this returns. */
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

/** Atomic UPDATE of jobs.cowork + raw columns. Postgres is authoritative;
 *  no downstream sync.
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

  // Read current raw snapshot. If the row doesn't exist in Postgres,
  // return found:false so the caller can surface a 409 to the client.
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
        raw = ${newRawJson}::jsonb
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

/** Atomic UPDATE of a job's editable fields. Postgres is authoritative;
 *  no downstream sync. The caller (route) is responsible for input
 *  validation; this function trusts the payload but defends against
 *  missing rows by returning `found:false` (matches the setCoworkInPostgres
 *  contract — caller surfaces a 409 to the client).
 *
 *  The merge strategy preserves any raw fields not in `UpdateJobInput`
 *  (e.g. `notes`, `assignedAt`, future schema extensions) so an edit
 *  can't accidentally erase data the v2 form doesn't surface yet. */
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
      raw = ${newRawJson}::jsonb
    WHERE id = ${idNum}::bigint
  `;
  return { ok: true, found: true };
}

export interface AddJobInput {
  /** Pre-allocated id from the Postgres `counters` table (§7 retired
   *  Apps Script getNextId). Required — caller must mint and pass it. */
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

/** Atomic INSERT into jobs. Postgres is authoritative; no downstream sync.
 *  The caller (route) is responsible for input validation and pre-allocating
 *  `id` from the Postgres `counters` table (§7 retired Apps Script getNextId).
 *
 *  New jobs start with cowork=null (the form doesn't surface cowork on add). */
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
      (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
    VALUES
      (${idNum}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn},
       ${staff}, ${dept}, ${status}, ${null}::jsonb, ${rawJson}::jsonb)
  `;
  return { ok: true, id: idNum };
}

// ─── createOrder (Phase 2 — atomic 2-table) ──────────────────────

export interface CreateOrderInput {
  /** Pre-allocated orderId from the Postgres `counters` table (§7 retired
   *  Apps Script getNextOrderId) — keeps the per-month YYYYMM+seq pattern
   *  that the morning report expects. */
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
  /** Pre-allocated jobId from the Postgres `counters` table (§7 retired
   *  Apps Script getNextId). Null for draft mode (no initial job). */
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
  /** Why this match is still "open" — drives the dialog badge so staff can
   *  tell a forgotten draft from a live production order (audit L5):
   *   - 'draft'  : order saved as draft, never promoted
   *   - 'active' : has a live job on the board (phase2_deleted_at IS NULL)
   *   - 'orphan' : no job/shipped/cancelled row (partial createOrder failure) */
  kind: 'draft' | 'active' | 'orphan';
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
    SELECT o.id, o.name, o.customer, COALESCE(o.date_in, '') AS "dateIn",
      CASE
        WHEN LOWER(COALESCE(o.status, '')) = 'draft' THEN 'draft'
        WHEN EXISTS (
          SELECT 1 FROM jobs j WHERE j.order_id = o.id AND j.phase2_deleted_at IS NULL
        ) THEN 'active'
        ELSE 'orphan'
      END AS kind
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

/** Atomic-ish INSERT of order (always) + job (optional, omitted for drafts).
 *  Postgres is authoritative; no downstream sync.
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
       orderer, status, details, raw_data, raw)
    VALUES
      (${orderIdNum}::bigint, ${name}, ${customer}, ${dateIn}, ${dateDue},
       ${price}, ${assignDept}, ${assignStaff}, ${orderer}, ${status},
       ${detailsJson}::jsonb, ${rawDataJson}::jsonb, ${orderRawJson}::jsonb)
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
        (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
      VALUES
        (${jobIdNum}::bigint, ${orderIdNum}::bigint, ${jName}, ${jDate}, ${jDateIn},
         ${jStaff}, ${jDept}, ${jStatus}, ${null}::jsonb, ${jobRawJson}::jsonb)
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

/** Phase 2 — single UPDATE on orders with merge-into-raw.
 *  Mirrors updateJobInPostgres for the orders table. Returns found:false
 *  when the row is missing (caller surfaces a 409). */
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
      raw = ${newRawJson}::jsonb
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

/** Move a jobs row → shipped. Postgres is authoritative; no downstream sync.
 *
 *  Race-safe shape (audit H3, 2026-07-21): the CONDITIONAL tombstone runs
 *  FIRST and doubles as the gate. Statement-level atomicity means that of two
 *  racing transitions on the same id (ship∥ship, ship∥forward, ship∥cancel)
 *  exactly one matches `phase2_deleted_at IS NULL` and wins; the loser gets
 *  rowCount 0 → found:false → caller surfaces a 409. The old shape (SELECT
 *  check → INSERT → unconditional tombstone) let both racers pass the check
 *  and land the job in two terminal tables at once.
 *
 *  If the shipped INSERT then fails, the tombstone is compensated
 *  (un-tombstoned) so the job never silently vanishes with no terminal row.
 *  /board reads filter `phase2_deleted_at IS NULL` so the card hides
 *  instantly on the winning path. */
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

  // Gate: conditional tombstone — the single atomic statement that decides
  // which competing transition wins. 0 rows → missing OR already
  // shipped/cancelled/deleted/forwarded → found:false (caller surfaces 409,
  // matching the setCowork/updateJob row-missing contract).
  const gate = await sql<{ id: number }>`
    UPDATE jobs SET phase2_deleted_at = NOW()
    WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL
    RETURNING id
  `;
  if (gate.rows.length === 0) {
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

  try {
    await sql`
      INSERT INTO shipped (id, order_id, name, shipped_date, raw)
      VALUES (${idNum}::bigint, ${orderId}::bigint, ${name}, ${shippedDate}, ${shippedRawJson}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        name = EXCLUDED.name,
        shipped_date = EXCLUDED.shipped_date,
        raw = EXCLUDED.raw
    `;
  } catch (err) {
    // Compensate: revive the source row so a failed INSERT doesn't leave the
    // job invisible with no terminal row. Best-effort — if this also fails
    // the DB is down and the original error is what matters.
    try {
      await sql`UPDATE jobs SET phase2_deleted_at = NULL WHERE id = ${idNum}::bigint`;
    } catch { /* surface the original error */ }
    throw err;
  }

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

/** Phase 2 — move of jobs row → cancelled. Same race-safe gate-first shape as
 *  moveToShippedInPostgres (audit H3, 2026-07-21), different target table.
 *  The gate's RETURNING raw also feeds the dept/staff inheritance — no
 *  separate SELECT needed. */
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

  // Gate: conditional tombstone (see moveToShippedInPostgres for the race
  // rationale). RETURNING raw replaces the old pre-check SELECT.
  const gate = await sql<{ raw: AnyRow | null }>`
    UPDATE jobs SET phase2_deleted_at = NOW()
    WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL
    RETURNING raw
  `;
  if (gate.rows.length === 0) {
    return { ok: true, found: false };
  }
  const oldRaw = (gate.rows[0]?.raw && typeof gate.rows[0].raw === 'object') ? gate.rows[0].raw : {};

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

  try {
    await sql`
      INSERT INTO cancelled
        (id, order_id, name, dept, staff, cancelled_by, cancelled_at, reason, raw)
      VALUES
        (${idNum}::bigint, ${orderId}::bigint, ${name}, ${dept}, ${staff},
         ${cancelledBy}, ${cancelledAt}, ${reason}, ${cancelledRawJson}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        name = EXCLUDED.name,
        dept = EXCLUDED.dept,
        staff = EXCLUDED.staff,
        cancelled_by = EXCLUDED.cancelled_by,
        cancelled_at = EXCLUDED.cancelled_at,
        reason = EXCLUDED.reason,
        raw = EXCLUDED.raw
    `;
  } catch (err) {
    // Compensate: revive the source row (see moveToShippedInPostgres).
    try {
      await sql`UPDATE jobs SET phase2_deleted_at = NULL WHERE id = ${idNum}::bigint`;
    } catch { /* surface the original error */ }
    throw err;
  }

  return { ok: true, found: true };
}

// ─── deleteJob (Phase 2 — tombstone) ─────────────────────────────

/** Soft-delete a job via the tombstone column. Postgres is authoritative;
 *  no downstream sync. /board reads filter `phase2_deleted_at IS NULL` so
 *  the card disappears instantly. Post-§12 the tombstone is permanent —
 *  nothing hard-deletes tombstoned rows.
 *
 *  One CONDITIONAL statement (audit H3, 2026-07-21) — the old SELECT-then-
 *  unconditional-UPDATE pair was a race window vs. concurrent transitions.
 *  Returns `found:false` when nothing matched (row missing OR already
 *  transitioned) — caller surfaces a 409 (matches the moveToShipped/
 *  cancelJob row-missing contract). */
export async function deleteJobInPostgres(id: number | string): Promise<{ ok: true; found: boolean }> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('deleteJob', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('deleteJob', 'Invalid job id');
  }

  const gate = await sql<{ id: number }>`
    UPDATE jobs SET phase2_deleted_at = NOW()
    WHERE id = ${idNum}::bigint AND phase2_deleted_at IS NULL
    RETURNING id
  `;
  return { ok: true, found: gate.rows.length > 0 };
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

/** Restore a cancelled job: upsert the jobs row + delete the cancelled row
 *  in Postgres. Postgres is authoritative; no downstream sync.
 *
 *  The ON CONFLICT branch clears phase2_deleted_at: if the prior cancel's
 *  tombstone is still present, the upsert would otherwise leave the restored
 *  job hidden from /board (which filters `phase2_deleted_at IS NULL`). */
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
      phase2_deleted_at = NULL
  `;
  await sql`DELETE FROM cancelled WHERE id = ${idNum}::bigint`;
  return { ok: true };
}

// ─── promoteDraft (atomic draft→sent + addJob) ────────────────────

export interface PromoteDraftInput {
  /** Pre-allocated job id from the Postgres `counters` table (§7 retired
   *  Apps Script getNextId). */
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

/** Phase 2 promoteDraft — race-safe gate-first shape (audit
 *  M-promote-draft-double-submit, 2026-07-21). The draft→sent flip is the
 *  CONDITIONAL first statement (`WHERE status = 'draft'`): of N racing
 *  promotes exactly one wins the flip; losers get 0 rows → probe whether
 *  the order exists at all → `alreadyPromoted` (caller surfaces 409) or
 *  `found:false`. The old shape (SELECT check → INSERT job → unconditional
 *  flip) let two racers pass the route's job-existence read and mint two
 *  initial jobs for one order.
 *
 *  If the job INSERT then fails (SQL error / ID collision), the flip is
 *  compensated back to 'draft' so the draft never silently becomes a
 *  jobless 'sent' order. Note the gate now REQUIRES status='draft' — the
 *  pre-2026-07-21 lenient "let caller decide" semantics are gone (the only
 *  caller, /api/orders/promote-draft, already enforced draft-only). */
export async function promoteDraftInPostgres(input: PromoteDraftInput): Promise<{
  ok: true;
  orderId: number;
  jobId: number;
  found: boolean;
  alreadyPromoted: boolean;
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

  const j = input.job;
  const jName = String(j.name || '').trim();
  if (!jName) throw new PostgresWriteError('promoteDraft', 'Missing job name');
  const jDate = j.date != null ? String(j.date) : null;
  const jDateIn = j.dateIn != null ? String(j.dateIn) : null;
  const jStaff = String(j.staff);
  const jDept = String(j.dept);

  // Gate: conditional draft→sent flip — the single atomic statement that
  // decides which competing promote wins. raw patched in-SQL so the gate
  // stays one statement (no read-modify-write window).
  const gate = await sql<{ id: number }>`
    UPDATE orders SET
      status = 'sent',
      raw = COALESCE(raw, '{}'::jsonb) || '{"status":"sent"}'::jsonb
    WHERE id = ${orderIdNum}::bigint AND status = 'draft'
    RETURNING id
  `;
  if (gate.rows.length === 0) {
    // Lost the race, or the order never existed — probe to tell the two apart.
    const probe = await sql<{ status: string | null }>`
      SELECT status FROM orders WHERE id = ${orderIdNum}::bigint LIMIT 1
    `;
    if (probe.rows.length === 0) {
      return { ok: true, orderId: orderIdNum, jobId: jobIdNum, found: false, alreadyPromoted: false };
    }
    return { ok: true, orderId: orderIdNum, jobId: jobIdNum, found: true, alreadyPromoted: true };
  }

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

  try {
    const jobInsert = await sql<{ id: number }>`
      INSERT INTO jobs
        (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
      VALUES
        (${jobIdNum}::bigint, ${orderIdNum}::bigint, ${jName}, ${jDate}, ${jDateIn},
         ${jStaff}, ${jDept}, 'pending', ${null}::jsonb, ${jobRawJson}::jsonb)
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `;
    await assertNoIdCollision('promoteDraft', 'jobs', jobInsert, jobIdNum, { name: jName, orderId: orderIdNum });
  } catch (err) {
    // Compensate: un-flip so the draft isn't silently promoted with no job.
    // Best-effort — if this also fails the DB is down and the original
    // error is what matters.
    try {
      await sql`
        UPDATE orders SET
          status = 'draft',
          raw = COALESCE(raw, '{}'::jsonb) || '{"status":"draft"}'::jsonb
        WHERE id = ${orderIdNum}::bigint
      `;
    } catch { /* surface the original error */ }
    throw err;
  }

  return { ok: true, orderId: orderIdNum, jobId: jobIdNum, found: true, alreadyPromoted: false };
}

// ─── cancelOrder (cascade-cancel jobs + flip order status) ────────

export interface CancelOrderInput {
  orderId: number;
  reason: string;
  cancelledBy: string;
  cancelledAt: string;
}

/** Phase 2 cancelOrder — for every active job of the order:
 *  INSERT cancelled + tombstone job (phase2_deleted_at).
 *  Then flip orders.status='cancelled'.
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
      raw = ${newOrderRawJson}::jsonb
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
 *  1. GATE: conditional tombstone of the source row (audit H2, 2026-07-21) —
 *     `UPDATE ... WHERE id=oldId AND phase2_deleted_at IS NULL RETURNING id`.
 *     Statement-level atomicity means that of two racing forwards of the same
 *     job (double-click / two tabs / retry) exactly ONE wins; the loser sees
 *     0 rows → failed[] — instead of both inserting distinct new cards (the
 *     old SELECT-check → INSERT → unconditional-tombstone shape let both
 *     racers through = one source job became two active forwarded jobs).
 *  2. INSERT newJob (ON CONFLICT DO NOTHING + collision read-back guard).
 *     On failure the gate's tombstone is COMPENSATED (un-tombstoned) so a
 *     failed forward leaves the board unchanged.
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
      // Gate: conditional tombstone FIRST — the atomic statement that makes
      // racing forwards mutually exclusive. 0 rows → source missing OR
      // already forwarded/shipped/cancelled by the racing winner.
      const gate = await sql<{ id: number }>`
        UPDATE jobs SET phase2_deleted_at = NOW()
        WHERE id = ${oldIdNum}::bigint AND phase2_deleted_at IS NULL
        RETURNING id
      `;
      if (gate.rows.length === 0) {
        failed.push({
          oldId: oldIdNum,
          name,
          error: 'Job not found or already forwarded — refresh and retry',
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

      // INSERT the new job. On any failure (SQL error / minted-ID collision
      // caught by the read-back guard) compensate the gate's tombstone so a
      // failed forward leaves the board unchanged, then rethrow into the
      // per-item catch → failed[].
      try {
        const jobInsert = await sql<{ id: number }>`
          INSERT INTO jobs
            (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
          VALUES
            (${newIdNum}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn},
             ${staff}, ${dept}, ${status}, ${coworkJson}::jsonb, ${newRawJson}::jsonb)
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        await assertNoIdCollision('bulkForward', 'jobs', jobInsert, newIdNum, { name, orderId });
      } catch (err) {
        try {
          await sql`UPDATE jobs SET phase2_deleted_at = NULL WHERE id = ${oldIdNum}::bigint`;
        } catch { /* surface the original error */ }
        throw err;
      }

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

/** Insert an audit_log entry tagged source='postgres'. Used by all routes
 *  post-§12 (Apps Script is no longer called for mutations, so the legacy
 *  doPost-side appendAudit no longer fires). Never throws — audit failure
 *  must not break the user's mutation.
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
