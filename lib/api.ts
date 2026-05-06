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

/** Fetch the full snapshot used by the dashboard frontend (60s ISR cache). */
export async function loadAll(): Promise<LoadAllResponse> {
  return get<LoadAllResponse>('loadAll');
}

/** Fetch loadAll with no caching — for write-path lookups (nextId allocation, etc). */
export async function loadAllFresh(): Promise<LoadAllResponse> {
  return get<LoadAllResponse>('loadAll', {}, { revalidate: 0 });
}

/** POST {action, token, ...body} — mirrors WP `apiPost`. Used for actions that
 *  take complex bodies (searchArchive, bulkForward, mutations) — token goes in body.
 *
 *  ⚠️ For mutations: always pass `revalidate: 0` (default) to bypass fetch cache —
 *  we never want to cache write operations. */
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
