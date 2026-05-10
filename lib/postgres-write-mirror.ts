import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * Dual-write mirror — keeps Postgres in sync with every Apps Script
 * mutation so that Postgres-first reads stay correct without waiting for
 * the next 10-min cron cycle.
 *
 * Pattern: lib/api.ts post() calls Apps Script first (Sheet remains source
 * of truth); on success, fires mirrorWriteToPostgres() which translates
 * the same action into a Postgres INSERT/UPDATE/DELETE. Any drift between
 * Sheet and Postgres self-heals on the next cron sync.
 *
 * Errors are NEVER fatal — a mirror failure logs to Sentry but doesn't
 * propagate to the user (Apps Script write already succeeded). On error
 * we mark sync_meta stale for affected tables so reads fall back to
 * Apps Script until the cron run repairs the mirror.
 *
 * Why dual-write vs Phase 2 (writes go directly to Postgres):
 * - 3-5h work vs 2 weeks
 * - Sheet stays as source of truth → 0% data-loss risk
 * - LINE webhook + R2 backup + admin Sheet UI keep working unchanged
 * - 70-80% of these handlers translate to Phase 2 directly when ready
 */

interface MirrorContext {
  action: string;
  body: Record<string, unknown>;
  response: Record<string, unknown>;
}

export async function mirrorWriteToPostgres(ctx: MirrorContext): Promise<void> {
  if (!isPostgresConfigured()) return;
  try {
    await dispatch(ctx);
  } catch (err) {
    // Mirror failed — fall back gracefully by marking the affected tables
    // stale so reads use Apps Script until the next cron run heals drift.
    try {
      await sql`UPDATE sync_meta SET last_sync_at = NOW() - INTERVAL '1 hour'`;
    } catch {
      // Even sync_meta update failed — Postgres mirror is in trouble. Cron
      // will eventually recover. Log via Sentry so we can investigate.
    }
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.captureException(err, { tags: { layer: 'postgres-mirror', action: ctx.action } });
    } catch { /* ignore */ }
  }
}

async function dispatch(ctx: MirrorContext): Promise<void> {
  const { action, body, response } = ctx;
  switch (action) {
    case 'addJob':
    case 'updateJob':
      await upsertJob(getData(body));
      break;
    case 'deleteJob':
      await deleteJobRow(num(body.id));
      break;
    case 'setCowork':
      await sql`UPDATE jobs SET cowork = ${jsonOrNull(body.cowork)}::jsonb WHERE id = ${num(body.id)}`;
      break;
    case 'cancelJob': {
      const data = getData(body);
      await upsertCancelled(data);
      await deleteJobRow(num(data.id));
      break;
    }
    case 'restoreJob': {
      const data = getData(body);
      await upsertJob(data);
      await deleteCancelledRow(num(data.id));
      break;
    }
    case 'moveToShipped': {
      const data = getData(body);
      await upsertShipped(data);
      await deleteJobRow(num(data.id));
      break;
    }
    case 'bulkForward':
      await mirrorBulkForward(body, response);
      break;
    case 'addOrder':
    case 'updateOrder':
      await upsertOrder(getData(body));
      break;
    case 'deleteOrder':
      await deleteOrderRow(num(body.id));
      break;
    case 'addTemplate':
      await upsertTemplate(getData(body));
      break;
    case 'deleteTemplate':
      await deleteTemplateRow(num(body.id));
      break;
    case 'createOrder':
      await mirrorCreateOrder(body, response);
      break;
    case 'cancelOrder':
      await mirrorCancelOrder(body, response);
      break;
    case 'deleteOrderCascade':
      await mirrorDeleteOrderCascade(body, response);
      break;
    case 'promoteDraft':
      await mirrorPromoteDraft(body, response);
      break;
    // getNextId / getNextIds / getNextOrderId / saveAll / searchArchive — no row state change
    default:
      // Unknown action — no-op. Cron sync will pick up any change Apps Script
      // made for an action we don't know about yet.
      break;
  }
}

// ─── upsert helpers ────────────────────────────────────────────────

interface AnyRow { [k: string]: unknown }

async function upsertJob(j: AnyRow): Promise<void> {
  const id = num(j.id);
  if (!id) return;
  const orderId = j.orderId != null ? num(j.orderId) : null;
  const name = String(j.name || '');
  const date = j.date != null ? String(j.date) : null;
  const dateIn = j.dateIn != null ? String(j.dateIn) : null;
  const staff = j.staff != null ? String(j.staff) : null;
  const dept = j.dept != null ? String(j.dept) : null;
  const status = j.status != null ? String(j.status) : null;
  const cowork = j.cowork != null ? JSON.stringify(j.cowork) : null;
  const raw = JSON.stringify(j);
  await sql`
    INSERT INTO jobs (id, order_id, name, date, date_in, staff, dept, status, cowork, raw)
    VALUES (${id}::bigint, ${orderId}::bigint, ${name}, ${date}, ${dateIn}, ${staff}, ${dept}, ${status}, ${cowork}::jsonb, ${raw}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      name = EXCLUDED.name,
      date = EXCLUDED.date,
      date_in = EXCLUDED.date_in,
      staff = EXCLUDED.staff,
      dept = EXCLUDED.dept,
      status = EXCLUDED.status,
      cowork = EXCLUDED.cowork,
      raw = EXCLUDED.raw
  `;
}

