import 'server-only';
import { loadAllFromAppsScriptForSync, AppsScriptError } from '@/lib/api';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { phase2OwnsTable } from '@/lib/feature-flags';
import type { Order, Job, Shipped, Cancelled, AuditEntry, Template } from '@/lib/types';

/**
 * Full re-sync from Apps Script (Google Sheet) → Postgres.
 *
 * Pattern: TRUNCATE + bulk INSERT chunks of 100 via multi-row VALUES,
 * per table. ~6 seconds end-to-end for the typical Sheet (123 orders,
 * 200 jobs, 200 shipped, 50 cancelled, 500 audit, 30 templates).
 *
 * Called from:
 *  - /api/admin/sync-all  (manual trigger, admin only)
 *  - /api/cron/sync-from-sheet (Vercel cron, every 10 min)
 *
 * Source-of-truth contract: Sheet remains authoritative. This module
 * never writes back to Sheet. v2 reads should fall back to Apps Script
 * if Postgres is empty / stale beyond a threshold.
 */

interface TableSyncResult {
  table: string;
  fetched: number;
  inserted: number;
  /** Rows dropped because their id appeared more than once in the Sheet
   *  source (last occurrence wins — matches the row's "current state").
   *  Non-zero usually = data drift in Sheet that an admin should clean
   *  up at some point, but the sync stays correct in the meantime. */
  dedup?: number;
  ok: boolean;
  error?: string;
  ms: number;
}

/** Keep only the LAST occurrence of each id — handles Sheet data drift
 *  (e.g. shipped table has 2+ rows for the same job id from restore/ship
 *  cycles). Returns the deduped array + count of dropped rows. */
function dedupeById<T extends { id?: number | string }>(rows: T[]): { unique: T[]; dropped: number } {
  const map = new Map<string, T>();
  for (const r of rows) {
    const id = String(r.id ?? '');
    if (!id) continue;
    map.set(id, r); // last write wins
  }
  return { unique: Array.from(map.values()), dropped: rows.length - map.size };
}

export interface SyncResult {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  tables: TableSyncResult[];
}

const CHUNK = 100;

/** Sync everything in one shot. Returns per-table stats + overall ok flag. */
export async function syncAllFromSheet(): Promise<SyncResult> {
  const startedAt = new Date();
  const tables: TableSyncResult[] = [];

  if (!isPostgresConfigured()) {
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: startedAt.toISOString(),
      totalMs: 0,
      tables: [{
        table: 'config',
        fetched: 0,
        inserted: 0,
        ok: false,
        error: 'POSTGRES_URL env var missing',
        ms: 0,
      }],
    };
  }

  let snapshot;
  try {
    snapshot = await loadAllFromAppsScriptForSync();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      totalMs: Date.now() - startedAt.getTime(),
      tables: [{
        table: 'apps-script-fetch',
        fetched: 0,
        inserted: 0,
        ok: false,
        error: msg,
        ms: 0,
      }],
    };
  }

  // Phase 2 — when Postgres owns a table, skip the Sheet→Postgres sync.
  // The delete-clean+INSERT pattern would otherwise let Sheet overwrite a
  // Postgres-authoritative row (any row that isn't phase2_dirty). Skipping
  // makes Postgres the sole source of truth; the heal cron is the only
  // Postgres→Sheet path. syncOrSkip records a sync_meta touch on skip so
  // loadAllFromPostgres's staleness check stays green (else reads silently
  // fall back to Apps Script).
  //  - templates: owned since the templates Phase 2 migration
  //  - jobs/orders/shipped/cancelled: owned from Phase 4.2 close-out Stage 2
  //    (PHASE2_OWNS_CORE_TABLES=1)
  //  - audit_log: never owned — always imported from Sheet
  tables.push(await syncOrSkip('jobs', snapshot.jobs?.length || 0, () => syncJobs(snapshot.jobs || [])));
  tables.push(await syncOrSkip('orders', snapshot.orders?.length || 0, () => syncOrders(snapshot.orders || [])));
  tables.push(await syncOrSkip('shipped', snapshot.shipped?.length || 0, () => syncShipped(snapshot.shipped || [])));
  tables.push(await syncOrSkip('cancelled', snapshot.cancelled?.length || 0, () => syncCancelled(snapshot.cancelled || [])));
  tables.push(await syncOrSkip('templates', snapshot.templates?.length || 0, () => syncTemplates(snapshot.templates || [])));
  tables.push(await syncAuditLog(snapshot.audit || []));

  const finishedAt = new Date();
  const ok = tables.every(t => t.ok);

  return {
    ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalMs: finishedAt.getTime() - startedAt.getTime(),
    tables,
  };
}

