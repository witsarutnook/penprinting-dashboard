import { beforeEach, describe, expect, it, vi } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/postgres', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import {
  newDraftId,
  peakOrderDb as db,
  type DraftRow,
  type DraftUnit,
} from '@/lib/peak-order/db';
import type { PeakQuotation } from '@/lib/peak/read';

type Q = { text: string; flat: string; values: unknown[] };
const queries: Q[] = [];
let responses: Array<{ rows: unknown[] }> = [];

beforeEach(() => {
  sqlMock.mockReset();
  queries.length = 0;
  responses = [];
  sqlMock.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push({ text, flat: text.replace(/\s+/g, ' ').trim(), values });
    const r = responses.shift() ?? { rows: [] };
    return { rowCount: r.rows.length, ...r };
  });
});

const respond = (...rs: unknown[][]) => {
  responses = rs.map((rows) => ({ rows }));
};

const QUOTATION: PeakQuotation = {
  code: 'QO-001',
  status: 'approved',
  issuedDate: '2026-11-10',
  contactCode: 'C001',
  netAmount: 1070,
  lines: [
    { key: 'l1', description: 'นามบัตร', quantity: 2, price: 500 },
    { key: 'l2', description: 'ใบปลิว', quantity: 1, price: 70 },
  ],
};
const SNAPSHOT = { quotation: QUOTATION, customerName: 'ร้านเอ' };
const UNITS: DraftUnit[] = [
  { lineKeys: ['l1'], name: 'นามบัตร', qty: '2', notes: 'n1', choices: { graphic: 'g' } },
  {
    lineKeys: ['l2'],
    name: 'ใบปลิว',
    qty: '1',
    notes: 'n2',
    choices: {},
    result: { kind: 'order', orderId: 26110001, jobId: 7, pin: '1234' },
  },
];

function dbDraft(over: Record<string, unknown> = {}) {
  return {
    id: 'abcdefghijkl',
    group_id: 'G1',
    line_user_id: 'U1',
    orderer: 'นุ๊ก',
    qo_code: 'QO-001',
    snapshot: SNAPSHOT,
    mode: 'split',
    units: UNITS,
    unit_idx: 1,
    step: 'graphic',
    creating_kind: null,
    last_touched_at: new Date('2026-11-14T03:00:00Z'),
    created_at: new Date('2026-11-14T02:59:00Z'),
    ...over,
  };
}

const EXPECTED: DraftRow = {
  id: 'abcdefghijkl',
  groupId: 'G1',
  lineUserId: 'U1',
  orderer: 'นุ๊ก',
  qoCode: 'QO-001',
  snapshot: SNAPSHOT,
  mode: 'split',
  units: UNITS,
  unitIdx: 1,
  step: 'graphic',
  creatingKind: null,
  lastTouchedAt: '2026-11-14T03:00:00.000Z',
};

describe('draft row mapping', () => {
  it('maps snake_case columns with JSONB already parsed and a Date timestamp', async () => {
    respond([dbDraft()]);
    expect(await db.loadDraft('abcdefghijkl')).toEqual(EXPECTED);
    expect(queries).toHaveLength(1);
    expect(queries[0].flat).toMatch(/FROM peak_order_drafts WHERE id = \?/);
    expect(queries[0].values).toEqual(['abcdefghijkl']);
  });

  it('maps JSONB columns handed back as strings and a string timestamp', async () => {
    respond([
      dbDraft({
        snapshot: JSON.stringify(SNAPSHOT),
        units: JSON.stringify(UNITS),
        last_touched_at: '2026-11-14 10:00:00+07',
        creating_kind: 'create',
        step: 'creating',
        mode: null,
      }),
    ]);
    expect(await db.loadDraft('abcdefghijkl')).toEqual({
      ...EXPECTED,
      units: UNITS,
      snapshot: SNAPSHOT,
      lastTouchedAt: '2026-11-14T03:00:00.000Z',
      creatingKind: 'create',
      step: 'creating',
      mode: null,
    });
  });

  it('unit_idx handed back as a string still maps to a number', async () => {
    respond([dbDraft({ unit_idx: '3' })]);
    expect((await db.loadDraft('x'))?.unitIdx).toBe(3);
  });

  it('loadDraft → null when the row does not exist', async () => {
    respond([]);
    expect(await db.loadDraft('nope')).toBeNull();
  });
});

