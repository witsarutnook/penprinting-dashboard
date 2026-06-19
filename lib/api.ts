import 'server-only';
import { unstable_cache } from 'next/cache';
import type { LoadAllResponse, Order } from './types';

/**
 * Apps Script client — narrowly used post-§12 by `/archive` only.
 * loadAll/loadOrder/getAuditByTarget read directly from Postgres now
 * (no Apps Script fallback). The Apps Script project still hosts
 * `searchArchive` until §13 ports archive tables to Postgres.
 */

class AppsScriptError extends Error {
  constructor(public action: string, public reason: string, public status?: number) {
    super(`Apps Script ${action} failed: ${reason}`);
    this.name = 'AppsScriptError';
  }
}

function getApiBase(): { url: string; token: string } {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!url || !token) {
    throw new AppsScriptError(
      'config',
      'APPS_SCRIPT_URL or APPS_SCRIPT_TOKEN env var missing — set in Vercel Settings → Environment Variables',
    );
  }
  return { url, token };
}

/** Cache tag used by every `loadAll()` GET — write routes call
 *  `revalidateTag(LOAD_ALL_TAG)` so the next page render returns fresh data
 *  instead of stale 15s ISR cache. */
export const LOAD_ALL_TAG = 'load-all';

/** Defensive defaults for the Postgres snapshot shape. Earlier vintages
 *  needed this because Apps Script returned partial shapes on transient
 *  errors; kept as belt-and-suspenders for shared call sites. */
function withDefaults(data: Partial<LoadAllResponse>): LoadAllResponse {
  return {
    jobs: data.jobs || [],
    orders: data.orders || [],
    shipped: data.shipped || [],
    cancelled: data.cancelled || [],
    audit: data.audit || [],
    nextId: typeof data.nextId === 'number' ? data.nextId : 100,
    templates: data.templates || [],
  };
}

/** Postgres-only full snapshot. `audit=false` skips the audit_log read —
 *  saves ~50-100KB. `audit=true` includes the 500 most recent rows for
 *  /analytics monthly-report breakdowns. */
async function loadAllSnapshot(audit: boolean): Promise<LoadAllResponse> {
  const { loadAllFromPostgres } = await import('@/lib/api-postgres');
  return withDefaults(await loadAllFromPostgres({ audit }));
}

/** Coalesced snapshot read. Auto-sync (`router.refresh()`) re-runs the
 *  board/orders/calendar server components every 15-60s on every open tab;
 *  without this, N tabs across M staff would each issue an identical
 *  `SELECT raw FROM ...` against Postgres. `unstable_cache` collapses them
 *  to ONE query per 15s window per audit variant — the dominant lever for
 *  Postgres network-transfer cost (diagnosed 2026-05-18: 5.6GB/8d).
 *
 *  Freshness: write routes call `revalidateTag(LOAD_ALL_TAG)` on success,
 *  so a mutation shows up on the very next render — the 15s TTL only
 *  bounds the no-write idle-poll case. */
const loadAllCached = unstable_cache(loadAllSnapshot, ['load-all-snapshot'], {
  tags: [LOAD_ALL_TAG],
  revalidate: 15,
});

/** Full snapshot for the dashboard frontend (board / orders / calendar /
 *  shipped / cancelled). Coalesced + tag-invalidated — see `loadAllCached`. */
export async function loadAll(): Promise<LoadAllResponse> {
  return loadAllCached(false);
}

/** Same as loadAll but includes the 500 most recent audit rows — used by
 *  /analytics for monthly-report breakdowns by dept. */
export async function loadAllWithAudit(): Promise<LoadAllResponse> {
  return loadAllCached(true);
}

/** Postgres-only single-order lookup with its active jobs. Used by write
 *  paths that need "look up order + cascade ops on its jobs": promote-draft,
 *  /api/orders/update (cascade rename), /api/orders/cancel, /api/orders/delete. */