async function recordSyncMeta(table: string, rowCount: number, ok: boolean, error?: string): Promise<void> {
  try {
    await sql`
      INSERT INTO sync_meta (table_name, last_sync_at, row_count, ok, last_error)
      VALUES (${table}, NOW(), ${rowCount}, ${ok}, ${error || null})
      ON CONFLICT (table_name)
      DO UPDATE SET last_sync_at = NOW(), row_count = ${rowCount}, ok = ${ok}, last_error = ${error || null}
    `;
  } catch {
    // Never break a sync run on meta-write failure.
  }
}

/** Update sync_meta.last_sync_at for a Phase 2-owned table without
 *  touching row_count or ok status — signals "table is current via Phase
 *  2 writes, not cron." Used when we skip the cron sync for owned tables.
 *  Falls back to a minimal INSERT if the row doesn't exist yet. */
async function recordSyncMetaTouch(table: string): Promise<void> {
  await sql`
    INSERT INTO sync_meta (table_name, last_sync_at, ok)
    VALUES (${table}, NOW(), true)
    ON CONFLICT (table_name)
    DO UPDATE SET last_sync_at = NOW(), ok = true, last_error = NULL
  `;
}

/** Run a table's Sheet→Postgres sync, or SKIP it when Phase 2 owns the
 *  table (Postgres is authoritative). The skip branch records a sync_meta
 *  touch — without it, loadAllFromPostgres's staleness check trips and
 *  reads silently fall back to Apps Script. */
async function syncOrSkip(
  table: 'jobs' | 'orders' | 'shipped' | 'cancelled' | 'templates',
  fetched: number,
  run: () => Promise<TableSyncResult>,
): Promise<TableSyncResult> {
  if (!phase2OwnsTable(table)) return run();
  try {
    await recordSyncMetaTouch(table);
  } catch {
    // Non-fatal — staleness check for this table may lag but won't block.
  }
  return {
    table,
    fetched,
    inserted: 0,
    ok: true,
    error: 'skipped — Postgres owns this table (Phase 4.2 close-out)',
    ms: 0,
  };
}