describe('createDraft', () => {
  it('inserts JSON as string params cast ::jsonb, no creating_kind', async () => {
    const d: Omit<DraftRow, 'lastTouchedAt' | 'creatingKind'> = {
      id: EXPECTED.id,
      groupId: EXPECTED.groupId,
      lineUserId: EXPECTED.lineUserId,
      orderer: EXPECTED.orderer,
      qoCode: EXPECTED.qoCode,
      snapshot: EXPECTED.snapshot,
      mode: EXPECTED.mode,
      units: EXPECTED.units,
      unitIdx: EXPECTED.unitIdx,
      step: EXPECTED.step,
    };
    await db.createDraft(d);
    expect(queries).toHaveLength(1);
    const q = queries[0];
    expect(q.flat).toMatch(/^INSERT INTO peak_order_drafts/);
    expect(q.flat).not.toContain('creating_kind');
    expect(q.flat.match(/\?::jsonb/g)).toHaveLength(2);
    expect(q.values).toEqual([
      'abcdefghijkl',
      'G1',
      'U1',
      'นุ๊ก',
      'QO-001',
      JSON.stringify(SNAPSHOT),
      'split',
      JSON.stringify(UNITS),
      1,
      'graphic',
    ]);
  });
});

describe('advanceDraft — conditional gate', () => {
  it('returns null when zero rows come back (lost race / stale tap)', async () => {
    respond([]);
    const r = await db.advanceDraft('d1', { unitIdx: 0, step: 'mode' }, { unitIdx: 0, step: 'unit' });
    expect(r).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('gate pin: WHERE id AND unit_idx AND step, RETURNING *, as the first and only statement', async () => {
    respond([]);
    await db.advanceDraft('d1', { unitIdx: 2, step: 'date' }, { unitIdx: 2, step: 'confirm' });
    const q = queries[0];
    expect(q.flat).toMatch(/^UPDATE peak_order_drafts SET /);
    const where = q.flat.slice(q.flat.indexOf('WHERE'));
    expect(where).toContain('id = ?');
    expect(where).toContain('unit_idx =');
    expect(where).toContain('step =');
    expect(where).toMatch(/WHERE id = \? AND unit_idx = \? AND step = \? RETURNING \*$/);
    expect(q.flat).toContain('mode = COALESCE(?, mode)');
    expect(q.flat).toContain('units = COALESCE(?::jsonb, units)');
    expect(q.flat).toContain('creating_kind = ?,');
    expect(q.flat).not.toContain('COALESCE(?, creating_kind)');
    expect(q.flat).toContain('last_touched_at = NOW()');
  });

  it('omitted mode/units/creatingKind → null params (mode/units unchanged via COALESCE, creating_kind cleared)', async () => {
    respond([dbDraft({ step: 'done', unit_idx: 2 })]);
    const r = await db.advanceDraft('d1', { unitIdx: 2, step: 'creating' }, { unitIdx: 2, step: 'done' });
    // SET step, unit_idx, mode, units, creating_kind | WHERE id, unit_idx, step
    expect(queries[0].values).toEqual(['done', 2, null, null, null, 'd1', 2, 'creating']);
    expect(r).toEqual({ ...EXPECTED, step: 'done', unitIdx: 2 });
  });

  it('passes mode, units (as JSON string) and creatingKind when given, maps the returned row', async () => {
    respond([dbDraft({ step: 'creating', creating_kind: 'draft', units: JSON.stringify(UNITS) })]);
    const r = await db.advanceDraft(
      'd1',
      { unitIdx: 0, step: 'confirm' },
      { unitIdx: 1, step: 'creating', mode: 'merged', units: UNITS, creatingKind: 'draft' },
    );
    expect(queries[0].values).toEqual([
      'creating',
      1,
      'merged',
      JSON.stringify(UNITS),
      'draft',
      'd1',
      0,
      'confirm',
    ]);
    expect(r).toEqual({ ...EXPECTED, step: 'creating', creatingKind: 'draft' });
  });
});

describe('cancelDraft', () => {
  it('true when a row comes back; never cancels done/cancelled/creating', async () => {
    respond([{ id: 'd1' }]);
    expect(await db.cancelDraft('d1')).toBe(true);
    const q = queries[0];
    expect(q.flat).toMatch(/^UPDATE peak_order_drafts SET step = 'cancelled'/);
    expect(q.flat).toMatch(/WHERE id = \? AND step NOT IN \('done', ?'cancelled', ?'creating'\) RETURNING id$/);
    expect(q.values).toEqual(['d1']);
  });

  it('false when zero rows', async () => {
    respond([]);
    expect(await db.cancelDraft('d1')).toBe(false);
  });
});

describe('claimLines — per-line all-or-nothing claim', () => {
  it("passes keys as ONE sorted JSON param and returns true when every key comes back", async () => {
    respond([{ line_key: 'a' }, { line_key: 'b' }]);
    expect(await db.claimLines('QO-1', ['b', 'a'], 'd1', 'นุ๊ก')).toBe(true);
    expect(queries).toHaveLength(1);
    expect(queries[0].values).toEqual(['QO-1', 'd1', 'นุ๊ก', '["a","b"]']);
  });

  it('claim SQL pin', async () => {
    respond([{ line_key: 'a' }]);
    await db.claimLines('QO-1', ['a'], 'd1', 'u');
    const f = queries[0].flat;
    expect(f).toMatch(/^INSERT INTO peak_order_links \(qo_code, line_key, draft_id, created_by, order_id, claimed_at\)/);
    expect(f).toContain('FROM jsonb_array_elements_text(?::jsonb) AS k');
    expect(f).toContain('ON CONFLICT (qo_code, line_key) DO UPDATE');
    expect(f).toContain(
      'SET draft_id = EXCLUDED.draft_id, created_by = EXCLUDED.created_by, order_id = NULL, claimed_at = NOW()',
    );
    expect(f).toContain(
      "WHERE (peak_order_links.order_id IS NULL AND peak_order_links.claimed_at < NOW() - INTERVAL '2 minutes')",
    );
    expect(f).toContain(
      "OR (peak_order_links.order_id IS NOT NULL AND NOT EXISTS ( SELECT 1 FROM orders o WHERE o.id = peak_order_links.order_id AND COALESCE(o.status, '') <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))",
    );
    expect(f).toMatch(/RETURNING line_key$/);
  });

  it('fewer rows than keys → releases this draft\'s claim and returns false', async () => {
    respond([{ line_key: 'a' }], []);
    expect(await db.claimLines('QO-1', ['b', 'a'], 'd1', 'u')).toBe(false);
    expect(queries).toHaveLength(2);
    expect(queries[1].flat).toMatch(/^DELETE FROM peak_order_links/);
    expect(queries[1].flat).toContain('order_id IS NULL');
    expect(queries[1].values).toEqual(['QO-1', 'd1']);
  });

  it('duplicate keys are de-duplicated (one row per key; a repeated key would fail the statement)', async () => {
    respond([{ line_key: 'a' }, { line_key: 'b' }]);
    expect(await db.claimLines('QO-1', ['b', 'a', 'b'], 'd1', 'u')).toBe(true);
    expect(queries[0].values[3]).toBe('["a","b"]');
  });

  it('empty key list → false, no SQL (claiming nothing must never license a create)', async () => {
    expect(await db.claimLines('QO-1', [], 'd1', 'u')).toBe(false);
    expect(queries).toHaveLength(0);
  });
});

describe('releaseClaim / finalizeLinks', () => {
  it('releaseClaim deletes only this draft\'s rows with no order_id', async () => {
    await db.releaseClaim('QO-1', 'd1');
    expect(queries[0].flat).toBe(
      'DELETE FROM peak_order_links WHERE qo_code = ? AND draft_id = ? AND order_id IS NULL',
    );
    expect(queries[0].values).toEqual(['QO-1', 'd1']);
  });

  it("finalizeLinks sets order_id only on this draft's still-unlinked rows", async () => {
    await db.finalizeLinks('QO-1', 'd1', 26110001);
    expect(queries[0].flat).toBe(
      'UPDATE peak_order_links SET order_id = ? WHERE qo_code = ? AND draft_id = ? AND order_id IS NULL',
    );
    expect(queries[0].values).toEqual([26110001, 'QO-1', 'd1']);
  });
});

describe('liveLinks / openedCodes', () => {
  it('liveLinks: LEFT JOIN orders, live filter, maps BIGINT order_id string → number', async () => {
    respond([
      { line_key: 'l1', order_id: '26110001', order_name: 'นามบัตร', order_status: 'sent' },
      { line_key: 'l2', order_id: null, order_name: null, order_status: null },
    ]);
    expect(await db.liveLinks('QO-1')).toEqual([
      { lineKey: 'l1', orderId: 26110001, orderName: 'นามบัตร', orderStatus: 'sent' },
      { lineKey: 'l2', orderId: null, orderName: null, orderStatus: null },
    ]);
    const f = queries[0].flat;
    expect(f).toContain('LEFT JOIN orders o ON o.id = l.order_id');
    expect(f).toContain("l.order_id IS NULL AND l.claimed_at >= NOW() - INTERVAL '2 minutes'");
    expect(f).toContain(
      "OR (l.order_id IS NOT NULL AND o.id IS NOT NULL AND COALESCE(o.status, '') <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))",
    );
    expect(queries[0].values).toEqual(['QO-1']);
  });

  it('openedCodes([]) issues no SQL and returns an empty set', async () => {
    const s = await db.openedCodes([]);
    expect(s).toBeInstanceOf(Set);
    expect(s.size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it('openedCodes: one JSON param, same live filter, returns the codes that came back', async () => {
    respond([{ qo_code: 'QO-2' }]);
    const s = await db.openedCodes(['QO-2', 'QO-1', 'QO-2']);
    expect([...s]).toEqual(['QO-2']);
    expect(queries[0].values).toEqual(['["QO-1","QO-2"]']);
    const f = queries[0].flat;
    expect(f).toContain('jsonb_array_elements_text(?::jsonb)');
    expect(f).toContain("l.order_id IS NULL AND l.claimed_at >= NOW() - INTERVAL '2 minutes'");
    expect(f).toContain(
      "OR (l.order_id IS NOT NULL AND o.id IS NOT NULL AND COALESCE(o.status, '') <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))",
    );
  });
});

describe('findOrderByPeakMarker', () => {
  it('pinned SQL; maps BIGINT id string → number', async () => {
    respond([{ id: '26110005', status: 'draft' }]);
    expect(await db.findOrderByPeakMarker('QO-1', ['l2', 'l1'])).toEqual({ id: 26110005, status: 'draft' });
    const f = queries[0].flat;
    expect(f).toMatch(/^SELECT id, status FROM orders WHERE raw_data->'peak'->>'code' = \?/);
    expect(f).toContain(
      "COALESCE(status, '') <> 'cancelled' AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = orders.id) AND EXISTS (SELECT 1 FROM jsonb_array_elements_text",
    );
    expect(f).toContain(
      "EXISTS (SELECT 1 FROM jsonb_array_elements_text(raw_data->'peak'->'lineKeys') lk WHERE lk IN (SELECT jsonb_array_elements_text(?::jsonb)))",
    );
    expect(f).toMatch(/ORDER BY id DESC LIMIT 1$/);
    expect(queries[0].values).toEqual(['QO-1', '["l1","l2"]']);
  });

  it('null when nothing matches', async () => {
    respond([]);
    expect(await db.findOrderByPeakMarker('QO-1', ['l1'])).toBeNull();
  });

  it('empty key list → null, no SQL', async () => {
    expect(await db.findOrderByPeakMarker('QO-1', [])).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('staff mapping', () => {
  it('getStaff → orderer or null', async () => {
    respond([{ orderer: 'นุ๊ก' }], []);
    expect(await db.getStaff('U1')).toEqual({ orderer: 'นุ๊ก' });
    expect(await db.getStaff('U2')).toBeNull();
    expect(queries[0].flat).toBe('SELECT orderer FROM peak_order_staff WHERE line_user_id = ?');
    expect(queries[0].values).toEqual(['U1']);
  });

  it('setStaff upserts orderer + display name', async () => {
    await db.setStaff('U1', 'นุ๊ก', null);
    const f = queries[0].flat;
    expect(f).toMatch(/^INSERT INTO peak_order_staff \(line_user_id, orderer, display_name\)/);
    expect(f).toContain('ON CONFLICT (line_user_id) DO UPDATE SET orderer = EXCLUDED.orderer, display_name = EXCLUDED.display_name');
    expect(queries[0].values).toEqual(['U1', 'นุ๊ก', null]);
  });

  it('listStaff maps rows, createdAt → ISO from Date or string', async () => {
    respond([
      { line_user_id: 'U1', orderer: 'นุ๊ก', display_name: 'Nook', created_at: new Date('2026-11-14T01:00:00Z') },
      { line_user_id: 'U2', orderer: 'บี', display_name: null, created_at: '2026-11-14 09:00:00+07' },
    ]);
    expect(await db.listStaff()).toEqual([
      { lineUserId: 'U1', orderer: 'นุ๊ก', displayName: 'Nook', createdAt: '2026-11-14T01:00:00.000Z' },
      { lineUserId: 'U2', orderer: 'บี', displayName: null, createdAt: '2026-11-14T02:00:00.000Z' },
    ]);
    expect(queries[0].flat).toMatch(/FROM peak_order_staff ORDER BY created_at/);
  });

  it('deleteStaff deletes by line user id', async () => {
    await db.deleteStaff('U1');
    expect(queries[0].flat).toBe('DELETE FROM peak_order_staff WHERE line_user_id = ?');
    expect(queries[0].values).toEqual(['U1']);
  });
});

describe('newDraftId', () => {
  it('is 12 url-safe chars and unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = newDraftId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(500);
  });
});
