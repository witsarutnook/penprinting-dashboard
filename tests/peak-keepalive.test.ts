import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { NotConnected, AuthErr } = vi.hoisted(() => ({
  NotConnected: class extends Error { name = 'PeakNotConnectedError'; },
  AuthErr: class extends Error { name = 'PeakAuthError'; },
}));

const tokenMock = vi.fn();
const okMock = vi.fn();
const errMock = vi.fn();
const claimMock = vi.fn();
const releaseMock = vi.fn();
vi.mock('@/lib/peak/token-store', () => ({
  getPeakAccessToken: (...a: unknown[]) => tokenMock(...a),
  recordPeakOk: (...a: unknown[]) => okMock(...a),
  recordPeakError: (...a: unknown[]) => errMock(...a),
  claimDailyAlert: (...a: unknown[]) => claimMock(...a),
  releaseDailyAlert: (...a: unknown[]) => releaseMock(...a),
  PeakNotConnectedError: NotConnected,
}));
const listMock = vi.fn();
vi.mock('@/lib/peak/mcp-client', () => ({ createPeakClient: () => ({}) }));
vi.mock('@/lib/peak/read', () => ({ createPeakReader: () => ({ listQuotations: (...a: unknown[]) => listMock(...a) }) }));
const pushMock = vi.fn();
vi.mock('@/lib/ai-quote/channels/line', () => ({ pushLine: (...a: unknown[]) => pushMock(...a) }));

import { GET } from '@/app/api/cron/peak-keepalive/route';

const call = (auth: string | null = 'Bearer s3cret') =>
  GET(new Request('http://x/api/cron/peak-keepalive', { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.CRON_SECRET = 's3cret';
  process.env.PEAK_ORDER_ENABLED = 'true';
  process.env.PEAK_ORDER_GROUP_IDS = ' Cgrp1 , Cgrp2';
  tokenMock.mockResolvedValue('tok');
  listMock.mockResolvedValue({ rows: [], total: 0 });
  okMock.mockResolvedValue(undefined);
  errMock.mockResolvedValue(undefined);
  claimMock.mockResolvedValue(true);
  releaseMock.mockResolvedValue(undefined);
  pushMock.mockResolvedValue(undefined);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.PEAK_ORDER_ENABLED;
  delete process.env.PEAK_ORDER_GROUP_IDS;
});

describe('peak-keepalive cron', () => {
  it('401 without bearer / wrong bearer', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('Bearer nope')).status).toBe(401);
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('unset CRON_SECRET never authorises ("Bearer undefined")', async () => {
    delete process.env.CRON_SECRET;
    expect((await call('Bearer undefined')).status).toBe(401);
    expect((await call('Bearer ')).status).toBe(401);
  });

  it('disabled -> skipped', async () => {
    process.env.PEAK_ORDER_ENABLED = 'false';
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, skipped: 'disabled' });
    expect(tokenMock).not.toHaveBeenCalled();
  });

  it('not connected -> skipped, no push, no error recorded', async () => {
    tokenMock.mockRejectedValue(new NotConnected('x'));
    const res = await call();
    expect(await res.json()).toEqual({ ok: true, skipped: 'not-connected' });
    expect(pushMock).not.toHaveBeenCalled();
    expect(errMock).not.toHaveBeenCalled();
  });

  it('success -> force refresh, list last 7d, recordPeakOk, no push', async () => {
    const res = await call();
    expect(await res.json()).toEqual({ ok: true });
    expect(tokenMock).toHaveBeenCalledWith({ forceRefresh: true });
    expect(listMock.mock.calls[0][0]).toMatchObject({ page: 1, dateStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(okMock).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('failure + claim true -> one push to first group id with /peak link; secret-free', async () => {
    tokenMock.mockRejectedValue(new AuthErr('refresh_token=SECRET123 rejected'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, alerted: true });
    expect(errMock).toHaveBeenCalledWith('PeakAuthError');
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [to, text] = pushMock.mock.calls[0];
    expect(to).toBe('Cgrp1');
    expect(text).toContain('https://dashboard.penprinting.co/peak');
    expect(text).not.toContain('SECRET123');
    expect(okMock).not.toHaveBeenCalled();
  });

  it('failure + claim false -> no push', async () => {
    listMock.mockRejectedValue(new Error('boom SECRET'));
    claimMock.mockResolvedValue(false);
    const res = await call();
    expect(await res.json()).toEqual({ ok: false, alerted: false });
    expect(errMock).toHaveBeenCalledWith('Error');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('push throws -> the alert slot is released once, still 200', async () => {
    tokenMock.mockRejectedValue(new AuthErr('x'));
    pushMock.mockRejectedValue(new Error('LINE push HTTP 500'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, alerted: false });
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it('push throws and the release throws too -> still 200, only class labels logged', async () => {
    tokenMock.mockRejectedValue(new AuthErr('x'));
    pushMock.mockRejectedValue(new Error('LINE push HTTP 500 SECRET'));
    releaseMock.mockRejectedValue(new Error('db down SECRET'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, alerted: false });
    expect(releaseMock).toHaveBeenCalledTimes(1);
    const logged = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat().join(' ');
    expect(logged).not.toContain('SECRET');
  });

  it('successful push -> slot kept (no release)', async () => {
    tokenMock.mockRejectedValue(new AuthErr('x'));
    await call();
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('no usable group id -> records error, 200, the alert slot is never claimed, no push', async () => {
    process.env.PEAK_ORDER_GROUP_IDS = ' , ,';
    tokenMock.mockRejectedValue(new AuthErr('x'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, alerted: false });
    expect(errMock).toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('DB bookkeeping failing on the failure path -> 200, no push if claim throws', async () => {
    tokenMock.mockRejectedValue(new AuthErr('x'));
    errMock.mockRejectedValue(new Error('db down'));
    claimMock.mockRejectedValue(new Error('db down'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, alerted: false });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('recordPeakOk failing on success -> still 200 ok', async () => {
    okMock.mockRejectedValue(new Error('db down'));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
