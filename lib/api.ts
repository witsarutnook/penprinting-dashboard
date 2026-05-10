import 'server-only';
import type { LoadAllResponse, Order } from './types';

/**
 * Fetch wrapper for the Dashboard Apps Script web app (script.google.com → APPS_SCRIPT_URL).
 * Server-side only — env vars APPS_SCRIPT_URL + APPS_SCRIPT_TOKEN must never reach the client.
 *
 * The token is HMAC-signed by API_SECRET (managed in Apps Script Script Properties).
 * Generated via setup.ts → generateDashboardToken() — valid 5 years.
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
 *  instead of stale 60s ISR cache. */
export const LOAD_ALL_TAG = 'load-all';

/** GET ?action=<name> with token. Caller decides what shape to expect.
 *  Default revalidate=60s (read-side caching) — pass `revalidate: 0` for write-path lookups
 *  (e.g. allocating nextId before addJob — must see latest counter). */
async function get<T>(
  action: string,
  params: Record<string, string> = {},
  opts: { revalidate?: number } = {},
): Promise<T> {
  const { url, token } = getApiBase();
  const qs = new URLSearchParams({ action, token, ...params });
  const revalidate = opts.revalidate ?? 60;
  const res = await fetch(`${url}?${qs.toString()}`, {
    method: 'GET',
    // Apps Script web apps redirect via 302 to googleusercontent.com — must follow
    redirect: 'follow',
    next: { revalidate },
  });
  if (!res.ok) {
    throw new AppsScriptError(action, `HTTP ${res.status}`, res.status);
  }
  const data = (await res.json()) as T | { error: string };
  if (data && typeof data === 'object' && 'error' in data) {
    throw new AppsScriptError(action, (data as { error: string }).error);
  }
  return data as T;
}

/** Defensive defaults — Apps Script sometimes returns a snapshot missing
 *  fields (empty Sheet, schema drift, transient error). Without this,
 *  pages calling `data.orders.forEach()` etc. throw at runtime with
 *  "Cannot read properties of undefined". Reported on /analytics
 *  (Digest 958503229, 2026-05-06). */
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

/** Phase 1 read-mirror feature flag.
 *
 *  When `READ_FROM_POSTGRES=1`, public read functions (loadAll,
 *  loadAllWithAudit, loadOrder, getAuditByTarget) try the Postgres mirror
 *  first and fall back to Apps Script on any error / staleness. The flag
 *  is intentionally opt-in — Apps Script is the safe default until ops
 *  has verified that the cron-based sync is healthy.
 *
 *  Flip the flag (Vercel project → Settings → Environment Variables) to
 *  enable Postgres-first reads. No code change needed; reads pick up the
 *  new value on the next deploy.
 *
 *  `loadAllFresh()` always reads Apps Script — write paths need
 *  authoritative Sheet state, not the cron-lagged mirror. */
function postgresEnabled(): boolean {
  return process.env.READ_FROM_POSTGRES === '1';
}

