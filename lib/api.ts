import 'server-only';
import { unstable_cache } from 'next/cache';
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
    const reason = err instanceof Error ? err.message : String(err);
    // console.warn writes to Vercel function logs — visible via Logs tab,
    // searchable for "[postgres-fallback]". Sentry breadcrumb stays for
    // event context if any error surfaces later in the same request.
    console.warn(`[postgres-fallback] ${label}: ${reason}`);
    try {
      const Sentry = await import('@sentry/nextjs');
      Sentry.addBreadcrumb({
        category: 'postgres-fallback',
        level: 'warning',
        message: `${label}: ${reason}`,
      });
    } catch {
      // Sentry import failure is non-fatal
    }
    return null;
  }
}

/** Postgres-first (Apps Script fallback) full snapshot. `audit=false` skips
 *  the audit_log read — saves ~50-100KB. `audit=true` includes the 500 most
 *  recent rows for /analytics monthly-report breakdowns. */
async function loadAllSnapshot(audit: boolean): Promise<LoadAllResponse> {
  const pg = await tryPostgres(audit ? 'loadAllWithAudit' : 'loadAll', async () => {
    const { loadAllFromPostgres } = await import('@/lib/api-postgres');
    return loadAllFromPostgres({ audit });
  });
  if (pg) return pg;
  // revalidate:0 — this fallback runs inside loadAllCached's unstable_cache.
  // A default 60s fetch cache here would be a second, untagged cache layer:
  // revalidateTag(LOAD_ALL_TAG) busts the outer cache but not this fetch, so
  // a write during a Postgres outage wouldn't show for up to 60s. Let the
  // outer unstable_cache (15s + tag) be the sole cache + invalidation layer.
  const data = await get<Partial<LoadAllResponse>>('loadAll', audit ? {} : { audit: '0' }, { revalidate: 0 });
  return withDefaults(data);
}

/** Coalesced snapshot read. Auto-sync (`router.refresh()`) re-runs the
 *  board/orders/calendar server components every 15-60s on every open tab;
 *  without this, N tabs across M staff would each issue an identical
 *  `SELECT raw FROM ...` against Postgres. `unstable_cache` collapses them
 *  to ONE query per 15s window per audit variant — the dominant lever for
 *  Postgres network-transfer cost (diagnosed 2026-05-18: 5.6GB/8d).
 *
 *  Freshness: write routes call `revalidateTag(LOAD_ALL_TAG)` (via
 *  `bustLoadAllCache()`) on success, so a mutation shows up on the very
 *  next render — the 15s TTL only bounds the no-write idle-poll case. */
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

/** Fetch loadAll with no caching — for write-path lookups (nextId allocation, etc).
 *  Skips audit (write paths never need audit history). */
export async function loadAllFresh(): Promise<LoadAllResponse> {
  const data = await get<Partial<LoadAllResponse>>('loadAll', { audit: '0' }, { revalidate: 0 });
  return withDefaults(data);
}

/** ⚠️ Bypasses the Postgres-first wrapper — always reads from Apps Script.
 *  Used ONLY by `lib/sync-from-sheet.ts` to refresh the Postgres mirror
 *  from Sheet. If sync-from-sheet went through `loadAllWithAudit()` it
 *  would hit the Postgres branch (when READ_FROM_POSTGRES=1) and read
 *  the same stale mirror it's supposed to refresh — a bootstrap loop
 *  that silently froze today's Sheet entries from ever reaching Postgres
 *  (the 2026-05-11 audit visibility bug). */
export async function loadAllFromAppsScriptForSync(): Promise<LoadAllResponse> {
  const data = await get<Partial<LoadAllResponse>>('loadAll', undefined, { revalidate: 0 });
  return withDefaults(data);
}

/** Postgres-first single-order lookup with its active jobs.
 *  Reads Postgres directly (no cache) so Phase 2 writes are visible
 *  immediately. Falls back to Apps Script `loadAllFresh` for Phase 1.7
 *  stragglers (rows mirrored but not yet in Postgres).
 *
 *  Used by any write path that needs "look up order + cascade ops on its
 *  jobs": promote-draft, /api/orders/update (cascade rename), and the
 *  legacy fallback branches of /api/orders/cancel + /api/orders/delete.
 *  Callers that scan ALL orders/jobs (not just one order's) still need
 *  loadAllFresh — this helper is for the single-order pattern only.
 *
 *  Recurring-bug history: third occurrence of the same Phase 2 stale-read
 *  pattern. Round 1 (1f62d3b) created this helper for promote-draft;
 *  Round 2 (c0be3b8) refactored loadOrder() to Postgres-first; Round 3
 *  (today) widened it to /api/orders/update — see memory rule
 *  "loadOrder must stay Postgres-first". */