async function bulkInsert(
  tableName: string,
  columnList: string,
  rows: unknown[][],
  paramsPerRow: number,
  cast: string[] = [],
  opts: { onConflict?: 'do-nothing' | 'replace' } = {},
): Promise<{ inserted: number; error?: string }> {
  if (rows.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK) {
    const chunk = rows.slice(chunkStart, chunkStart + CHUNK);
    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const row of chunk) {
      const row$ = row.map((_, i) => {
        const c = cast[i];
        return c ? `$${p + i}::${c}` : `$${p + i}`;
      }).join(', ');
      placeholders.push(`(${row$})`);
      values.push(...row);
      p += paramsPerRow;
    }
    try {
      const conflictClause =
        opts.onConflict === 'do-nothing' ? ' ON CONFLICT (id) DO NOTHING' : '';
      const query = `INSERT INTO ${tableName} (${columnList}) VALUES ${placeholders.join(', ')}${conflictClause}`;
      const res = await sql.query(query, values);
      inserted += res.rowCount || 0;
    } catch (err) {
      return { inserted, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { inserted };
}

/** Phase 2 sync pattern — preserve rows where Postgres has fresher state
 *  than Sheet (`phase2_dirty_at IS NOT NULL`). Replaces the TRUNCATE +
 *  bulk-INSERT pattern for tables with phase2_dirty_at column.
 *
 *  Steps:
 *  1. DELETE rows where phase2_dirty_at IS NULL — these are
 *     Sheet-authoritative rows that we'll refresh from current Sheet.
 *  2. INSERT all Sheet rows ON CONFLICT (id) DO NOTHING — dirty rows are
 *     left alone (they survive because they're still in the table after
 *     step 1, so the conflict check protects them).
 *
 *  Result: dirty rows preserved with their Phase 2 state; clean rows
 *  overwritten with Sheet's current state. Heal cron later pushes dirty
 *  rows back to Sheet, marking them clean once Sheet has caught up. */
async function deleteCleanThenInsert(
  tableName: string,
  columnList: string,
  rows: unknown[][],
  paramsPerRow: number,
  cast: string[] = [],
  opts: { deleteWhere?: string } = {},
): Promise<{ inserted: number; error?: string }> {
  // Default predicate preserves only dirty (Phase 2-UPDATE) rows. Jobs
  // overrides this to also preserve tombstoned rows (moveToShipped /
  // cancelJob) so Sheet's lingering rows don't get re-inserted before the
  // heal cron pushes deleteJobByIdRow.
  const where = opts.deleteWhere || 'phase2_dirty_at IS NULL';
  try {
    await sql.query(`DELETE FROM ${tableName} WHERE ${where}`);
  } catch (err) {
    return { inserted: 0, error: err instanceof Error ? err.message : String(err) };
  }
  return bulkInsert(tableName, columnList, rows, paramsPerRow, cast, { onConflict: 'do-nothing' });
}

async function syncJobs(jobs: Job[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    const { unique, dropped } = dedupeById(jobs);
    const rows = unique
      .filter(j => Number.isFinite(Number(j.id)))
      .map(j => [
        Number(j.id),
        j.orderId != null ? Number(j.orderId) : null,
        String(j.name || ''),
        j.date != null ? String(j.date) : null,
        j.dateIn != null ? String(j.dateIn) : null,
        j.staff != null ? String(j.staff) : null,
        j.dept != null ? String(j.dept) : null,
        j.status != null ? String(j.status) : null,
        j.cowork != null ? JSON.stringify(j.cowork) : null,
        JSON.stringify(j),
      ]);
    // Phase 2 dirty-row preservation — see deleteCleanThenInsert docstring.
    // Jobs also preserves tombstoned rows (moveToShipped/cancelJob have
    // moved the row to shipped/cancelled in Postgres; we can't let Sheet
    // re-insert the lingering jobs row before heal cron deletes it from
    // Sheet via deleteJobByIdRow).
    const r = await deleteCleanThenInsert(
      'jobs',
      'id, order_id, name, date, date_in, staff, dept, status, cowork, raw',
      rows,
      10,
      ['bigint', 'bigint', '', '', '', '', '', '', 'jsonb', 'jsonb'],
      { deleteWhere: 'phase2_dirty_at IS NULL AND phase2_deleted_at IS NULL' },
    );
    await recordSyncMeta('jobs', r.inserted, !r.error, r.error);
    return { table: 'jobs', fetched: jobs.length, inserted: r.inserted, dedup: dropped, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('jobs', 0, false, msg);
    return { table: 'jobs', fetched: jobs.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}

async function syncOrders(orders: Order[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    const { unique, dropped } = dedupeById(orders);
    const rows = unique
      .filter(o => Number.isFinite(Number(o.id)))
      .map(o => [
        Number(o.id),
        String(o.name || ''),
        o.customer != null ? String(o.customer) : null,
        o.dateIn != null ? String(o.dateIn) : null,
        o.dateDue != null ? String(o.dateDue) : null,
        o.price != null ? String(o.price) : null,
        o.assignDept != null ? String(o.assignDept) : null,
        o.assignStaff != null ? String(o.assignStaff) : null,
        o.orderer != null ? String(o.orderer) : null,
        o.status != null ? String(o.status) : null,
        o.details != null ? JSON.stringify(o.details) : null,
        o.rawData != null ? JSON.stringify(o.rawData) : null,
        JSON.stringify(o),
      ]);
    const r = await deleteCleanThenInsert(
      'orders',
      'id, name, customer, date_in, date_due, price, assign_dept, assign_staff, orderer, status, details, raw_data, raw',
      rows,
      13,
      ['bigint', '', '', '', '', '', '', '', '', '', 'jsonb', 'jsonb', 'jsonb'],
    );
    await recordSyncMeta('orders', r.inserted, !r.error, r.error);
    return { table: 'orders', fetched: orders.length, inserted: r.inserted, dedup: dropped, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('orders', 0, false, msg);
    return { table: 'orders', fetched: orders.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}

async function syncShipped(shipped: Shipped[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    const { unique, dropped } = dedupeById(shipped);
    const rows = unique
      .filter(s => Number.isFinite(Number(s.id)))
      .map(s => [
        Number(s.id),
        s.orderId != null ? Number(s.orderId) : null,
        s.name != null ? String(s.name) : null,
        s.shippedDate != null ? String(s.shippedDate) : null,
        JSON.stringify(s),
      ]);
    const r = await deleteCleanThenInsert(
      'shipped',
      'id, order_id, name, shipped_date, raw',
      rows,
      5,
      ['bigint', 'bigint', '', '', 'jsonb'],
    );
    await recordSyncMeta('shipped', r.inserted, !r.error, r.error);
    return { table: 'shipped', fetched: shipped.length, inserted: r.inserted, dedup: dropped, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('shipped', 0, false, msg);
    return { table: 'shipped', fetched: shipped.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}

async function syncCancelled(cancelled: Cancelled[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    const { unique, dropped } = dedupeById(cancelled);
    const rows = unique
      .filter(c => Number.isFinite(Number(c.id)))
      .map(c => [
        Number(c.id),
        c.orderId != null ? Number(c.orderId) : null,
        c.name != null ? String(c.name) : null,
        c.dept != null ? String(c.dept) : null,
        c.staff != null ? String(c.staff) : null,
        c.cancelledBy != null ? String(c.cancelledBy) : null,
        c.cancelledAt != null ? String(c.cancelledAt) : null,
        c.reason != null ? String(c.reason) : null,
        JSON.stringify(c),
      ]);
    const r = await deleteCleanThenInsert(
      'cancelled',
      'id, order_id, name, dept, staff, cancelled_by, cancelled_at, reason, raw',
      rows,
      9,
      ['bigint', 'bigint', '', '', '', '', '', '', 'jsonb'],
    );
    await recordSyncMeta('cancelled', r.inserted, !r.error, r.error);
    return { table: 'cancelled', fetched: cancelled.length, inserted: r.inserted, dedup: dropped, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('cancelled', 0, false, msg);
    return { table: 'cancelled', fetched: cancelled.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}

async function syncTemplates(templates: Template[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    await sql`TRUNCATE TABLE templates`;
    const { unique, dropped } = dedupeById(templates);
    const rows = unique
      .filter(t => Number.isFinite(Number(t.id)))
      .map(t => [
        Number(t.id),
        String(t.name || ''),
        t.rawData != null ? JSON.stringify(t.rawData) : null,
        t.createdBy != null ? String(t.createdBy) : null,
        t.createdAt != null ? String(t.createdAt) : null,
        JSON.stringify(t),
      ]);
    const r = await bulkInsert(
      'templates',
      'id, name, raw_data, created_by, created_at, raw',
      rows,
      6,
      ['bigint', '', 'jsonb', '', '', 'jsonb'],
    );
    await recordSyncMeta('templates', r.inserted, !r.error, r.error);
    return { table: 'templates', fetched: templates.length, inserted: r.inserted, dedup: dropped, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('templates', 0, false, msg);
    return { table: 'templates', fetched: templates.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}

async function syncAuditLog(audit: AuditEntry[]): Promise<TableSyncResult> {
  const t0 = Date.now();
  try {
    // Phase 2 audit entries (source='postgres') survive cron refresh —
    // they were written directly by Phase 2 routes and aren't reflected in
    // Sheet, so a TRUNCATE would lose them entirely. Only wipe the rows
    // we'll re-import from Sheet.
    await sql`DELETE FROM audit_log WHERE source = 'sheet'`;
    const rows = audit.map(r => {
      const tsIso = r.timestamp || new Date().toISOString();
      const targetIdNum = r.targetId ? Number(String(r.targetId).replace(/[^\d]/g, '')) : null;
      const targetId = Number.isFinite(targetIdNum) && targetIdNum ? targetIdNum : null;
      return [
        tsIso,
        r.role || null,
        null, // user_name not in Sheet schema yet
        r.action || 'unknown',
        targetId,
        r.summary || null,
        'sheet',  // source — Phase 2 entries use 'postgres' (preserved across cron)
      ];
    });
    const r = await bulkInsert(
      'audit_log',
      'timestamp, role, user_name, action, target_id, summary, source',
      rows,
      7,
      ['timestamptz', '', '', '', 'bigint', '', ''],
    );
    await recordSyncMeta('audit_log', r.inserted, !r.error, r.error);
    return { table: 'audit_log', fetched: audit.length, inserted: r.inserted, ok: !r.error, error: r.error, ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordSyncMeta('audit_log', 0, false, msg);
    return { table: 'audit_log', fetched: audit.length, inserted: 0, ok: false, error: msg, ms: Date.now() - t0 };
  }
}
