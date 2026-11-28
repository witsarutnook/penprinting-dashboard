import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/postgres', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import { encryptSecret, decryptSecret } from '@/lib/peak/crypto';
import { PeakAuthError, PeakUnavailableError, type PeakTokenSet } from '@/lib/peak/oauth';
import {
  PeakNotConnectedError,
  claimDailyAlert,
  getPeakAccessToken,
  getPeakClientId,
  getPeakConnectionStatus,
  recordPeakError,
  releaseDailyAlert,
  recordPeakOk,
  savePeakClient,
  savePeakTokens,
} from '@/lib/peak/token-store';

const KEY = randomBytes(32).toString('base64');
const ORIGINAL_ENV = process.env.PEAK_TOKEN_ENC_KEY;
process.env.PEAK_TOKEN_ENC_KEY = KEY;
afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PEAK_TOKEN_ENC_KEY;
  else process.env.PEAK_TOKEN_ENC_KEY = ORIGINAL_ENV;
});

const NOW = Date.parse('2026-11-14T03:00:00Z');
const nowMs = () => NOW;
const OLD_AT = 'OLD-ACCESS-SENTINEL';
const OLD_RT = 'OLD-REFRESH-SENTINEL';
const NEW_AT = 'NEW-ACCESS-SENTINEL';
const NEW_RT = 'NEW-REFRESH-SENTINEL';
const PLAINTEXTS = [OLD_AT, OLD_RT, NEW_AT, NEW_RT];

type Q = { text: string; values: unknown[] };
const queries: Q[] = [];
type Handler = (q: Q) => { rows: unknown[]; rowCount?: number } | Promise<never>;
let handler: Handler = () => ({ rows: [] });

beforeEach(() => {
  sqlMock.mockReset();
  queries.length = 0;
  sqlMock.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const q = { text: strings.join('?'), values };
    queries.push(q);
    const r = await handler(q);
    return { rowCount: r.rows.length, ...r };
  });
});

function row(over: Record<string, unknown> = {}) {
  return {
    client_id: 'cid-1',
    access_token_enc: encryptSecret(OLD_AT),
    refresh_token_enc: encryptSecret(OLD_RT),
    access_expires_at: new Date(NOW + 60 * 60_000),
    scope: 'mcp:read',
    refresh_lock_until: null,
    last_ok_at: null,
    last_error: null,
    last_error_at: null,
    ...over,
  };
}

const isSelect = (q: Q) => /^\s*SELECT/i.test(q.text);
const isLock = (q: Q) => q.text.includes('NOW() + INTERVAL') && q.text.includes('RETURNING');
const isSaveTokens = (q: Q) => q.text.includes('refresh_token_enc =');
const isErrorRecord = (q: Q) => q.text.includes('last_error =') && !isSaveTokens(q);
const isLockClear = (q: Q) => q.text.includes('refresh_lock_until = NULL') && !isSaveTokens(q);

const tokenSet = (over: Partial<PeakTokenSet> = {}): PeakTokenSet => ({
  accessToken: NEW_AT,
  refreshToken: NEW_RT,
  expiresInSec: 3600,
  scope: 'mcp:read',
  ...over,
});

const noSleep = vi.fn(async () => {});

function expectNoPlaintextParams() {
  for (const q of queries) {
    for (const v of q.values) {
      for (const p of PLAINTEXTS) {
        expect(String(v)).not.toContain(p);
      }
    }
  }
}