async function deleteJobRow(id: number | null): Promise<void> {
  if (!id) return;
  await sql`DELETE FROM jobs WHERE id = ${id}`;
}

async function upsertOrder(o: AnyRow): Promise<void> {
  const id = num(o.id);
  if (!id) return;
  const name = String(o.name || '');
  const customer = o.customer != null ? String(o.customer) : null;
  const dateIn = o.dateIn != null ? String(o.dateIn) : null;
  const dateDue = o.dateDue != null ? String(o.dateDue) : null;
  const price = o.price != null ? String(o.price) : null;
  const assignDept = o.assignDept != null ? String(o.assignDept) : null;
  const assignStaff = o.assignStaff != null ? String(o.assignStaff) : null;
  const orderer = o.orderer != null ? String(o.orderer) : null;
  const status = o.status != null ? String(o.status) : null;
  const details = o.details != null ? JSON.stringify(o.details) : null;
  const rawData = o.rawData != null ? JSON.stringify(o.rawData) : null;
  const raw = JSON.stringify(o);
  await sql`
    INSERT INTO orders (id, name, customer, date_in, date_due, price, assign_dept, assign_staff, orderer, status, details, raw_data, raw)
    VALUES (${id}::bigint, ${name}, ${customer}, ${dateIn}, ${dateDue}, ${price}, ${assignDept}, ${assignStaff}, ${orderer}, ${status}, ${details}::jsonb, ${rawData}::jsonb, ${raw}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      customer = EXCLUDED.customer,
      date_in = EXCLUDED.date_in,
      date_due = EXCLUDED.date_due,
      price = EXCLUDED.price,
      assign_dept = EXCLUDED.assign_dept,
      assign_staff = EXCLUDED.assign_staff,
      orderer = EXCLUDED.orderer,
      status = EXCLUDED.status,
      details = EXCLUDED.details,
      raw_data = EXCLUDED.raw_data,
      raw = EXCLUDED.raw
  `;
}

async function deleteOrderRow(id: number | null): Promise<void> {
  if (!id) return;
  await sql`DELETE FROM orders WHERE id = ${id}`;
}

async function upsertShipped(s: AnyRow): Promise<void> {
  const id = num(s.id);
  if (!id) return;
  const orderId = s.orderId != null ? num(s.orderId) : null;
  const name = s.name != null ? String(s.name) : null;
  const shippedDate = s.shippedDate != null ? String(s.shippedDate) : null;
  const raw = JSON.stringify(s);
  await sql`
    INSERT INTO shipped (id, order_id, name, shipped_date, raw)
    VALUES (${id}::bigint, ${orderId}::bigint, ${name}, ${shippedDate}, ${raw}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      order_id = EXCLUDED.order_id,
      name = EXCLUDED.name,
      shipped_date = EXCLUDED.shipped_date,
      raw = EXCLUDED.raw
  `;
}

