import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import type {
  Order, Job, Shipped, Cancelled, AuditEntry, Template, LoadAllResponse,
} from '@/lib/types';
import type { LoadOrderResponse } from '@/lib/api';

/**
 * Postgres-flavored read API — same shape as `lib/api.ts` so the caller
 * can swap in/out without changing downstream code.
 *
 * Post §12 (2026-05-28): Postgres is the source of truth — there is no
 * Sheet→Postgres "mirror" cron and no `sync_meta` freshness gate. Every
 * write path in `lib/postgres-write.ts` commits to Postgres synchronously
 * before responding to the client, so reads are immediately fresh.
 *
 * Throws `PostgresReadError` when Postgres isn't configured (env vars
 * missing) or a requested row isn't found — caller renders an error UI.
 */

export class PostgresReadError extends Error {
  constructor(reason: string) {
    super(`Postgres read failed: ${reason}`);
    this.name = 'PostgresReadError';
  }
}

/** Load full snapshot from Postgres — same shape as the legacy Apps Script
 *  loadAll. Set `audit: false` to skip the 500-row audit_log scan (saves
 *  ~50-100KB on board/orders/calendar reads — only /analytics needs it). */
export async function loadAllFromPostgres(opts: { audit?: boolean } = {}): Promise<LoadAllResponse> {
  if (!isPostgresConfigured()) throw new PostgresReadError('not configured');

  // Parallel SELECT — Postgres connection pool handles. ~20-50ms total
  // because each table read is independent + small for our row counts.
  const [jobsR, ordersR, shippedR, cancelledR, templatesR, auditR] = await Promise.all([
    sql<{ raw: Job }>`SELECT raw FROM jobs WHERE phase2_deleted_at IS NULL ORDER BY id`,
    sql<{ raw: Order }>`SELECT raw FROM orders ORDER BY id DESC`,
    sql<{ raw: Shipped }>`SELECT raw FROM shipped ORDER BY id DESC`,
    sql<{ raw: Cancelled }>`SELECT raw FROM cancelled ORDER BY id DESC`,
    sql<{ raw: Template }>`SELECT raw FROM templates ORDER BY id`,
    opts.audit !== false
      ? sql<{ timestamp: Date; role: string | null; action: string; target_id: string | null; summary: string | null }>`
          SELECT timestamp, role, action, target_id::text AS target_id, summary
          FROM audit_log ORDER BY timestamp DESC LIMIT 500
        `
      : Promise.resolve({ rows: [] as { timestamp: Date; role: string | null; action: string; target_id: string | null; summary: string | null }[] }),
  ]);

  const jobs = jobsR.rows.map(r => r.raw);
  const orders = ordersR.rows.map(r => r.raw);
  const shipped = shippedR.rows.map(r => r.raw);
  const cancelled = cancelledR.rows.map(r => r.raw);
  const templates = templatesR.rows.map(r => r.raw);
  const audit: AuditEntry[] = auditR.rows.map(r => ({
    timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp || ''),
    role: r.role || '',
    action: r.action,
    targetId: r.target_id || '',
    summary: r.summary || '',
  })).reverse(); // chronological asc to match the legacy Apps Script shape

  // nextId stays 0 — the dashboard mints job/order ids via Postgres counters
  // (lib/id-allocation.ts, retired Apps Script `getNextId` 2026-05-25). The
  // legacy `loadAll` response shape included it so the WP UI could pre-render
  // the next id; no v2 caller reads this field.
  return {
    jobs,
    orders,
    shipped,
    cancelled,
    audit,
    nextId: 0,
    templates,
  };
}

/** Single-order lookup. Mirrors lib/api.ts loadOrder shape.
 *
 *  Every write path that touches an order or its jobs commits to Postgres
 *  before responding, so the Postgres row IS the source of truth for any
 *  order id — no `sync_meta` gate, no Apps Script fallback. The only
 *  fallback signal that matters is "order not in Postgres at all"
 *  (row-not-found throw below). The 2026-05-12 loadOrder refactor removed
 *  a stale `checkStaleness(['orders'])` pre-gate that was causing brand-new
 *  Phase 2 orders to print-page-404 during cron hiccups; the same anti-pattern
 *  applies here. */
export async function loadOrderFromPostgres(
  orderId: number | string,
  opts: { orderOnly?: boolean } = {},
): Promise<LoadOrderResponse> {
  if (!isPostgresConfigured()) throw new PostgresReadError('not configured');
  const id = Number(orderId);
  if (!Number.isFinite(id) || !id) throw new Error('Invalid orderId');

  // orderOnly — callers that render only the order row (print page,
  // tracking-card, /api/orders/raw, restore's parent-status check) never
  // touch job/shipped/cancelled, so skip those three lookups: 1 query
  // instead of 4. The full-shape path below is left untouched so its
  // 4 reads still fan out in parallel with no added latency.
  if (opts.orderOnly) {
    const orderR = await sql<{ raw: Order }>`SELECT raw FROM orders WHERE id = ${id} LIMIT 1`;
    if (!orderR.rows[0]) {
      throw new PostgresReadError(`order ${id} not found in Postgres`);
    }
    return { order: orderR.rows[0].raw, job: null, shipped: null, cancelled: null };
  }

  const [orderR, jobR, shippedR, cancelledR] = await Promise.all([
    sql<{ raw: Order }>`SELECT raw FROM orders WHERE id = ${id} LIMIT 1`,
    sql<{ raw: Job }>`SELECT raw FROM jobs WHERE order_id = ${id} AND phase2_deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    sql<{ raw: Shipped }>`SELECT raw FROM shipped WHERE order_id = ${id} ORDER BY id DESC LIMIT 1`,
    sql<{ raw: Cancelled }>`SELECT raw FROM cancelled WHERE order_id = ${id} ORDER BY id DESC LIMIT 1`,
  ]);

  if (!orderR.rows[0]) {
    throw new PostgresReadError(`order ${id} not found in Postgres`);
  }

  return {
    order: orderR.rows[0].raw,
    job: (jobR.rows[0]?.raw as unknown as Record<string, unknown>) ?? null,
    shipped: (shippedR.rows[0]?.raw as unknown as Record<string, unknown>) ?? null,
    cancelled: (cancelledR.rows[0]?.raw as unknown as Record<string, unknown>) ?? null,
  };
}

/** Single-target audit timeline from Postgres. Mirrors getAuditByTarget shape. */
export async function getAuditByTargetFromPostgres(
  jobId: number | string | null | undefined,
  orderId: number | string | null | undefined,
): Promise<{ entries: AuditEntry[] }> {
  if (!isPostgresConfigured()) throw new PostgresReadError('not configured');

  const jobIdNum = jobId != null && String(jobId).trim() ? Number(jobId) : null;
  const orderIdNum = orderId != null && String(orderId).trim() ? Number(orderId) : null;
  if (jobIdNum == null && orderIdNum == null) return { entries: [] };

  const { rows } = await sql<{
    timestamp: Date;
    role: string | null;
    action: string;
    target_id: string | null;
    summary: string | null;
  }>`
    SELECT timestamp, role, action, target_id::text AS target_id, summary
    FROM audit_log
    WHERE
      (${jobIdNum}::bigint IS NOT NULL AND target_id = ${jobIdNum})
      OR (${orderIdNum}::bigint IS NOT NULL AND target_id = ${orderIdNum})
    ORDER BY timestamp ASC
    LIMIT 200
  `;

  return {
    entries: rows.map(r => ({
      timestamp: r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp || ''),
      role: r.role || '',
      action: r.action,
      targetId: r.target_id || '',
      summary: r.summary || '',
    })),
  };
}