describe('getPeakAccessToken', () => {
  beforeEach(() => noSleep.mockClear());

  it('no row -> PeakNotConnectedError', async () => {
    handler = () => ({ rows: [] });
    const refresh = vi.fn();
    await expect(getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs })).rejects.toBeInstanceOf(
      PeakNotConnectedError,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('row without refresh token -> PeakNotConnectedError', async () => {
    handler = () => ({ rows: [row({ refresh_token_enc: null, access_token_enc: null })] });
    await expect(
      getPeakAccessToken({}, { refresh: vi.fn(), sleep: noSleep, nowMs }),
    ).rejects.toBeInstanceOf(PeakNotConnectedError);
  });

  it('fresh token -> returned, refresh not called', async () => {
    handler = () => ({ rows: [row()] });
    const refresh = vi.fn();
    await expect(getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs })).resolves.toBe(OLD_AT);
    expect(refresh).not.toHaveBeenCalled();
    expect(queries.some(isLock)).toBe(false);
  });

  it('expiring token + lock won -> refresh once, persists new refresh token, returns new access', async () => {
    const r = row({ access_expires_at: new Date(NOW + 2 * 60_000) });
    handler = (q) => {
      if (isSelect(q)) return { rows: [r] };
      if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
      if (isSaveTokens(q)) return { rows: [{ id: 'peak' }] };
      return { rows: [] };
    };
    const refresh = vi.fn(async () => tokenSet());
    await expect(getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs })).resolves.toBe(NEW_AT);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith({ clientId: 'cid-1', refreshToken: OLD_RT });
    const save = queries.find(isSaveTokens)!;
    expect(save).toBeDefined();
    const decrypted = save.values
      .filter((v): v is string => typeof v === 'string' && v.startsWith('v1.'))
      .map((v) => decryptSecret(v));
    expect(decrypted).toContain(NEW_RT);
    expect(decrypted).toContain(NEW_AT);
    expect(save.text).toContain('refresh_lock_until = NULL');
    expect(save.text).toContain('last_error = NULL');
    expectNoPlaintextParams();
  });

  it('lock lost -> never refreshes; returns the token another holder wrote on the 2nd poll', async () => {
    const expiring = row({ access_expires_at: new Date(NOW + 60_000) });
    const updated = row({
      access_token_enc: encryptSecret(NEW_AT),
      refresh_token_enc: encryptSecret(NEW_RT),
      access_expires_at: new Date(NOW + 60 * 60_000),
    });
    let selects = 0;
    handler = (q) => {
      if (isSelect(q)) {
        selects += 1;
        return { rows: [selects >= 3 ? updated : expiring] };
      }
      return { rows: [] }; // lock UPDATE returns nothing -> lost
    };
    const refresh = vi.fn();
    const sleep = vi.fn(async () => {});
    await expect(getPeakAccessToken({}, { refresh, sleep, nowMs })).resolves.toBe(NEW_AT);
    expect(refresh).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('lock lost, never updated -> PeakUnavailableError after 10 sleeps', async () => {
    const expiring = row({ access_expires_at: new Date(NOW + 60_000) });
    handler = (q) => (isSelect(q) ? { rows: [expiring] } : { rows: [] });
    const refresh = vi.fn();
    const sleep = vi.fn(async () => {});
    await expect(getPeakAccessToken({}, { refresh, sleep, nowMs })).rejects.toBeInstanceOf(
      PeakUnavailableError,
    );
    expect(sleep).toHaveBeenCalledTimes(10);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refresh -> PeakAuthError: error recorded, lock cleared, rethrown', async () => {
    const r = row({ access_expires_at: new Date(NOW - 60_000) });
    handler = (q) => {
      if (isSelect(q)) return { rows: [r] };
      if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
      return { rows: [{ id: 'peak' }] };
    };
    const boom = new PeakAuthError('Peak /oauth/token rejected: 400 invalid_grant');
    const refresh = vi.fn(async () => {
      throw boom;
    });
    await expect(getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs })).rejects.toBe(boom);
    const rec = queries.find(isErrorRecord);
    expect(rec).toBeDefined();
    expect(rec!.values).toContain('Peak /oauth/token rejected: 400 invalid_grant');
    expect(queries.some((q) => q.text.includes('refresh_lock_until = NULL'))).toBe(true);
    expect(queries.some(isSaveTokens)).toBe(false);
    expectNoPlaintextParams();
  });

  it('refresh -> PeakUnavailableError: lock cleared, rethrown, no error record', async () => {
    const r = row({ access_expires_at: new Date(NOW - 60_000) });
    handler = (q) => {
      if (isSelect(q)) return { rows: [r] };
      if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
      return { rows: [{ id: 'peak' }] };
    };
    const boom = new PeakUnavailableError('Peak /oauth/token returned 503');
    await expect(
      getPeakAccessToken({}, { refresh: vi.fn(async () => { throw boom; }), sleep: noSleep, nowMs }),
    ).rejects.toBe(boom);
    expect(queries.some(isLockClear)).toBe(true);
    expect(queries.some(isErrorRecord)).toBe(false);
  });

  // Audit 2026-11-27 (M2-refresh-save-single-attempt). Peak rotates the refresh token on every
  // refresh: once it has answered, the old one is spent and the returned set is the ONLY copy of
  // the new one. The save used to be tried once — one failed write threw the set away, and every
  // later refresh sent the spent token until an admin reconnected by hand. It is now tried up to
  // three times (inside the 30 s lease) before giving up.
  describe('storing a freshly rotated token', () => {
    const expired = () => row({ access_expires_at: new Date(NOW - 60_000) });
    /** Lock won; the save rejects for the first `failures` attempts, then succeeds. */
    function saveFailsFirst(failures: number) {
      const r = expired();
      let saves = 0;
      handler = (q) => {
        if (isSelect(q)) return { rows: [r] };
        if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
        if (isSaveTokens(q)) return ++saves <= failures ? Promise.reject(new Error('db down')) : { rows: [{ id: 'peak' }] };
        return { rows: [{ id: 'peak' }] };
      };
    }
    /** What each save attempt WRITES: [access, refresh] — the first two parameters (the last two are the guard). */
    const savedRefreshTokens = () =>
      queries.filter(isSaveTokens).map((q) => q.values.slice(0, 2).map((v) => decryptSecret(String(v))));

    it('the save fails once, then works: the new token is kept — no error, no reconnect needed', async () => {
      saveFailsFirst(1);
      const refresh = vi.fn(async () => tokenSet());
      const sleep = vi.fn(async () => {});
      await expect(getPeakAccessToken({}, { refresh, sleep, nowMs })).resolves.toBe(NEW_AT);
      expect(queries.filter(isSaveTokens)).toHaveLength(2);
      expect(queries.some(isErrorRecord)).toBe(false);
      expect(sleep).toHaveBeenCalledTimes(1);
      expectNoPlaintextParams();
    });

    it('the save fails twice, the third works', async () => {
      saveFailsFirst(2);
      const sleep = vi.fn(async () => {});
      await expect(getPeakAccessToken({}, { refresh: vi.fn(async () => tokenSet()), sleep, nowMs })).resolves.toBe(NEW_AT);
      expect(queries.filter(isSaveTokens)).toHaveLength(3);
      expect(queries.some(isErrorRecord)).toBe(false);
      expect(sleep).toHaveBeenCalledTimes(2);
    });

    it('Peak is asked once: every attempt stores the same new pair, the spent token is never sent again', async () => {
      saveFailsFirst(2);
      const refresh = vi.fn(async () => tokenSet());
      await getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs });
      expect(refresh).toHaveBeenCalledTimes(1);
      const attempts = savedRefreshTokens();
      expect(attempts).toHaveLength(3);
      for (const stored of attempts) {
        expect(stored).toEqual([NEW_AT, NEW_RT]);
      }
    });

    it('the waits between attempts are short enough to stay inside the 30 s lease', async () => {
      saveFailsFirst(2);
      const sleep = vi.fn(async (_ms: number) => {});
      await getPeakAccessToken({}, { refresh: vi.fn(async () => tokenSet()), sleep, nowMs });
      const waited = sleep.mock.calls.reduce((sum, [ms]) => sum + ms, 0);
      expect(waited).toBeGreaterThan(0);
      expect(waited).toBeLessThanOrEqual(5_000);
    });

    // Independent review 2026-11-28: a retry must not be a blind second write. If attempt 1 did
    // commit (and only its answer was lost) the lease is free again; another refresh can rotate
    // the token before the retry runs, and a blind retry would put the older pair back — the next
    // refresh would then be refused. Every attempt writes only while the row still holds the
    // refresh token this refresh started from (compare-and-swap).
    it('every attempt is a compare-and-swap on the refresh token read with the lease', async () => {
      const r = expired();
      // The lease hands back its own value — NOT the one the first read saw (another refresh may
      // have completed in between). Encrypting again gives a different ciphertext of the same
      // token, so a guard taken from the first read would be told apart here (second review).
      const leased = encryptSecret(OLD_RT);
      expect(leased).not.toBe(r.refresh_token_enc);
      let saves = 0;
      handler = (q) => {
        if (isSelect(q)) return { rows: [r] };
        if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: leased }] };
        if (isSaveTokens(q)) return ++saves <= 2 ? Promise.reject(new Error('db down')) : { rows: [{ id: 'peak' }] };
        return { rows: [{ id: 'peak' }] };
      };
      await getPeakAccessToken({}, { refresh: vi.fn(async () => tokenSet()), sleep: noSleep, nowMs });
      const attempts = queries.filter(isSaveTokens);
      expect(attempts).toHaveLength(3);
      for (const q of attempts) {
        expect(q.text.replace(/\s+/g, ' ')).toContain("WHERE id = 'peak' AND (?::text IS NULL OR refresh_token_enc = ?) RETURNING id");
        // the guard = the ciphertext the lease handed back — not the first read's, not a re-encryption
        expect(q.values.slice(-2)).toEqual([leased, leased]);
        // access first, refresh second — and the same scope every time
        expect(decryptSecret(String(q.values[0]))).toBe(NEW_AT);
        expect(decryptSecret(String(q.values[1]))).toBe(NEW_RT);
        expect(q.values[3]).toBe('mcp:read');
      }
      // the lease is not given up between attempts (only a save releases it)
      expect(queries.filter(isLockClear)).toHaveLength(0);
    });

    it('the retry finds a different token in the row (attempt 1 had landed, or a newer pair is stored): nothing is overwritten, no error', async () => {
      const r = expired();
      let saves = 0;
      handler = (q) => {
        if (isSelect(q)) return { rows: [r] };
        if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
        if (isSaveTokens(q)) return ++saves === 1 ? Promise.reject(new Error('connection reset')) : { rows: [] };
        return { rows: [{ id: 'peak' }] };
      };
      const refresh = vi.fn(async () => tokenSet());
      await expect(getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs })).resolves.toBe(NEW_AT);
      expect(queries.filter(isSaveTokens)).toHaveLength(2); // no third attempt
      expect(queries.some(isErrorRecord)).toBe(false);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('an admin reconnected while Peak was answering (the row holds another token): the new grant is left alone, no error', async () => {
      const r = expired();
      handler = (q) => {
        if (isSelect(q)) return { rows: [r] };
        if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
        if (isSaveTokens(q)) return { rows: [] }; // compare-and-swap found another refresh token
        return { rows: [{ id: 'peak' }] };
      };
      await expect(getPeakAccessToken({}, { refresh: vi.fn(async () => tokenSet()), sleep: noSleep, nowMs })).resolves.toBe(NEW_AT);
      expect(queries.filter(isSaveTokens)).toHaveLength(1);
      expect(queries.some(isErrorRecord)).toBe(false);
    });

    it('the save fails every time -> three attempts, then PeakAuthError + error record', async () => {
      saveFailsFirst(99);
      const refresh = vi.fn(async () => tokenSet());
      const err = await getPeakAccessToken({}, { refresh, sleep: noSleep, nowMs }).catch((e) => e);
      expect(err).toBeInstanceOf(PeakAuthError);
      expect(String(err.message)).not.toContain(NEW_AT);
      expect(String(err.message)).not.toContain(NEW_RT);
      expect(queries.filter(isSaveTokens)).toHaveLength(3);
      expect(refresh).toHaveBeenCalledTimes(1);
      const rec = queries.find(isErrorRecord);
      expect(rec).toBeDefined();
      expect(rec!.values).toContain('token refresh succeeded but persisting the new token failed');
      // the error is recorded after the last attempt, not between attempts
      expect(queries.indexOf(rec!)).toBeGreaterThan(queries.lastIndexOf(queries.filter(isSaveTokens).at(-1)!));
      expectNoPlaintextParams();
    });
  });

  it('persist failure + error record failure -> still PeakAuthError', async () => {
    const r = row({ access_expires_at: new Date(NOW - 60_000) });
    handler = (q) => {
      if (isSelect(q)) return { rows: [r] };
      if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
      return Promise.reject(new Error('db down'));
    };
    await expect(
      getPeakAccessToken({}, { refresh: vi.fn(async () => tokenSet()), sleep: noSleep, nowMs }),
    ).rejects.toBeInstanceOf(PeakAuthError);
  });

  it('forceRefresh with a fresh token still refreshes', async () => {
    const r = row();
    handler = (q) => {
      if (isSelect(q)) return { rows: [r] };
      if (isLock(q)) return { rows: [{ client_id: r.client_id, refresh_token_enc: r.refresh_token_enc }] };
      return { rows: [{ id: 'peak' }] };
    };
    const refresh = vi.fn(async () => tokenSet());
    await expect(
      getPeakAccessToken({ forceRefresh: true }, { refresh, sleep: noSleep, nowMs }),
    ).resolves.toBe(NEW_AT);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh + lock lost does not hand back the same (rejected) token', async () => {
    const r = row();
    handler = (q) => (isSelect(q) ? { rows: [r] } : { rows: [] });
    const sleep = vi.fn(async () => {});
    await expect(
      getPeakAccessToken({ forceRefresh: true }, { refresh: vi.fn(), sleep, nowMs }),
    ).rejects.toBeInstanceOf(PeakUnavailableError);
    expect(sleep).toHaveBeenCalledTimes(10);
  });
});