async function upsertCancelled(c: AnyRow): Promise<void> {
  const id = num(c.id);
  if (!id) return;
  const orderId = c.orderId != null ? num(c.orderId) : null;
  const name = c.name != null ? String(c.name) : null;
  const dept = c.dept != null ? String(c.dept) : null;
  const staff = c.staff != null ? String(c.staff) : null;
  const cancelledBy = c.cancelledBy != null ? String(c.cancelledBy) : null;
  const cancelledAt = c.cancelledAt != null ? String(c.cancelledAt) : null;
  const reason = c.reason != null ? String(c.reason) : null;
  const raw = JSON.stringify(c);
  await sql`
    INSERT INTO cancelled (id, order_id, name, dept, staff, cancelled_by, cancelled_at, reason, raw)
    VALUES (${id}::bigint, ${orderId}::bigint, ${name}, ${dept}, ${staff}, ${cancelledBy}, ${cancelledAt}, ${reason}, ${raw}::jsonb)
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
}

async function deleteCancelledRow(id: number | null): Promise<void> {
  if (!id) return;
  await sql`DELETE FROM cancelled WHERE id = ${id}`;
}

async function upsertTemplate(t: AnyRow): Promise<void> {
  const id = num(t.id);
  if (!id) return;
  const name = String(t.name || '');
  const rawData = t.rawData != null ? JSON.stringify(t.rawData) : null;
  const createdBy = t.createdBy != null ? String(t.createdBy) : null;
  const createdAt = t.createdAt != null ? String(t.createdAt) : null;
  const raw = JSON.stringify(t);
  await sql`
    INSERT INTO templates (id, name, raw_data, created_by, created_at, raw)
    VALUES (${id}::bigint, ${name}, ${rawData}::jsonb, ${createdBy}, ${createdAt}, ${raw}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      raw_data = EXCLUDED.raw_data,
      created_by = EXCLUDED.created_by,
      created_at = EXCLUDED.created_at,
      raw = EXCLUDED.raw
  `;
}

async function deleteTemplateRow(id: number | null): Promise<void> {
  if (!id) return;
  await sql`DELETE FROM templates WHERE id = ${id}`;
}

// ─── compound action mirrors ──────────────────────────────────────

async function mirrorBulkForward(body: AnyRow, response: AnyRow): Promise<void> {
  const succeeded = response.succeeded as Array<{ oldId: number | string; newId: number | string; name?: string }> | undefined;
  if (!succeeded) return;
  const items = (body.data as { items?: Array<{ oldId: number | string; newJob?: AnyRow }> } | undefined)?.items || [];
  for (const s of succeeded) {
    const item = items.find(it => String(it.oldId) === String(s.oldId));
    if (!item || !item.newJob) continue;
    // Server-allocated newId might differ from item.newJob.id (which may be 0/undefined)
    const newJobWithId = { ...item.newJob, id: num(s.newId) };
    await deleteJobRow(num(s.oldId));
    await upsertJob(newJobWithId);
  }
}

async function mirrorCreateOrder(body: AnyRow, response: AnyRow): Promise<void> {
  const orderId = num(response.orderId);
  const jobId = response.jobId != null ? num(response.jobId) : null;
  if (!orderId) return;

  const orderPayload = (body.data as { order?: AnyRow } | undefined)?.order;
  const jobPayload = (body.data as { job?: AnyRow | null } | undefined)?.job;

  if (orderPayload) {
    await upsertOrder({ ...orderPayload, id: orderId });
  }
  if (jobPayload && jobId) {
    await upsertJob({ ...jobPayload, id: jobId, orderId });
  }
}

async function mirrorCancelOrder(body: AnyRow, response: AnyRow): Promise<void> {
  const orderId = num(response.orderId);
  if (!orderId) return;
  const reason =
    String((body.data as AnyRow | undefined)?.reason || '') ||
    `ใบสั่งงาน #${orderId} ถูกยกเลิก (cascade)`;
  const cancelledBy = String((body.data as AnyRow | undefined)?.cancelledBy || '');
  const cancelledAt =
    String((body.data as AnyRow | undefined)?.cancelledAt || '') || new Date().toISOString();

  // Cascade — read each cancelled job's data BEFORE delete so we can copy it
  // into the cancelled table. Fall through silently if a job is missing
  // from Postgres (mirror drift). Cron sync will heal.
  const cancelledJobIds = (response.cancelledJobs as Array<number | string> | undefined) || [];
  for (const jobId of cancelledJobIds) {
    const jid = num(jobId);
    if (!jid) continue;
    const r = await sql<{ raw: AnyRow }>`SELECT raw FROM jobs WHERE id = ${jid} LIMIT 1`;
    const job = r.rows[0]?.raw;
    if (job) {
      await upsertCancelled({ ...job, reason, cancelledBy, cancelledAt });
    }
    await deleteJobRow(jid);
  }

  // Flip order status to cancelled
  await sql`
    UPDATE orders
    SET status = 'cancelled',
        raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{status}', '"cancelled"')
    WHERE id = ${orderId}
  `;
}

async function mirrorDeleteOrderCascade(body: AnyRow, response: AnyRow): Promise<void> {
  const orderId = num(response.orderId);
  if (!orderId) return;
  const reason =
    String((body.data as AnyRow | undefined)?.reason || '') ||
    `ใบสั่งงาน #${orderId} ถูกลบ (cascade)`;
  const cancelledBy = String((body.data as AnyRow | undefined)?.cancelledBy || '');
  const cancelledAt =
    String((body.data as AnyRow | undefined)?.cancelledAt || '') || new Date().toISOString();

  const cancelledJobIds = (response.cancelledJobs as Array<number | string> | undefined) || [];
  for (const jobId of cancelledJobIds) {
    const jid = num(jobId);
    if (!jid) continue;
    const r = await sql<{ raw: AnyRow }>`SELECT raw FROM jobs WHERE id = ${jid} LIMIT 1`;
    const job = r.rows[0]?.raw;
    if (job) {
      await upsertCancelled({ ...job, reason, cancelledBy, cancelledAt });
    }
    await deleteJobRow(jid);
  }

  await deleteOrderRow(orderId);
}

async function mirrorPromoteDraft(body: AnyRow, response: AnyRow): Promise<void> {
  const orderId = num(response.orderId);
  const jobId = num(response.jobId);
  if (!orderId || !jobId) return;
  const jobPayload = (body.data as { job?: AnyRow } | undefined)?.job;
  if (jobPayload) {
    await upsertJob({ ...jobPayload, id: jobId, orderId });
  }
  // Flip order status to sent
  await sql`
    UPDATE orders
    SET status = 'sent',
        raw = jsonb_set(COALESCE(raw, '{}'::jsonb), '{status}', '"sent"')
    WHERE id = ${orderId}
  `;
}

// ─── small util ───────────────────────────────────────────────────

function getData(body: AnyRow): AnyRow {
  const d = body.data;
  return d && typeof d === 'object' ? (d as AnyRow) : {};
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function jsonOrNull(v: unknown): string | null {
  if (v == null) return null;
  return JSON.stringify(v);
}
