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
 * Source: Vercel Postgres mirror table populated by `lib/sync-from-sheet.ts`
 * (cron every 10 min). Sheet remains the source of truth — these queries
 * are a fast read path with bounded staleness.
 *
 * Throws PostgresStaleError if last successful sync is older than the
 * staleness threshold OR sync_meta says the last run failed. The caller
 * (lib/api.ts wrapper) catches and falls back to Apps Script.
 */

export class PostgresStaleError extends Error {
  constructor(reason: string) {
    super(`Postgres mirror stale: ${reason}`);
    this.name = 'PostgresStaleError';
  }
}

const STALENESS_LIMIT_MS = 30 * 60 * 1000; // 30 min — 3× the cron interval

/** Returns null if mirror is fresh, or a string reason if stale. */
async function checkStaleness(tables: string[]): Promise<string | null> {
  try {
    const placeholders = tables.map((_, i) => `$${i + 1}`).join(',');
    const r = await sql.query(
      `SELECT table_name, last_sync_at, ok, last_error FROM sync_meta WHERE table_name IN (${placeholders})`,
      tables,
    );
    type Row = { table_name: string; last_sync_at: Date; ok: boolean; last_error: string | null };
    const rows = r.rows as Row[];
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.table_name);
      if (!row.ok) {
        return `${row.table_name} sync failed (${row.last_error || 'unknown'})`;
      }
      const age = Date.now() - new Date(row.last_sync_at).getTime();
      if (age > STALENESS_LIMIT_MS) {
        return `${row.table_name} last synced ${Math.round(age / 60000)} min ago`;
      }
    }
    for (const t of tables) {
      if (!seen.has(t)) {
        return `${t} never synced`;
      }
    }
    return null;
  } catch (err) {
    return `sync_meta check failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Load full snapshot from Postgres — same shape as Apps Script loadAll. */
export async function loadAllFromPostgres(opts: { audit?: boolean } = {}): Promise<LoadAllResponse> {
  if (!isPostgresConfigured()) throw new PostgresStaleError('not configured');

  const tablesNeeded = ['jobs', 'orders', 'shipped', 'cancelled', 'templates'];
  if (opts.audit !== false) tablesNeeded.push('audit_log');

  const stale = await checkStaleness(tablesNeeded);
  if (stale) throw new PostgresStaleError(stale);

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
  })).reverse(); // chronological asc to match Apps Script shape

  // nextId — sourced from Sheet via Apps Script. Postgres mirror doesn't
  // own this counter (it's allocated server-side under LockService).
  // For PoC, we set 0 here and let any caller that needs it call Apps
  // Script directly via getNextId. Phase 2 will move this to Postgres.
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

/** Single-order lookup from Postgres. Mirrors lib/api.ts loadOrder shape.
 *
 *  No mirror-staleness pre-gate. Under Phase 2 every write path that touches
 *  an order or its jobs (createOrder/updateOrder/addJob/updateJob/
 *  moveToShipped/cancelJob/bulkForward/promoteDraft/cancelOrder) commits to
 *  Postgres FIRST — so the Postgres row IS the source of truth for this
 *  order no matter how fresh the Sheet→Postgres cron mirror is. The only
 *  fallback signal that matters for a single-order read is "order not in
 *  Postgres at all" (row-not-found throw below) — that catches Phase 1.x
 *  stragglers that only ever lived in the Sheet.
 *
 *  A `checkStaleness(['orders'])` pre-gate used to sit here. When the cron
 *  sync was briefly unhealthy (e.g. the 2026-05-18 Postgres quota incident
 *  failed sync-from-sheet), it threw → loadOrder() fell back to Apps Script
 *  → a brand-new Phase 2 order wasn't in the Sheet yet → print page 404.
 *  Gating a Postgres-authoritative single-row read on mirror freshness is
 *  the same anti-pattern the 2026-05-12 loadOrder refactor removed. */
export async function loadOrderFromPostgres(
  orderId: number | string,
  opts: { orderOnly?: boolean } = {},
): Promise<LoadOrderResponse> {
  if (!isPostgresConfigured()) throw new PostgresStaleError('not configured');
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
      throw new PostgresStaleError(`order ${id} not found in Postgres`);
    }
    return { order: orderR.rows[0].raw, job: null, shipped: null, cancelled: null };
  }

  const [orderR, jobR, shippedR, cancelledR] = await Promise.all([
    sql<{ raw: Order }>`SELECT raw FROM orders WHERE id = ${id} LIMIT 1`,
    sql<{ raw: Job }>`SELECT raw FROM jobs WHERE order_id = ${id} AND phase2_deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    sql<{ raw: Shipped }>`SELECT raw FROM shipped WHERE order_id = ${id} ORDER BY id DESC LIMIT 1`,
    sql<{ raw: Cancelled }>`SELECT raw FROM cancelled WHERE order_id = ${id} ORDER BY id DESC LIMIT 1`,
  ]);

  // Order not in Postgres → throw so loadOrder() falls back to Apps Script.
  if (!orderR.rows[0]) {
    throw new PostgresStaleError(`order ${id} not found in Postgres`);
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
  if (!isPostgresConfigured()) throw new PostgresStaleError('not configured');

  const jobIdNum = jobId != null && String(jobId).trim() ? Number(jobId) : null;
  const orderIdNum = orderId != null && String(orderId).trim() ? Number(orderId) : null;
  if (jobIdNum == null && orderIdNum == null) return { entries: [] };

  const stale = await checkStaleness(['audit_log']);
  if (stale) throw new PostgresStaleError(stale);

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
