/**
 * One-shot repair 2026-11-21: orders opened by /order that lost `raw_data.peak` when they were
 * edited on the web (#202611104, #202611108) get the marker back.
 *
 * The marker is rebuilt from peak_order_drafts — the draft that created the order keeps the
 * unit's line keys and the order id, and drafts are never deleted. (Not from peak_order_links:
 * a line that was opened again points at the newer order — independent review 2026-11-21.)
 *
 * Pins:
 *  1. The scans read; they never write.
 *  2. The repair is ONE statement, and the "has no marker" precondition sits in its WHERE
 *     (+ RETURNING) — a row that got its marker in the meantime is not touched, a re-run
 *     restores nothing.
 *  3. GET never repairs. POST repairs only when every marker that is still stored equals the
 *     one rebuilt for it (the rebuild is proven on the live data first), writes one audit row
 *     and busts the cache.
 *
 * What the SQL means was run on a real Postgres outside this suite (the SQL layer is mocked here).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { queueError, queueResult, resetMockPostgres, setConfigured, sqlCalls } from './helpers/mock-postgres';

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

import {
  backfillPeakMarkers,
  checkRebuiltPeakMarkers,
  scanMissingPeakMarkers,
  scanUnseenPeakOrders,
} from '@/lib/peak-order/marker-backfill';
import { APPLY_SQL, CONTROL_SQL, SCAN_MISSING_SQL, UNSEEN_SQL } from '@/lib/peak-order/marker-backfill-sql';
import { GET, POST } from '@/app/api/admin/peak/backfill-markers/route';

const GATE = "jsonb_typeof(o.raw_data->'peak') IS DISTINCT FROM 'object'";
const WRITES = /\b(UPDATE|INSERT|DELETE)\b/;
const ROW_104 = {
  order_id: '202611104', name: 'Voucher ขนาด 8.5x5.5 cm', status: 'sent',
  qo_code: 'QO-20261100137', draft_id: 'draft-104', line_keys: ['line-a'], patchable: true,
};
const ROW_108 = {
  order_id: '202611108', name: 'กล่องใส่ passport ขนาด 11.5x15x3 cm', status: 'sent',
  qo_code: 'QO-20261100143', draft_id: 'draft-108', line_keys: ['line-c', 'line-b'], patchable: true,
};
const OUT_104 = {
  orderId: 202611104, orderName: 'Voucher ขนาด 8.5x5.5 cm', orderStatus: 'sent',
  qoCode: 'QO-20261100137', draftId: 'draft-104', lineKeys: ['line-a'],
};
const OUT_108 = {
  orderId: 202611108, orderName: 'กล่องใส่ passport ขนาด 11.5x15x3 cm', orderStatus: 'sent',
  qoCode: 'QO-20261100143', draftId: 'draft-108', lineKeys: ['line-c', 'line-b'],
};
const M112 = { code: 'QO-20261100111', lineKeys: ['x', 'y'], draftId: 'draft-112' };
const SAME = { order_id: '202611112', stored: M112, rebuilt: M112, same: true };
const DIFFERENT = { order_id: '202611101', stored: { code: 'QO-1', lineKeys: ['a', 'b'], draftId: 'd' }, rebuilt: { code: 'QO-1', lineKeys: ['a'], draftId: 'd' }, same: false };
const CONTROL_OK = { checked: 1, different: [], ambiguousOrderIds: [] };

/** What a clean control answers: one intact order whose marker equals the rebuilt one; no ambiguous order. */
const controlOk = () => {
  queueResult({ rows: [SAME], rowCount: 1 });
  queueResult({ rows: [], rowCount: 0 });
};

beforeEach(() => {
  resetMockPostgres();
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ user: 'nook', role: 'admin' });
  auditMock.mockResolvedValue(undefined);
});