export async function loadOrderAndJobs(id: number): Promise<{
  order: Record<string, unknown> | null;
  jobs: Array<Record<string, unknown>>;
}> {
  const { isPostgresConfigured, sql } = await import('@/lib/postgres');
  if (isPostgresConfigured()) {
    try {
      const oR = await sql<{ raw: Record<string, unknown> | null }>`
        SELECT raw FROM orders WHERE id = ${id}::bigint LIMIT 1
      `;
      if (oR.rows[0]?.raw) {
        const jR = await sql<{ raw: Record<string, unknown> | null }>`
          SELECT raw FROM jobs
          WHERE order_id = ${id}::bigint AND phase2_deleted_at IS NULL
        `;
        return {
          order: oR.rows[0].raw,
          jobs: jR.rows.map((r) => r.raw).filter((r): r is Record<string, unknown> => !!r),
        };
      }
      // Order not in Postgres — fall through to Apps Script
    } catch {
      // Fall through to Apps Script
    }
  }
  const snap = await loadAllFresh();
  return {
    order: (snap.orders.find((o) => Number(o.id) === id) ?? null) as Record<string, unknown> | null,
    jobs: snap.jobs.filter((j) => Number(j.orderId) === id) as unknown as Array<Record<string, unknown>>,
  };
}

/** Single-order lookup — Postgres-first with Apps Script fallback.
 *  Used by hot paths that only need one order's rawData (order detail
 *  modal "สเปคงาน" tab, /track lookup, /api/orders/raw, print page,
 *  tracking-card, restore).
 *
 *  Routing: always tries `loadOrderFromPostgres` first (sees Phase 2
 *  writes instantly). On `PostgresStaleError` (row not in mirror yet or
 *  mirror unconfigured) falls through to Apps Script `getOrder` action.
 *
 *  `revalidate` controls the Next.js fetch cache TTL on the Apps Script
 *  FALLBACK only — Postgres reads aren't cached at the fetch layer.
 *  Pass 0 if the Apps Script fallback needs to bust cache (e.g. caller
 *  just wrote to Sheet via a legacy path). Pass 30 for read-display
 *  hot paths that want repeat opens within 30s to skip the round-trip.
 *
 *  `orderOnly` — set when the caller reads ONLY `.order` (never `.job`,
 *  `.shipped`, `.cancelled`). The Postgres path then runs 1 query instead
 *  of 4; those three keys come back null. */
export interface LoadOrderResponse {
  order: Order | null;
  job: Record<string, unknown> | null;
  shipped: Record<string, unknown> | null;
  cancelled: Record<string, unknown> | null;
}
export async function loadOrder(
  id: number | string,
  opts: { revalidate?: number; orderOnly?: boolean } = {},
): Promise<LoadOrderResponse> {
  // Postgres-first always. Phase 2 (2026-05-11) made Postgres the source
  // of truth for createOrder/updateOrder/promote/cancel/forward/move —
  // writes land in Postgres instantly; Sheet lags up to 5 min via heal
  // cron. The pre-Phase-2 carve-out (skip Postgres when revalidate=0)
  // assumed the opposite staleness model and caused the 2026-05-12
  // print-page bugs:
  //   - "พิมพ์+ส่ง" 404 on brand-new orders (Sheet doesn't have row yet)
  //   - print page showing pre-edit values after updateOrder
  // Sister fix: 1f62d3b (promote-draft) added loadOrderAndJobs
  // as a workaround helper. This refactor closes the root cause so future
  // Phase 2 actions don't bring back the same shape of bug.
  //
  // loadOrderFromPostgres throws PostgresStaleError on row-not-found /
  // mirror-stale → tryPostgres returns null → fall through to Apps
  // Script (which is the right behavior for Phase 1.x stragglers).
  const pg = await tryPostgres('loadOrder', async () => {
    const { loadOrderFromPostgres } = await import('@/lib/api-postgres');
    return loadOrderFromPostgres(id, { orderOnly: opts.orderOnly });
  });
  if (pg) return pg;
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

/** Resolve the operator identity for audit logging.
 *
 *  Returns `"<role>:<user>"` (e.g. `"admin:nook"`) when called from inside
 *  a Next.js request handler with a valid dashboard session cookie.
 *  Returns `undefined` when:
 *    - there's no request context (build-time, edge-instrumentation, scripts)
 *    - the dynamic `next/headers` import fails (only available in Node
 *      runtime; edge route handlers that need actor identity should pass
 *      `_actor` explicitly via the `post()` body instead)
 *    - the session cookie is missing or invalid (logged-out caller)
 *
 *  When `undefined`, `post()` omits `_actor` from the payload entirely —
 *  Apps Script falls back to the service identity `"admin:dashboard"`
 *  encoded in `APPS_SCRIPT_TOKEN`. Apps Script v5.10.1+ honours `_actor`
 *  and overrides the service identity in audit_log entries; older
 *  versions ignore the field. (Auditor L2 finding — doc clarity.) */
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
  // revalidatePath here targets the Apps Script fetch ISR cache (per-path);
  // revalidateTag(LOAD_ALL_TAG) busts the loadAll() unstable_cache snapshot
  // — these are separate caches and a write must clear both. (The earlier
  // "fetch options tagging unstable on Vercel" note was about fetch-level
  // `next.tags`, not unstable_cache tags — those are reliable.)
  const paths = PATHS_BY_ACTION[action];
  if (paths && paths.length > 0) {
    try {
      const { revalidatePath, revalidateTag } = await import('next/cache');
      for (const p of paths) revalidatePath(p);
      revalidateTag(LOAD_ALL_TAG);
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
