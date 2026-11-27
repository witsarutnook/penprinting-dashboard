/**
 * One-shot repair 2026-11-27 (audit H1-board-edit-wipes-pin): orders still in production whose
 * PIN was wiped by an edit from a board card get a new one. The old PIN was stored nowhere else.
 * On production when this was written: 3 orders (#202611097, #202611143, #202611151); the other
 * 16 wiped ones had shipped.
 *
 * Pins:
 *  1. The dry run reads; it never writes.
 *  2. The write is ONE statement, gated in its WHERE by the same eligibility the dry run reports
 *     (+ RETURNING) — a row that is no longer eligible is not touched, a re-run issues nothing.
 *  3. Only the ids the caller names can get a PIN: the admin applies what the dry run showed.
 *  4. No PIN is in any response or audit row — the admin reads it from the order's tracking card.
 *
 * What the SQL means was run on a real Postgres outside this suite (the SQL layer is mocked here).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { queueResult, resetMockPostgres, setConfigured, sqlCalls } from './helpers/mock-postgres';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

const sessionMock = vi.fn();
vi.mock('@/lib/route-helpers', () => ({
  requireSession: (...a: unknown[]) => sessionMock(...a),
}));
const auditMock = vi.fn();
vi.mock('@/lib/postgres-write', () => ({
  appendAuditToPostgres: (...a: unknown[]) => auditMock(...a),
}));
const bustMock = vi.fn();
vi.mock('@/lib/revalidate', () => ({ bustLoadAllCache: () => bustMock() }));

import { issuePins, newOrderPin, scanPinlessOrders } from '@/lib/order-pin-reissue';
import { ELIGIBLE, ISSUE_SQL, NO_PIN, SCAN_SQL } from '@/lib/order-pin-reissue-sql';
import { GET, POST } from '@/app/api/admin/orders/reissue-pins/route';

const WRITES = /\b(UPDATE|INSERT|DELETE)\b/;
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Rows as the scan hands them back (ids come back as text from a bigint column). */
const ROW_IN_PRODUCTION = {
  id: '202611151', name: 'ใบปลิว A5', customer: 'ร้านกาแฟ', status: 'sent', date_due: '2026-11-30',
  live_jobs: 1, shipped: false, cancelled: false, eligible: true,
};
const ROW_SHIPPED = {
  id: '202608018', name: 'โบรชัวร์', customer: 'โรงเรียน', status: 'sent', date_due: '2026-08-08',
  live_jobs: 0, shipped: true, cancelled: false, eligible: false,
};
const ROW_DRAFT = {
  id: '202605018', name: 'ร่างเก่า', customer: null, status: 'draft', date_due: null,
  live_jobs: 0, shipped: false, cancelled: false, eligible: false,
};

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/admin/orders/reissue-pins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetMockPostgres();
  sessionMock.mockReset().mockResolvedValue({ role: 'admin', user: 'นุ๊ก' });
  auditMock.mockReset().mockResolvedValue(undefined);
  bustMock.mockReset();
});