async function tryPostgres<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  if (!postgresEnabled()) return null;
  try {
    return await fn();
  } catch (err) {
    // Fall back to Apps Script silently — staleness or schema drift
    // shouldn't surface to users while we're in shadow-mode validation.
    // Tag a Sentry breadcrumb so we can audit fallback rate later.
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.addBreadcrumb({
        category: 'postgres-fallback',
        level: 'warning',
        message: `${label}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } catch {
      // Sentry import failure is non-fatal
    }
    return null;
  }
}

/** Fetch the full snapshot used by the dashboard frontend (60s ISR cache).
 *  Passes `audit=0` so Apps Script (v5.10.5+) skips the audit_log read
 *  — saves ~50-100KB payload + ~50ms script time. The /analytics page
 *  needs audit and uses `loadAllWithAudit()` instead. Pre-v5.10.5 Apps
 *  Script ignores the param and returns audit anyway, so this is a
 *  forward-compat speedup. */
export async function loadAll(): Promise<LoadAllResponse> {
  const pg = await tryPostgres('loadAll', async () => {
    const { loadAllFromPostgres } = await import('@/lib/api-postgres');
    return loadAllFromPostgres({ audit: false });
  });
  if (pg) return pg;
  const data = await get<Partial<LoadAllResponse>>('loadAll', { audit: '0' });
  return withDefaults(data);
}

/** Same as loadAll but includes the 500 most recent audit rows — used by
 *  /analytics for monthly-report breakdowns by dept. */
export async function loadAllWithAudit(): Promise<LoadAllResponse> {
  const pg = await tryPostgres('loadAllWithAudit', async () => {
    const { loadAllFromPostgres } = await import('@/lib/api-postgres');
    return loadAllFromPostgres({ audit: true });
  });
  if (pg) return pg;
  const data = await get<Partial<LoadAllResponse>>('loadAll');
  return withDefaults(data);
}

/** Fetch loadAll with no caching — for write-path lookups (nextId allocation, etc).
 *  Skips audit (write paths never need audit history). */
export async function loadAllFresh(): Promise<LoadAllResponse> {
  const data = await get<Partial<LoadAllResponse>>('loadAll', { audit: '0' }, { revalidate: 0 });
  return withDefaults(data);
}

/** Single-order lookup. Apps Script returns ~1KB instead of ~200KB.
 *  Used for hot paths that only need one order's rawData (e.g. order detail
 *  modal "สเปคงาน" tab, /track lookup, /api/orders/raw).
 *
 *  `revalidate` defaults to 0 — write-path callers (restore, promote, etc.)
 *  must read fresh state. Read-path callers that just want the spec for
 *  display can pass a small TTL (e.g. 30s) to avoid hammering Apps Script
 *  on repeat modal opens. After 2026-05-08's diagnose-Bug-4 work the
 *  Apps Script `getOrder` action does a TextFinder single-row read
 *  (~400-600ms instead of 3-4s) so the cost of revalidate=0 is bounded
 *  even without ISR — the cache is still worth it for the modal-reopen
 *  pattern users actually have. */
export interface LoadOrderResponse {
  order: Order | null;
  job: Record<string, unknown> | null;
  shipped: Record<string, unknown> | null;
  cancelled: Record<string, unknown> | null;
}
export async function loadOrder(
  id: number | string,
  opts: { revalidate?: number } = {},
): Promise<LoadOrderResponse> {
  // Postgres-first only when caller is OK with the 10-min cron staleness
  // ceiling. Write-path callers pass revalidate: 0 because they need the
  // result of THEIR own write reflected — Postgres mirror would still
  // show the pre-write snapshot. Read-path callers pass a small revalidate
  // (≥30s) which is a hint that staleness is fine.
  if ((opts.revalidate ?? 0) > 0) {
    const pg = await tryPostgres('loadOrder', async () => {
      const { loadOrderFromPostgres } = await import('@/lib/api-postgres');
      return loadOrderFromPostgres(id);
    });
    if (pg) return pg;
  }
  const data = await get<Partial<LoadOrderResponse>>(
    'getOrder',
    { orderId: String(id) },
    { revalidate: opts.revalidate ?? 0 },
  );
  return {
    order: data.order ?? null,
    job: data.job ?? null,
    shipped: data.shipped ?? null,
    cancelled: data.cancelled ?? null,
  };
}

/** Single-target audit timeline — chronological entries where targetId
 *  matches jobId OR orderId. Used by v2 history tab in /board card detail
 *  + /orders detail modal. Apps Script v5.10.7+ adds the action; pre-5.10.7
 *  Apps Script returns "Unknown action" → empty timeline (graceful).
 *
 *  Why a separate route: loadAll() with audit=1 ships the whole 500-row
 *  audit_log payload (~50-100KB) just so we can filter to ~5-20 rows for
 *  one job. On-demand fetch keeps /board + /orders snapshot small. */
export interface AuditEntry {
  timestamp: string;
  role: string;
  action: string;
  targetId: string;
  summary: string;
}
/** Apps Script usage stats — 14-day per-day request counts.
 *  Apps Script side increments a Properties Service counter on every
 *  doGet/doPost. Pre-v5.10.9 returns "Unknown action" → empty stats so
 *  the widget renders gracefully on stale Apps Script deploys. */
export interface QuotaStats {
  daily: { date: string; count: number }[];
  todayCount: number;
  windowTotal: number;
  peak: number;
}

export async function getQuotaStats(): Promise<QuotaStats> {
  try {
    const data = await get<Partial<QuotaStats>>('getQuotaStats', {}, { revalidate: 300 });
    return {
      daily: data.daily || [],
      todayCount: typeof data.todayCount === 'number' ? data.todayCount : 0,
      windowTotal: typeof data.windowTotal === 'number' ? data.windowTotal : 0,
      peak: typeof data.peak === 'number' ? data.peak : 0,
    };
  } catch (err) {
    if (err instanceof AppsScriptError && /unknown action/i.test(err.message)) {
      return { daily: [], todayCount: 0, windowTotal: 0, peak: 0 };
    }
    throw err;
  }
}

export async function getAuditByTarget(
  jobId: number | string | null | undefined,
  orderId: number | string | null | undefined,
  opts: { revalidate?: number } = {},
): Promise<{ entries: AuditEntry[] }> {
  const pg = await tryPostgres('getAuditByTarget', async () => {
    const { getAuditByTargetFromPostgres } = await import('@/lib/api-postgres');
    return getAuditByTargetFromPostgres(jobId, orderId);
  });
  if (pg) return pg;

  const params: Record<string, string> = {};
  if (jobId != null && String(jobId).trim()) params.jobId = String(jobId);
  if (orderId != null && String(orderId).trim()) params.orderId = String(orderId);
  if (!params.jobId && !params.orderId) return { entries: [] };
  try {
    const data = await get<{ entries?: AuditEntry[] }>(
      'getAuditByTarget',
      params,
      { revalidate: opts.revalidate ?? 30 },
    );
    return { entries: data.entries || [] };
  } catch (err) {
    // Graceful for pre-5.10.7 Apps Script — empty timeline rather than throw
    if (err instanceof AppsScriptError && /unknown action/i.test(err.message)) {
      return { entries: [] };
    }
    throw err;
  }
}

/** Per-action invalidation map. After a successful write we revalidate
 *  ONLY the paths whose data shape actually changes — pages outside this
 *  set keep their warm 60s ISR cache, so navigating to them feels
 *  instant instead of triggering a fresh Apps Script roundtrip.
 *
 *  Page → data dependency:
 *  - /board     uses jobs + orders (cowork). Audit data dropped 2026-05-07
 *               (round 5) — undo flow uses client-side snapshots, not Sheet
 *               audit log. loadAll() passes audit=0 for /board reads.
 *  - /orders    uses jobs (current step) + orders + shipped (status) + cancelled (status)
 *  - /shipped   uses shipped + orders (display name)
 *  - /cancelled uses cancelled
 *  - /calendar  uses jobs + orders
 *  - /analytics uses jobs + orders + shipped + cancelled + audit
 *  - /orders/new uses templates + orders (recentOrders + duplicate)
 *
 *  Pages NOT in any list (none right now) keep cache forever until the
 *  next 60s ISR window. /archive uses a separate searchArchive call.
 *  /orders/[id]/print + /tracking-card fetch a single order by id —
 *  not affected by loadAll cache. */
const PATHS_BY_ACTION: Record<string, readonly string[]> = {
  // Job CRUD — every job-aware page
  addJob:        ['/board', '/orders', '/calendar', '/analytics'],
  updateJob:     ['/board', '/orders', '/calendar', '/analytics'],
  deleteJob:     ['/board', '/orders', '/calendar', '/analytics'],
  setCowork:     ['/board'],
  bulkForward:   ['/board', '/orders', '/calendar', '/analytics'],
  // Status transitions — touch the destination data set too
  moveToShipped: ['/board', '/orders', '/shipped', '/calendar', '/analytics'],
  cancelJob:     ['/board', '/orders', '/cancelled', '/calendar', '/analytics'],
  restoreJob:    ['/board', '/orders', '/cancelled', '/calendar', '/analytics'],
  // Order CRUD — order-aware pages (cascade-cancel makes deleteOrder bust /cancelled)
  addOrder:      ['/board', '/orders', '/orders/new', '/analytics'],
  updateOrder:   ['/board', '/orders', '/orders/new', '/analytics'],
  deleteOrder:   ['/board', '/orders', '/cancelled', '/analytics'],
  // v5.10.3+ atomic actions — same surface area as multi-call legacy flows
  // (the legacy fallback path uses addOrder + addJob in parallel, so the
  // union of those two lists is what createOrder needs to bust)
  createOrder:        ['/board', '/orders', '/orders/new', '/calendar', '/analytics'],
  cancelOrder:        ['/board', '/orders', '/cancelled', '/calendar', '/analytics'],
  deleteOrderCascade: ['/board', '/orders', '/cancelled', '/analytics'],
  promoteDraft:       ['/board', '/orders', '/orders/new', '/calendar', '/analytics'],
  // Templates only show up in order entry
  addTemplate:    ['/orders/new'],
  deleteTemplate: ['/orders/new'],
  // getNextId / getNextOrderId — counter mints, no Sheet data changes,
  // explicitly NOT in this map so they don't bust anything.
};

/** Resolve the operator identity for audit logging. Reads the dashboard
 *  session cookie and returns "<role>:<user>" if logged in, undefined
 *  otherwise. The Apps Script side (v5.10.1+) honours `body._actor` and
 *  records the user portion in audit_log instead of the generic
 *  "admin:dashboard" service identity. Wrapping in try/catch so calls
 *  outside a request context (boot-time, scripts) silently skip. */
async function currentActor(): Promise<string | undefined> {
  try {
    const { cookies } = await import('next/headers');
    const { COOKIE_NAME, verifySession } = await import('@/lib/auth');
    const session = await verifySession(cookies().get(COOKIE_NAME)?.value);
    if (session) return `${session.role}:${session.user}`;
  } catch {
    // No request context (e.g. building, unit test) — fall back to dashboard service identity.
  }
  return undefined;
}

/** POST {action, token, ...body} — mirrors WP `apiPost`. Used for actions that
 *  take complex bodies (searchArchive, bulkForward, mutations) — token goes in body.
 *
 *  ⚠️ For mutations: always pass `revalidate: 0` (default) to bypass fetch cache —
 *  we never want to cache write operations. After a successful write, also
 *  invalidates the loadAll tag so the next router.refresh() returns fresh data
 *  instead of the (up to 60s) ISR cache. */
export async function post<T>(action: string, body: Record<string, unknown> = {}, opts: { revalidate?: number } = {}): Promise<T> {
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
    headers: { 'Content-Type': 'text/plain' },  // Apps Script reads e.postData.contents — content-type doesn't matter
    redirect: 'follow',
    next: opts.revalidate ? { revalidate: opts.revalidate } : { revalidate: 0 },
  });
  if (!res.ok) throw new AppsScriptError(action, `HTTP ${res.status}`, res.status);
  const data = (await res.json()) as T | { error: string };
  if (data && typeof data === 'object' && 'error' in data) {
    throw new AppsScriptError(action, (data as { error: string }).error);
  }
  // Successful write — bust ONLY the paths whose data shape actually
  // changed (auditor sidebar-perf). Previously busted all six paths on
  // every write, which kept ISR cache permanently cold and made every
  // sidebar nav feel like a fresh Apps Script roundtrip. Pages not in
  // this action's list keep their warm 60s cache and respond instantly.
  // Uses revalidatePath rather than revalidateTag because the Apps
  // Script GET URL changes per env-token and tagging via fetch options
  // proved unstable on Vercel (analytics page crash 2026-05-06).
  const paths = PATHS_BY_ACTION[action];
  if (paths && paths.length > 0) {
    try {
      const { revalidatePath } = await import('next/cache');
      for (const p of paths) revalidatePath(p);
    } catch {
      // ignore — non-fatal
    }
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