describe('refresh lease statement (pinned)', () => {
  it('the lease is taken only when no lease is held or the held one has expired', async () => {
    handler = (q) => {
      if (isSelect(q)) return { rows: [row({ access_expires_at: new Date(NOW - 1000) })] };
      if (isLock(q)) return { rows: [{ client_id: 'cid-1', refresh_token_enc: encryptSecret(OLD_RT) }] };
      return { rows: [] };
    };
    // Only the lease statement's text matters here; the outcome of the rest is covered above.
    await getPeakAccessToken({}, { refresh: async () => tokenSet(), sleep: noSleep, nowMs }).catch(() => undefined);
    const lock = queries.find(isLock)!;
    const flat = lock.text.replace(/\s+/g, ' ');
    expect(flat).toContain("SET refresh_lock_until = NOW() + INTERVAL '30 seconds'");
    expect(flat).toContain("WHERE id = 'peak' AND (refresh_lock_until IS NULL OR refresh_lock_until < NOW())");
  });
});

describe('savePeakTokens', () => {
  const expiryParam = (q: Q) =>
    q.values.find((v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) as string;

  it('encrypts both tokens, stores expiry = now + expires_in, clears lock + error', async () => {
    handler = () => ({ rows: [{ id: 'peak' }] });
    const before = Date.now();
    await savePeakTokens(tokenSet({ expiresInSec: 1800 }));
    const q = queries.find(isSaveTokens)!;
    const exp = Date.parse(expiryParam(q));
    expect(exp).toBeGreaterThanOrEqual(before + 1800_000);
    expect(exp).toBeLessThanOrEqual(Date.now() + 1800_000);
    expect(q.text).toContain('refresh_lock_until = NULL');
    expect(q.text).toContain('last_error = NULL');
    expectNoPlaintextParams();
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    'non-positive / non-finite expiresInSec (%s) is treated as 3600s',
    async (expiresInSec) => {
      handler = () => ({ rows: [{ id: 'peak' }] });
      const before = Date.now();
      await savePeakTokens(tokenSet({ expiresInSec }));
      const exp = Date.parse(expiryParam(queries.find(isSaveTokens)!));
      expect(exp).toBeGreaterThanOrEqual(before + 3600_000);
      expect(exp).toBeLessThanOrEqual(Date.now() + 3600_000);
    },
  );

  it('throws when no peak_oauth row exists (client not registered)', async () => {
    handler = () => ({ rows: [] });
    await expect(savePeakTokens(tokenSet())).rejects.toThrow();
  });

  it('is unconditional (the OAuth callback stores a brand-new grant): the guard parameters are null', async () => {
    handler = () => ({ rows: [{ id: 'peak' }] });
    await savePeakTokens(tokenSet());
    const q = queries.find(isSaveTokens)!;
    expect(q.values.slice(-2)).toEqual([null, null]);
  });
});

describe('client + status + health helpers', () => {
  it('getPeakClientId returns the id or null', async () => {
    handler = () => ({ rows: [{ client_id: 'cid-9' }] });
    await expect(getPeakClientId()).resolves.toBe('cid-9');
    handler = () => ({ rows: [] });
    await expect(getPeakClientId()).resolves.toBeNull();
  });

  it('savePeakClient upserts id=peak', async () => {
    handler = () => ({ rows: [] });
    await savePeakClient('cid-2');
    expect(queries).toHaveLength(1);
    expect(queries[0].text).toContain('INSERT INTO peak_oauth');
    expect(queries[0].text).toContain('ON CONFLICT');
    expect(queries[0].values).toContain('cid-2');
  });

  it('getPeakConnectionStatus maps the row without exposing tokens', async () => {
    handler = () => ({
      rows: [
        row({
          last_ok_at: new Date('2026-11-14T01:00:00Z'),
          last_error: 'boom',
          last_error_at: new Date('2026-11-13T01:00:00Z'),
        }),
      ],
    });
    const s = await getPeakConnectionStatus();
    expect(s).toEqual({
      clientRegistered: true,
      connected: true,
      scope: 'mcp:read',
      accessExpiresAt: new Date(NOW + 60 * 60_000).toISOString(),
      lastOkAt: '2026-11-14T01:00:00.000Z',
      lastError: 'boom',
      lastErrorAt: '2026-11-13T01:00:00.000Z',
    });
    expect(JSON.stringify(s)).not.toContain('v1.');
  });

  it('getPeakConnectionStatus with no row', async () => {
    handler = () => ({ rows: [] });
    await expect(getPeakConnectionStatus()).resolves.toEqual({
      clientRegistered: false,
      connected: false,
      scope: null,
      accessExpiresAt: null,
      lastOkAt: null,
      lastError: null,
      lastErrorAt: null,
    });
  });

  it('recordPeakOk / recordPeakError issue updates', async () => {
    handler = () => ({ rows: [] });
    await recordPeakOk();
    expect(queries[0].text).toContain('last_ok_at = NOW()');
    await recordPeakError('x'.repeat(2000));
    expect(isErrorRecord(queries[1])).toBe(true);
    const msg = queries[1].values.find((v) => typeof v === 'string') as string;
    expect(msg.length).toBeLessThanOrEqual(500);
  });

  it('claimDailyAlert true when the UPDATE returns a row, false when none', async () => {
    handler = () => ({ rows: [{ id: 'peak' }] });
    await expect(claimDailyAlert()).resolves.toBe(true);
    expect(queries[0].text).toContain('last_alert_at');
    // 20 h, not 24 h: a daily cron firing a few seconds early must still alert (cron jitter)
    expect(queries[0].text).toContain("last_alert_at < NOW() - INTERVAL '20 hours'");
    expect(queries[0].text).not.toContain('24 hours');
    handler = () => ({ rows: [] });
    await expect(claimDailyAlert()).resolves.toBe(false);
  });

  it('releaseDailyAlert gives the slot back (last_alert_at = NULL on the peak row)', async () => {
    handler = () => ({ rows: [] });
    await releaseDailyAlert();
    expect(queries).toHaveLength(1);
    expect(queries[0].text.replace(/\s+/g, ' ').trim()).toBe("UPDATE peak_oauth SET last_alert_at = NULL WHERE id = 'peak'");
  });
});

import { it as itName, expect as expectName } from 'vitest';
itName('error class names are stable (survive minification)', async () => {
  expectName(new (await import('@/lib/peak/token-store')).PeakNotConnectedError('m').name).toBe('PeakNotConnectedError');
  expectName(new (await import('@/lib/peak/token-store')).PeakNotConnectedError('m')).toBeInstanceOf(Error);
});