describe('scanMissingPeakMarkers', () => {
  it('reports every order a draft created that has no marker, with the marker it would get', async () => {
    queueResult({ rows: [ROW_104, ROW_108], rowCount: 2 });
    expect(await scanMissingPeakMarkers()).toEqual([
      { ...OUT_104, patchable: true },
      { ...OUT_108, patchable: true },
    ]);
  });

  it('a row whose snapshot is not a JSON object is reported as not patchable', async () => {
    queueResult({ rows: [{ ...ROW_104, patchable: false }, { ...ROW_108, patchable: null }], rowCount: 2 });
    expect((await scanMissingPeakMarkers()).map((r) => r.patchable)).toEqual([false, false]);
  });

  it('is one read: units of peak_order_drafts that created an order, joined to orders without a marker object', async () => {
    await scanMissingPeakMarkers();
    expect(sqlCalls).toHaveLength(1);
    const text = sqlCalls[0].text;
    expect(text).toContain('FROM peak_order_drafts d');
    expect(text).toContain("u->'result'->>'kind' IN ('order', 'draft')");
    expect(text).toContain('HAVING COUNT(*) = 1');
    expect(text).toContain(GATE);
    expect(text).not.toContain('peak_order_links');
    expect(text).not.toMatch(WRITES);
  });
});

describe('checkRebuiltPeakMarkers — the rebuild proven on orders that still have their marker', () => {
  it('counts the intact orders and lists the ones whose stored marker differs from the rebuilt one', async () => {
    queueResult({ rows: [SAME, DIFFERENT], rowCount: 2 });
    queueResult({ rows: [{ order_id: '202611050' }], rowCount: 1 });
    expect(await checkRebuiltPeakMarkers()).toEqual({
      checked: 2,
      different: [{ orderId: 202611101, stored: DIFFERENT.stored, rebuilt: DIFFERENT.rebuilt }],
      ambiguousOrderIds: [202611050],
    });
  });

  it('a "same" flag that is not exactly true counts as different', async () => {
    queueResult({ rows: [{ ...SAME, same: null }], rowCount: 1 });
    expect((await checkRebuiltPeakMarkers()).different).toHaveLength(1);
  });

  it('is two reads and writes nothing', async () => {
    await checkRebuiltPeakMarkers();
    expect(sqlCalls).toHaveLength(2);
    expect(sqlCalls[0].text).toContain("jsonb_typeof(o.raw_data->'peak') = 'object'");
    expect(sqlCalls[1].text).toContain('HAVING COUNT(*) > 1');
    expect(sqlCalls.every((c) => !WRITES.test(c.text))).toBe(true);
  });
});

// Independent review, second pass (2026-11-21): a create that half-failed leaves the unit with
// result 'existing' or with no result at all — the rebuild cannot see that order, and an empty
// "missing" list would then say "nothing left" while an order still has no marker. Such orders
// are listed for a person; nothing here repairs them.
describe('scanUnseenPeakOrders — orders /order knows about that the repair cannot rebuild', () => {
  it('lists them with the way each one was found', async () => {
    queueResult({
      rows: [{ order_id: '202611060', name: 'ใบปลิว', status: 'sent', qo_code: 'QO-60', via: ['existing-unit', 'link'] }],
      rowCount: 1,
    });
    expect(await scanUnseenPeakOrders()).toEqual([
      { orderId: 202611060, orderName: 'ใบปลิว', orderStatus: 'sent', qoCode: 'QO-60', via: ['existing-unit', 'link'] },
    ]);
  });

  it('is one read: link rows and units that adopted an order, minus what the repair rebuilds — it writes nothing', async () => {
    await scanUnseenPeakOrders();
    expect(sqlCalls).toHaveLength(1);
    const text = sqlCalls[0].text;
    expect(text).toContain('FROM peak_order_links l WHERE l.order_id IS NOT NULL');
    expect(text).toContain("u->'result'->>'kind' = 'existing'");
    expect(text).toContain('NOT EXISTS (SELECT 1 FROM m WHERE m.order_id = o.id)');
    expect(text).toContain(GATE);
    expect(text).not.toMatch(WRITES);
  });
});

