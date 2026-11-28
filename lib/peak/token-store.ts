import 'server-only';
import { sql } from '@/lib/postgres';
import { decryptSecret, encryptSecret } from '@/lib/peak/crypto';
import {
  PeakAuthError,
  PeakUnavailableError,
  refreshPeakTokens,
  type PeakTokenSet,
} from '@/lib/peak/oauth';

/**
 * Single-row (`id = 'peak'`) store for the Peak OAuth connection.
 * Tokens are stored AES-256-GCM encrypted (lib/peak/crypto.ts); plaintext
 * tokens never appear in SQL parameters, logs, errors or return values other
 * than getPeakAccessToken's result.
 *
 * Refresh is single-flight across instances: Peak refresh tokens rotate
 * (single use), so a DB lease (`refresh_lock_until`, conditional UPDATE …
 * RETURNING) picks one refresher; the others poll for the token it writes.
 */

export class PeakNotConnectedError extends Error {
  // explicit: constructor.name is mangled by production minification
  name = 'PeakNotConnectedError';
}

export interface PeakConnectionStatus {
  clientRegistered: boolean;
  connected: boolean;
  scope: string | null;
  accessExpiresAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface PeakOauthRow {
  client_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  access_expires_at: Date | string | null;
  scope: string | null;
  last_ok_at: Date | string | null;
  last_error: string | null;
  last_error_at: Date | string | null;
}

const MIN_REMAINING_MS = 5 * 60_000;
const POLL_TRIES = 10;
const POLL_MS = 500;
/** Waits before the 2nd and 3rd attempt to store a freshly rotated token (3 attempts in all) —
 *  far inside the 30 s refresh lease. */
const SAVE_RETRY_WAITS_MS = [250, 750];
const DEFAULT_EXPIRES_SEC = 3600;
const MAX_ERROR_LEN = 500;

function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function remainingMs(row: PeakOauthRow, nowMs: number): number {
  const iso = toIso(row.access_expires_at);
  return iso ? Date.parse(iso) - nowMs : -Infinity;
}

async function readRow(): Promise<PeakOauthRow | null> {
  const { rows } = await sql`
    SELECT client_id, access_token_enc, refresh_token_enc, access_expires_at, scope,
           last_ok_at, last_error, last_error_at
      FROM peak_oauth WHERE id = 'peak'`;
  return (rows[0] as PeakOauthRow | undefined) ?? null;
}

export async function getPeakClientId(): Promise<string | null> {
  const { rows } = await sql`SELECT client_id FROM peak_oauth WHERE id = 'peak'`;
  const id = (rows[0] as { client_id?: unknown } | undefined)?.client_id;
  return typeof id === 'string' && id ? id : null;
}

/** Upsert the registered client. A different client_id drops the old tokens (they belong to the old client). */
export async function savePeakClient(clientId: string): Promise<void> {
  await sql`
    INSERT INTO peak_oauth (id, client_id, updated_at)
    VALUES ('peak', ${clientId}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      access_token_enc  = CASE WHEN peak_oauth.client_id = EXCLUDED.client_id THEN peak_oauth.access_token_enc  ELSE NULL END,
      refresh_token_enc = CASE WHEN peak_oauth.client_id = EXCLUDED.client_id THEN peak_oauth.refresh_token_enc ELSE NULL END,
      access_expires_at = CASE WHEN peak_oauth.client_id = EXCLUDED.client_id THEN peak_oauth.access_expires_at ELSE NULL END,
      client_id = EXCLUDED.client_id,
      updated_at = NOW()`;
}

/**
 * Encrypt + store a token set, release the refresh lease, clear the last error.
 * With `ifRefreshEnc`, only while the row still holds that refresh-token ciphertext
 * (compare-and-swap). Returns false, writing nothing, when no row matched.
 */
async function writePeakTokens(t: PeakTokenSet, ifRefreshEnc: string | null): Promise<boolean> {
  const accessEnc = encryptSecret(t.accessToken);
  const refreshEnc = encryptSecret(t.refreshToken);
  // Peak may omit / garble expires_in → treat non-positive or non-finite as 1h
  // so we do not refresh on every call.
  const sec =
    Number.isFinite(t.expiresInSec) && t.expiresInSec > 0 ? t.expiresInSec : DEFAULT_EXPIRES_SEC;
  const expiresAt = new Date(Date.now() + sec * 1000).toISOString();
  const res = await sql`
    UPDATE peak_oauth SET
      access_token_enc = ${accessEnc},
      refresh_token_enc = ${refreshEnc},
      access_expires_at = ${expiresAt},
      scope = ${t.scope},
      refresh_lock_until = NULL,
      last_error = NULL,
      last_error_at = NULL,
      updated_at = NOW()
    WHERE id = 'peak' AND (${ifRefreshEnc}::text IS NULL OR refresh_token_enc = ${ifRefreshEnc})
    RETURNING id`;
  return res.rows.length > 0;
}

/** Store a brand-new grant (the OAuth callback), whatever the row holds. */
export async function savePeakTokens(t: PeakTokenSet): Promise<void> {
  if (!(await writePeakTokens(t, null))) {
    throw new Error('peak_oauth row missing — register the Peak client first');
  }
}

async function clearLock(): Promise<void> {
  try {
    await sql`UPDATE peak_oauth SET refresh_lock_until = NULL WHERE id = 'peak'`;
  } catch {
    // best effort — the 30s lease expires on its own
  }
}

export async function getPeakAccessToken(
  opts: { forceRefresh?: boolean } = {},
  deps: {
    refresh?: typeof refreshPeakTokens;
    sleep?: (ms: number) => Promise<void>;
    nowMs?: () => number;
  } = {},
): Promise<string> {
  const refresh = deps.refresh ?? refreshPeakTokens;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.nowMs ?? Date.now;

  // 1. Read
  const row = await readRow();
  if (!row || !row.refresh_token_enc) throw new PeakNotConnectedError('Peak is not connected');

  // 2. Fresh enough
  if (!opts.forceRefresh && row.access_token_enc && remainingMs(row, now()) > MIN_REMAINING_MS) {
    return decryptSecret(row.access_token_enc);
  }

  // 3. Take the lease
  const lock = await sql`
    UPDATE peak_oauth SET refresh_lock_until = NOW() + INTERVAL '30 seconds'
    WHERE id = 'peak' AND (refresh_lock_until IS NULL OR refresh_lock_until < NOW())
    RETURNING client_id, refresh_token_enc`;
  const won = lock.rows[0] as { client_id: string; refresh_token_enc: string | null } | undefined;

  if (won) {
    // 4. Lock won
    let next: PeakTokenSet;
    /** The refresh token this refresh starts from, as stored — what the save below swaps out. */
    let leasedRefreshEnc: string;
    try {
      if (!won.refresh_token_enc) throw new PeakNotConnectedError('Peak is not connected');
      leasedRefreshEnc = won.refresh_token_enc;
      next = await refresh({
        clientId: won.client_id,
        refreshToken: decryptSecret(leasedRefreshEnc),
      });
    } catch (err) {
      if (err instanceof PeakAuthError) {
        try {
          await recordPeakError(err.message);
        } catch {
          // best effort
        }
      }
      await clearLock();
      throw err;
    }
    // The old refresh token is spent the moment Peak answered: `next` is the only copy of the
    // new one. One failed write must not throw it away (audit 2026-11-27, M2 — it used to, and
    // every later refresh then sent the spent token until an admin reconnected by hand). Try
    // again, inside the lease.
    //
    // Every attempt is a compare-and-swap on the refresh token this refresh started from
    // (independent review 2026-11-28): a write whose answer was lost may have landed and freed
    // the lease, and by the time of the retry a newer pair can be in the row (another refresh, or
    // an admin who reconnected) — a blind retry would put the older pair back. No row matched =
    // the row has moved on; our pair is not needed, and nothing is wrong.
    let settled = false;
    for (let attempt = 0; !settled; attempt++) {
      try {
        await writePeakTokens(next, leasedRefreshEnc);
        settled = true;
      } catch {
        if (attempt >= SAVE_RETRY_WAITS_MS.length) break;
        await sleep(SAVE_RETRY_WAITS_MS[attempt]);
      }
    }
    if (!settled) {
      // Every attempt failed: the connection is lost until an admin reconnects.
      try {
        await recordPeakError('token refresh succeeded but persisting the new token failed');
      } catch {
        // best effort
      }
      throw new PeakAuthError('token refresh succeeded but persisting the new token failed');
    }
    return next.accessToken;
  }

  // 5. Lock lost — wait for the holder's token. It must differ from the one we
  // saw (with forceRefresh the old one was rejected even if not yet expired).
  for (let i = 0; i < POLL_TRIES; i++) {
    await sleep(POLL_MS);
    const cur = await readRow();
    if (
      cur?.access_token_enc &&
      cur.access_token_enc !== row.access_token_enc &&
      remainingMs(cur, now()) > MIN_REMAINING_MS
    ) {
      return decryptSecret(cur.access_token_enc);
    }
  }
  throw new PeakUnavailableError('Peak token refresh in progress elsewhere did not finish in time');
}

export async function getPeakConnectionStatus(): Promise<PeakConnectionStatus> {
  const row = await readRow();
  return {
    clientRegistered: Boolean(row),
    connected: Boolean(row?.refresh_token_enc),
    scope: row?.scope ?? null,
    accessExpiresAt: toIso(row?.access_expires_at),
    lastOkAt: toIso(row?.last_ok_at),
    lastError: row?.last_error ?? null,
    lastErrorAt: toIso(row?.last_error_at),
  };
}

export async function recordPeakOk(): Promise<void> {
  await sql`UPDATE peak_oauth SET last_ok_at = NOW(), updated_at = NOW() WHERE id = 'peak'`;
}

/** Callers must pass messages free of secrets (Peak error classes already are). */
export async function recordPeakError(message: string): Promise<void> {
  const msg = String(message).slice(0, MAX_ERROR_LEN);
  await sql`
    UPDATE peak_oauth SET last_error = ${msg}, last_error_at = NOW(), updated_at = NOW()
    WHERE id = 'peak'`;
}

/**
 * True at most once per 20 h — gates the "Peak connection broken" alert. 20 h
 * (not 24 h) so a daily cron firing a few seconds earlier than yesterday still
 * alerts, while it still alerts at most once per day (spec §6.3).
 */
export async function claimDailyAlert(): Promise<boolean> {
  const { rows } = await sql`
    UPDATE peak_oauth SET last_alert_at = NOW()
    WHERE id = 'peak' AND (last_alert_at IS NULL OR last_alert_at < NOW() - INTERVAL '20 hours')
    RETURNING id`;
  return rows.length > 0;
}

/** Gives a claimed alert slot back (the push failed), so the next run can alert. */
export async function releaseDailyAlert(): Promise<void> {
  await sql`UPDATE peak_oauth SET last_alert_at = NULL WHERE id = 'peak'`;
}