describe('the SQL', () => {
  it('the dry run only reads', () => {
    expect(SCAN_SQL).not.toMatch(WRITES);
  });

  it('the dry run lists orders without a PIN and reports the eligibility the write is gated by', () => {
    expect(norm(SCAN_SQL)).toContain(`WHERE ${norm(NO_PIN)} ORDER BY o.id`);
    expect(norm(SCAN_SQL)).toContain(`COALESCE((${norm(ELIGIBLE)}), FALSE) AS eligible`);
  });

  // Independent review 2026-11-27: a `{pin}` made where a snapshot was missing would stand in
  // front of a spec held by the other snapshot (readers prefer rawData). Objects are required.
  it('eligible needs raw and all four snapshots to BE objects — nothing is made out of nothing', () => {
    const text = norm(ELIGIBLE);
    for (const place of ['o.raw', 'o.raw_data', 'o.details', "o.raw->'rawData'", "o.raw->'details'"]) {
      expect(text, place).toContain(`jsonb_typeof(${place}) = 'object'`);
    }
    expect(text).not.toMatch(/IS NULL OR jsonb_typeof/);
    expect(norm(ISSUE_SQL)).not.toMatch(/CASE WHEN|'\{\}'::jsonb/);
  });

  it('the write is one UPDATE whose WHERE holds the same eligibility, and it returns the rows it touched', () => {
    const text = norm(ISSUE_SQL);
    expect(text.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(text).not.toMatch(/\b(INSERT|DELETE)\b/);
    expect(text).toContain(`WHERE o.id = p.id AND p.pin ~ '^[0-9]{4}$' AND ${norm(ELIGIBLE)} RETURNING o.id`);
  });

  it('eligible = no PIN, sent, not shipped, not cancelled, with a live job', () => {
    const text = norm(ELIGIBLE);
    expect(text).toContain(norm(NO_PIN));
    expect(text).toContain("COALESCE(o.status, '') = 'sent'");
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM shipped s WHERE s.order_id = o.id)');
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)');
    expect(text).toContain('EXISTS (SELECT 1 FROM jobs j WHERE j.order_id = o.id AND j.phase2_deleted_at IS NULL)');
  });
});

describe('scanPinlessOrders', () => {
  it('runs the dry-run statement and nothing else', async () => {
    queueResult({ rows: [ROW_IN_PRODUCTION], rowCount: 1 });
    await scanPinlessOrders();
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toBe(norm(SCAN_SQL));
  });

  it('hands the rows back as numbers and booleans', async () => {
    queueResult({ rows: [ROW_IN_PRODUCTION, ROW_SHIPPED, ROW_DRAFT], rowCount: 3 });
    expect(await scanPinlessOrders()).toEqual([
      { orderId: 202611151, name: 'ใบปลิว A5', customer: 'ร้านกาแฟ', status: 'sent', dateDue: '2026-11-30', liveJobs: 1, shipped: false, cancelled: false, eligible: true },
      { orderId: 202608018, name: 'โบรชัวร์', customer: 'โรงเรียน', status: 'sent', dateDue: '2026-08-08', liveJobs: 0, shipped: true, cancelled: false, eligible: false },
      { orderId: 202605018, name: 'ร่างเก่า', customer: null, status: 'draft', dateDue: null, liveJobs: 0, shipped: false, cancelled: false, eligible: false },
    ]);
  });
});

describe('newOrderPin', () => {
  it('is four digits, 1000–9999 — the shape order creation makes', () => {
    for (let i = 0; i < 200; i++) expect(newOrderPin()).toMatch(/^[1-9]\d{3}$/);
  });
});

describe('issuePins', () => {
  it('with no ids it does not touch the database', async () => {
    expect(await issuePins([])).toEqual([]);
    expect(sqlCalls).toHaveLength(0);
  });

  it('sends ONE statement with an (id, pin) pair per order, each order once', async () => {
    queueResult({ rows: [{ id: '202611151' }, { id: '202611143' }], rowCount: 2 });
    const pins = ['4821', '7305'];
    await issuePins([202611151, 202611143, 202611151], () => pins.shift()!);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toBe(norm(ISSUE_SQL));
    expect(JSON.parse(String(sqlCalls[0].values[0]))).toEqual([
      { id: 202611151, pin: '4821' },
      { id: 202611143, pin: '7305' },
    ]);
  });

  it('reports the orders the statement touched — not the ones it was asked for', async () => {
    queueResult({ rows: [{ id: '202611151' }], rowCount: 1 });
    expect(await issuePins([202611151, 202608018])).toEqual([202611151]);
  });
});

