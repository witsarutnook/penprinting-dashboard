import 'server-only';
import type { LoadAllResponse } from './types';

/**
 * Fetch wrapper for the legacy Apps Script API at app.penprinting.co.
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

/** Fetch the full snapshot used by the dashboard frontend (60s ISR cache). */
export async function loadAll(): Promise<LoadAllResponse> {
  const data = await get<Partial<LoadAllResponse>>('loadAll');
  return withDefaults(data);
}

/** Fetch loadAll with no caching — for write-path lookups (nextId allocation, etc). */
export async function loadAllFresh(): Promise<LoadAllResponse> {
  const data = await get<Partial<LoadAllResponse>>('loadAll', {}, { revalidate: 0 });
  return withDefaults(data);
}

/** Per-action invalidation map. After a successful write we revalidate
 *  ONLY the paths whose data shape actually changes — pages outside this
 *  set keep their warm 60s ISR cache, so navigating to them feels
 *  instant instead of triggering a fresh Apps Script roundtrip.
 *
 *  Page → data dependency:
 *  - /board     uses jobs + orders (cowork) + audit (undo)
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
  // Templates only show up in order entry
  addTemplate:    ['/orders/new'],
  deleteTemplate: ['/orders/new'],
  // getNextId / getNextOrderId — counter mints, no Sheet data changes,
  // explicitly NOT in this map so they don't bust anything.
};

/** POST {action, token, ...body} — mirrors WP `apiPost`. Used for actions that
 *  take complex bodies (searchArchive, bulkForward, mutations) — token goes in body.
 *
 *  ⚠️ For mutations: always pass `revalidate: 0` (default) to bypass fetch cache —
 *  we never want to cache write operations. After a successful write, also
 *  invalidates the loadAll tag so the next router.refresh() returns fresh data
 *  instead of the (up to 60s) ISR cache. */
export async function post<T>(action: string, body: Record<string, unknown> = {}, opts: { revalidate?: number } = {}): Promise<T> {
  const { url, token } = getApiBase();
  const payload = JSON.stringify({ action, token, ...body });
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
