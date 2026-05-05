import 'server-only';

/**
 * Cookie-based auth — port of WP `pp_sign`/`pp_verify` pattern
 * (page-production-monitoring.php). Uses HMAC-SHA256, format `payload:exp:hex`.
 *
 * Uses Web Crypto API (globalThis.crypto.subtle) so the same code works on
 * Node runtime (API routes) AND Edge runtime (middleware). All ops async.
 *
 * Two env vars required (server-side only):
 *   DASHBOARD_AUTH_SECRET  — random 32+ chars (gen via `openssl rand -hex 32`)
 *   DASHBOARD_AUTH_USERS   — JSON: { "<password>": { "role": "admin"|"sales"|"staff", "user": "<display>" } }
 *
 * Cookie:
 *   name:    pp_dashboard_v6 (separate from WP cookie pp_dashboard_auth_v5)
 *   ttl:     30 days
 *   payload: "<role>|<user>"
 */

export const COOKIE_NAME = 'pp_dashboard_v6';
export const COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

const VALID_ROLES = ['admin', 'sales', 'staff'] as const;
type Role = (typeof VALID_ROLES)[number];

export interface UserMapping {
  role: Role;
  user: string;
}

export interface Session {
  role: Role;
  user: string;
}

class AuthConfigError extends Error {
  constructor(reason: string) {
    super(`Auth config error: ${reason}`);
    this.name = 'AuthConfigError';
  }
}

function getSecret(): string {
  const s = process.env.DASHBOARD_AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new AuthConfigError('DASHBOARD_AUTH_SECRET env var missing or <16 chars');
  }
  return s;
}

const encoder = new TextEncoder();

async function hmacSha256Hex(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const bytes = new Uint8Array(sigBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/** Constant-time string compare (avoid timing leaks on cookie verify). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Look up password against DASHBOARD_AUTH_USERS map. Returns null if invalid. */
export function lookupPassword(password: string): UserMapping | null {
  const raw = process.env.DASHBOARD_AUTH_USERS;
  if (!raw) return null;
  let map: Record<string, UserMapping>;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new AuthConfigError('DASHBOARD_AUTH_USERS is not valid JSON');
  }
  const m = map[password];
  if (!m || !VALID_ROLES.includes(m.role)) return null;
  return m;
}

/** Sign session → cookie value `<payload>:<exp>:<hex>`. */
export async function signSession(role: Role, user: string): Promise<string> {
  const secret = getSecret();
  const payload = `${role}|${user}`;
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const sig = await hmacSha256Hex(`${payload}:${exp}`, secret);
  return `${payload}:${exp}:${sig}`;
}

/** Verify cookie. Returns Session if valid + not expired, else null. */
export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token || typeof token !== 'string') return null;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  const parts = token.split(':');
  if (parts.length < 3) return null;
  const sig = parts.pop()!;
  const exp = parseInt(parts.pop()!, 10);
  const payload = parts.join(':');
  if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmacSha256Hex(`${payload}:${exp}`, secret);
  if (!safeEqual(sig, expected)) return null;
  const [role, user] = payload.split('|');
  if (!VALID_ROLES.includes(role as Role) || !user) return null;
  return { role: role as Role, user };
}