// The SQL layer is mocked in this suite, so these pin the text of the pieces a wrong edit would
// change silently (each line is one of the breaks the second review pass slipped past the tests).
describe('the repair SQL — the pieces that decide what is rebuilt', () => {
  it('each unit gives its own line keys, the draft row gives the draft id, the order id is cast only when it is digits', () => {
    for (const q of [SCAN_MISSING_SQL, CONTROL_SQL, APPLY_SQL, UNSEEN_SQL]) {
      expect(q).toContain("u->'lineKeys' AS line_keys");
      expect(q).toContain('d.qo_code, d.id AS draft_id');
      expect(q).toContain("CASE WHEN u->'result'->>'orderId' ~ '^[0-9]{1,18}$'");
      expect(q).toContain("THEN (u->'result'->>'orderId')::bigint END AS order_id");
    }
  });

  it('scan and control read the order the unit names — no other', () => {
    for (const q of [SCAN_MISSING_SQL, CONTROL_SQL]) expect(q).toContain('JOIN orders o ON o.id = m.order_id');
  });

  it('the control compares the stored marker with the rebuilt one', () => {
    expect(CONTROL_SQL).toContain(
      "(o.raw_data->'peak' = jsonb_build_object('code', m.qo_code, 'lineKeys', m.line_keys, 'draftId', m.draft_id)) AS same",
    );
  });
});

describe('backfillPeakMarkers', () => {
  it('is ONE gated UPDATE: the "no marker" and "snapshots are objects" checks are in its WHERE, with RETURNING', async () => {
    queueResult({ rows: [ROW_104], rowCount: 1 });
    await backfillPeakMarkers();
    expect(sqlCalls).toHaveLength(1);
    const text = sqlCalls[0].text;
    expect(text).toContain('UPDATE orders o SET');
    const where = text.slice(text.lastIndexOf('WHERE o.id = p.order_id'));
    expect(where).toContain(GATE);
    for (const part of ['o.raw_data', 'o.details', 'o.raw', "o.raw->'rawData'", "o.raw->'details'"]) {
      expect(where, part).toContain(`jsonb_typeof(${part}) = 'object'`);
    }
    expect(where).toContain('RETURNING');
  });

  it('rebuilds { code, lineKeys, draftId } from the draft unit that created the order — one unit per order only', async () => {
    await backfillPeakMarkers();
    const text = sqlCalls[0].text;
    expect(text).toContain('FROM peak_order_drafts d');
    expect(text).toContain("u->'result'->>'kind' IN ('order', 'draft')");
    expect(text).toContain('HAVING COUNT(*) = 1');
    expect(text).toContain("jsonb_build_object('peak', jsonb_build_object('code', m.qo_code, 'lineKeys', m.line_keys, 'draftId', m.draft_id))");
    expect(text).not.toContain('peak_order_links');
  });

  it('puts the marker into raw_data, details and both copies inside raw', async () => {
    await backfillPeakMarkers();
    const set = sqlCalls[0].text.slice(sqlCalls[0].text.indexOf('UPDATE orders o SET'), sqlCalls[0].text.lastIndexOf('WHERE o.id = p.order_id'));
    expect(set).toContain('raw_data = o.raw_data || p.patch');
    expect(set).toContain('details = o.details || p.patch');
    expect(set).toContain("'rawData', (o.raw->'rawData') || p.patch");
    expect(set).toContain("'details', (o.raw->'details') || p.patch");
  });

  it('returns the orders it restored; nothing to restore = empty list', async () => {
    queueResult({ rows: [ROW_104, ROW_108], rowCount: 2 });
    expect(await backfillPeakMarkers()).toEqual([OUT_104, OUT_108]);
    expect(await backfillPeakMarkers()).toEqual([]);
  });
});

