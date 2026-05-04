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

/** GET ?action=<name> with token. Caller decides what shape to expect. */
async function get<T>(action: string, params: Record<string, string> = {}): Promise<T> {
  const { url, token } = getApiBase();
  const qs = new URLSearchParams({ action, token, ...params });
  const res = await fetch(`${url}?${qs.toString()}`, {
    method: 'GET',
    // Apps Script web apps redirect via 302 to googleusercontent.com — must follow
    redirect: 'follow',
    // Cache for 60s — analytics doesn't need real-time, reduce Apps Script quota burn
    next: { revalidate: 60 },
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

/** Fetch the full snapshot used by the dashboard frontend. */
export async function loadAll(): Promise<LoadAllResponse> {
  return get<LoadAllResponse>('loadAll');
}

export { AppsScriptError };