export async function loadOrderAndJobs(id: number): Promise<{
  order: Record<string, unknown> | null;
  jobs: Array<Record<string, unknown>>;
}> {
  const { sql } = await import('@/lib/postgres');
  const oR = await sql<{ raw: Record<string, unknown> | null }>`
    SELECT raw FROM orders WHERE id = ${id}::bigint LIMIT 1
  `;
  if (!oR.rows[0]?.raw) {
    return { order: null, jobs: [] };
  }
  const jR = await sql<{ raw: Record<string, unknown> | null }>`
    SELECT raw FROM jobs
    WHERE order_id = ${id}::bigint AND phase2_deleted_at IS NULL
  `;
  return {
    order: oR.rows[0].raw,
    jobs: jR.rows.map((r) => r.raw).filter((r): r is Record<string, unknown> => !!r),
  };
}

export interface LoadOrderResponse {
  order: Order | null;
  job: Record<string, unknown> | null;
  shipped: Record<string, unknown> | null;
  cancelled: Record<string, unknown> | null;
}

/** Single-order lookup — Postgres-only.
 *
 *  Used by hot paths that only need one order's rawData (order detail modal
 *  "สเปคงาน" tab, /track lookup, /api/orders/raw, print page, tracking-card,
 *  restore).
 *
 *  `orderOnly` — set when the caller reads ONLY `.order` (never `.job`,
 *  `.shipped`, `.cancelled`). Runs 1 query instead of 4; those three keys
 *  come back null. */
export async function loadOrder(
  id: number | string,
  opts: { orderOnly?: boolean } = {},
): Promise<LoadOrderResponse> {
  const { loadOrderFromPostgres } = await import('@/lib/api-postgres');
  return loadOrderFromPostgres(id, { orderOnly: opts.orderOnly });
}

export interface AuditEntry {
  timestamp: string;
  role: string;
  action: string;
  targetId: string;
  summary: string;
}

/** Single-target audit timeline — chronological entries where targetId
 *  matches jobId OR orderId. Used by v2 history tab in /board card detail
 *  + /orders detail modal. */
export async function getAuditByTarget(
  jobId: number | string | null | undefined,
  orderId: number | string | null | undefined,
): Promise<{ entries: AuditEntry[] }> {
  const { getAuditByTargetFromPostgres } = await import('@/lib/api-postgres');
  return getAuditByTargetFromPostgres(jobId, orderId);
}

/** Resolve the operator identity for audit logging. Returns `"<role>:<user>"`
 *  when called from inside a Next.js request handler with a valid dashboard
 *  session cookie. Returns `undefined` otherwise. */
async function currentActor(): Promise<string | undefined> {
  try {
    const { cookies } = await import('next/headers');
    const { COOKIE_NAME, verifySession } = await import('@/lib/auth');
    const session = await verifySession((await cookies()).get(COOKIE_NAME)?.value);
    if (session) return `${session.role}:${session.user}`;
  } catch {
    // No request context (e.g. building, unit test) — fall back to dashboard service identity.
  }
  return undefined;
}

/** POST {action, token, ...body} — used by `searchArchive` only after §12.
 *  Write paths no longer route through here; they call postgres-write
 *  helpers directly and manage their own revalidation. */
async function post<T>(action: string, body: Record<string, unknown> = {}, opts: { revalidate?: number } = {}): Promise<T> {
  const { url, token } = getApiBase();
  const actor = await currentActor();
  const payload = JSON.stringify({
    action,
    token,
    ...(actor ? { _actor: actor } : {}),
    ...body,
  });
  const res = await fetch(url, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'text/plain' },
    redirect: 'follow',
    next: opts.revalidate ? { revalidate: opts.revalidate } : { revalidate: 0 },
  });
  if (!res.ok) throw new AppsScriptError(action, `HTTP ${res.status}`, res.status);
  const data = (await res.json()) as T | { error: string };
  if (data && typeof data === 'object' && 'error' in data) {
    throw new AppsScriptError(action, (data as { error: string }).error);
  }
  return data as T;
}

/** Search across all archive sheets. Apps Script returns up to 100 results.
 *  Cache 30s — archives don't change often. */
export interface ArchiveSearchResult {
  results: Array<Record<string, unknown> & { _sheet: string }>;
  total?: number;
  message?: string;
}

export async function searchArchive(query: string): Promise<ArchiveSearchResult> {
  return post<ArchiveSearchResult>('searchArchive', { query }, { revalidate: 30 });
}

export { AppsScriptError };