describe('GET /api/admin/peak/backfill-markers — dry run', () => {
  const UNSEEN_ROW = { order_id: '202611060', name: 'ใบปลิว', status: 'sent', qo_code: 'QO-60', via: ['link'] };

  it('reports what would be restored, what a person must look at, and the control — and writes nothing', async () => {
    queueResult({ rows: [ROW_104, { ...ROW_108, patchable: false }], rowCount: 2 });
    queueResult({ rows: [UNSEEN_ROW], rowCount: 1 });
    controlOk();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe('dryRun');
    expect(json.missing).toEqual([{ ...OUT_104, patchable: true }, { ...OUT_108, patchable: false }]);
    expect(json.patchableCount).toBe(1);
    expect(json.skippedCount).toBe(1);
    expect(json.unseen).toEqual([{ orderId: 202611060, orderName: 'ใบปลิว', orderStatus: 'sent', qoCode: 'QO-60', via: ['link'] }]);
    expect(json.control).toEqual(CONTROL_OK);
    expect(json.safeToApply).toBe(true);
    expect(json.nothingLeft).toBe(false);
    expect(sqlCalls.every((c) => !WRITES.test(c.text))).toBe(true);
    expect(auditMock).not.toHaveBeenCalled();
    expect(bustMock).not.toHaveBeenCalled();
  });

  it('"nothing left" only when no order is missing a marker in any list', async () => {
    const run = async (missing: unknown[], unseen: unknown[]) => {
      resetMockPostgres();
      queueResult({ rows: missing, rowCount: missing.length });
      queueResult({ rows: unseen, rowCount: unseen.length });
      controlOk();
      return (await (await GET()).json()).nothingLeft;
    };
    expect(await run([], [])).toBe(true);
    expect(await run([ROW_104], [])).toBe(false);
    expect(await run([{ ...ROW_104, patchable: false }], [])).toBe(false);
    expect(await run([], [UNSEEN_ROW])).toBe(false);
  });

  it('says it is not safe to apply when a stored marker differs from the rebuilt one', async () => {
    queueResult({ rows: [ROW_104], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [DIFFERENT], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    expect((await (await GET()).json()).safeToApply).toBe(false);
  });

  it('says it is not safe to apply when the control had no order to check the rebuild against', async () => {
    queueResult({ rows: [ROW_104], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [], rowCount: 0 });
    expect((await (await GET()).json()).safeToApply).toBe(false);
  });

  it('is admin only: the refusal goes back and nothing is read', async () => {
    sessionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect((await POST()).status).toBe(403);
    // Both handlers ask for the admin role — not "any session".
    expect(sessionMock.mock.calls).toEqual([[['admin']], [['admin']]]);
    expect(sqlCalls).toHaveLength(0);
  });

  it('500 without a database', async () => {
    setConfigured(false);
    expect((await GET()).status).toBe(500);
    expect((await POST()).status).toBe(500);
    expect(sqlCalls).toHaveLength(0);
  });
});

describe('POST /api/admin/peak/backfill-markers — apply', () => {
  it('checks the control, restores, writes one audit row naming the orders, busts the cache', async () => {
    controlOk();
    queueResult({ rows: [ROW_104, ROW_108], rowCount: 2 });
    const res = await POST();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ mode: 'apply', restoredCount: 2, restored: [OUT_104, OUT_108], control: CONTROL_OK });
    expect(sqlCalls.filter((c) => WRITES.test(c.text))).toHaveLength(1);
    expect(sqlCalls[sqlCalls.length - 1].text).toContain('UPDATE orders o SET');
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0]).toMatchObject({ role: 'admin', user: 'nook', action: 'backfillPeakMarkers' });
    expect(auditMock.mock.calls[0][0].summary).toContain('#202611104');
    expect(auditMock.mock.calls[0][0].summary).toContain('#202611108');
    expect(bustMock).toHaveBeenCalledTimes(1);
  });

  it('refuses (409) and writes nothing when a stored marker differs from the rebuilt one', async () => {
    queueResult({ rows: [SAME, DIFFERENT], rowCount: 2 });
    queueResult({ rows: [], rowCount: 0 });
    const res = await POST();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.control.different).toHaveLength(1);
    expect(sqlCalls.every((c) => !WRITES.test(c.text))).toBe(true);
    expect(auditMock).not.toHaveBeenCalled();
    expect(bustMock).not.toHaveBeenCalled();
  });

  it('refuses (409) and writes nothing when the control had no order to check the rebuild against', async () => {
    const res = await POST();
    expect(res.status).toBe(409);
    expect((await res.json()).control.checked).toBe(0);
    expect(sqlCalls.every((c) => !WRITES.test(c.text))).toBe(true);
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('nothing to restore: no audit row, no cache bust', async () => {
    controlOk();
    const json = await (await POST()).json();
    expect(json).toMatchObject({ mode: 'apply', restoredCount: 0, restored: [] });
    expect(auditMock).not.toHaveBeenCalled();
    expect(bustMock).not.toHaveBeenCalled();
  });

  it('a failing statement answers 500 with the reason', async () => {
    controlOk();
    queueError(new Error('syntax error at or near "x"'));
    const res = await POST();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('syntax error');
    expect(auditMock).not.toHaveBeenCalled();
  });
});