describe('GET /api/admin/orders/reissue-pins', () => {
  it('is admin only', async () => {
    sessionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await GET();
    expect(res.status).toBe(403);
    expect(sessionMock).toHaveBeenCalledWith(['admin']);
    expect(sqlCalls).toHaveLength(0);
  });

  it('shows what would get a PIN and why the others would not — and writes nothing', async () => {
    queueResult({ rows: [ROW_DRAFT, ROW_SHIPPED, ROW_IN_PRODUCTION], rowCount: 3 });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('dryRun');
    expect(body.eligibleIds).toEqual([202611151]);
    expect(body.eligible).toEqual([
      { orderId: 202611151, name: 'ใบปลิว A5', customer: 'ร้านกาแฟ', dateDue: '2026-11-30', liveJobs: 1 },
    ]);
    expect(body.notEligible).toEqual({ shipped: [202608018], cancelled: [], draft: [202605018], other: [] });
    expect(body.nothingLeft).toBe(false);
    expect(sqlCalls.every((c) => !WRITES.test(c.text))).toBe(true);
    expect(auditMock).not.toHaveBeenCalled();
    expect(bustMock).not.toHaveBeenCalled();
  });

  it('says so when no order in production is without a PIN', async () => {
    queueResult({ rows: [ROW_SHIPPED], rowCount: 1 });
    const body = await (await GET()).json();
    expect(body.eligibleIds).toEqual([]);
    expect(body.nothingLeft).toBe(true);
  });

  it('answers 500 without a database', async () => {
    setConfigured(false);
    expect((await GET()).status).toBe(500);
  });
});

describe('POST /api/admin/orders/reissue-pins', () => {
  it('is admin only', async () => {
    sessionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await POST(postReq({ ids: [202611151] }));
    expect(res.status).toBe(403);
    expect(sqlCalls).toHaveLength(0);
  });

  it('refuses a request that does not name the orders', async () => {
    for (const bad of [{}, { ids: [] }, { ids: 'all' }, { ids: [0] }, { ids: [-5] }, { ids: [1.5] }, { ids: ['202611151'] }, { ids: Array.from({ length: 51 }, (_, i) => i + 1) }, 'not json']) {
      resetMockPostgres();
      const res = await POST(postReq(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(sqlCalls, JSON.stringify(bad)).toHaveLength(0);
    }
  });

  it('gives the named orders a PIN, writes one audit row per order, busts the cache', async () => {
    queueResult({ rows: [{ id: '202611143' }, { id: '202611151' }], rowCount: 2 });
    const res = await POST(postReq({ ids: [202611151, 202611143] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('apply');
    expect(body.issuedIds).toEqual([202611143, 202611151]);
    expect(body.notIssuedIds).toEqual([]);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toBe(norm(ISSUE_SQL));
    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMock.mock.calls.map((c) => [c[0].action, c[0].targetId, c[0].role, c[0].user])).toEqual([
      ['reissueOrderPin', 202611143, 'admin', 'นุ๊ก'],
      ['reissueOrderPin', 202611151, 'admin', 'นุ๊ก'],
    ]);
    expect(bustMock).toHaveBeenCalledTimes(1);
  });

  it('no PIN is in the response or in an audit row', async () => {
    queueResult({ rows: [{ id: '202611151' }], rowCount: 1 });
    const res = await POST(postReq({ ids: [202611151] }));
    const sent = JSON.parse(String(sqlCalls[0].values[0])) as Array<{ id: number; pin: string }>;
    expect(sent[0].pin).toMatch(/^[1-9]\d{3}$/);
    const out = JSON.stringify(await res.json()) + JSON.stringify(auditMock.mock.calls);
    // The order id 202611151 holds digits too: look for the PIN as a whole token.
    expect(out).not.toMatch(new RegExp(`(?<!\\d)${sent[0].pin}(?!\\d)`));
    expect(out).not.toContain('"pin"');
  });

  it('an order that is not eligible any more is reported as not issued — no audit row for it', async () => {
    queueResult({ rows: [{ id: '202611151' }], rowCount: 1 });
    const body = await (await POST(postReq({ ids: [202611151, 202608018] }))).json();
    expect(body.issuedIds).toEqual([202611151]);
    expect(body.notIssuedIds).toEqual([202608018]);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  it('a second run issues nothing: no audit row, no cache bust', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const body = await (await POST(postReq({ ids: [202611151] }))).json();
    expect(body.issuedIds).toEqual([]);
    expect(body.notIssuedIds).toEqual([202611151]);
    expect(auditMock).not.toHaveBeenCalled();
    expect(bustMock).not.toHaveBeenCalled();
  });
});
