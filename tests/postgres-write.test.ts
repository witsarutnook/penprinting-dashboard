import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sqlCalls,
  resetMockPostgres,
  queueResult,
  setConfigured,
  callsContaining,
  findCallContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  setCoworkInPostgres,
  updateJobInPostgres,
  addJobToPostgres,
  createOrderInPostgres,
  findDuplicateOrdersInPostgres,
  moveToShippedInPostgres,
  cancelJobInPostgres,
  bulkForwardInPostgres,
  appendAuditToPostgres,
  markRowClean,
  markRowDirty,
  addTemplateToPostgres,
  deleteTemplateFromPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

describe('setCoworkInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresWriteError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(setCoworkInPostgres({ id: 1, cowork: ['mo'] })).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on invalid id', async () => {
    await expect(setCoworkInPostgres({ id: 'abc', cowork: [] })).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(setCoworkInPostgres({ id: 0, cowork: [] })).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(setCoworkInPostgres({ id: -5, cowork: [] })).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns found:false WITHOUT issuing UPDATE when row missing in Postgres', async () => {
    queueResult({ rows: [], rowCount: 0 });  // SELECT returns nothing
    const r = await setCoworkInPostgres({ id: 999, cowork: ['mo'] });
    expect(r).toEqual({ ok: true, found: false });
    // SELECT happens, UPDATE does not — guards the route's "fall-through to legacy"
    // contract for jobs not yet mirrored to Postgres (Phase 1.7 stragglers).
    expect(callsContaining('SELECT raw FROM jobs')).toHaveLength(1);
    expect(callsContaining('UPDATE jobs')).toHaveLength(0);
  });

  it('updates cowork column + raw snapshot + marks dirty when row exists', async () => {
    const oldRaw = { id: 42, name: 'job-A', cowork: null, dept: 'print' };
    queueResult({ rows: [{ raw: oldRaw }], rowCount: 1 });  // SELECT
    queueResult({ rowCount: 1 });  // UPDATE

    const r = await setCoworkInPostgres({ id: 42, cowork: ['mo', 'aor'] });
    expect(r).toEqual({ ok: true, found: true });

    const update = findCallContaining('UPDATE jobs');
    expect(update).toBeDefined();
    expect(update!.text).toContain('cowork =');
    expect(update!.text).toContain('raw =');
    // Critical: phase2_dirty_at must be set so the heal cron knows to push to Sheet.
    // Without this, inline Sheet sync failure leaves Sheet drifted with no recovery.
    expect(update!.text).toContain('phase2_dirty_at = NOW()');

    // Bound values: [coworkJson, newRawJson, idNum]
    expect(update!.values[0]).toBe(JSON.stringify(['mo', 'aor']));
    const mergedRaw = JSON.parse(update!.values[1] as string);
    expect(mergedRaw).toEqual({ ...oldRaw, cowork: ['mo', 'aor'] });
    expect(update!.values[2]).toBe(42);
  });

  it('clears cowork (null) → stores SQL NULL not "null" string', async () => {
    queueResult({ rows: [{ raw: { id: 1, cowork: ['x'] } }], rowCount: 1 });
    queueResult({ rowCount: 1 });

    await setCoworkInPostgres({ id: 1, cowork: null });
    const update = findCallContaining('UPDATE jobs');
    expect(update!.values[0]).toBeNull();
    const mergedRaw = JSON.parse(update!.values[1] as string);
    expect(mergedRaw.cowork).toBeNull();
  });

  it('treats undefined raw column as empty object (defensive against bad data)', async () => {
    queueResult({ rows: [{ raw: null }], rowCount: 1 });  // raw column is null
    queueResult({ rowCount: 1 });

    await setCoworkInPostgres({ id: 7, cowork: ['solo'] });
    const update = findCallContaining('UPDATE jobs');
    const mergedRaw = JSON.parse(update!.values[1] as string);
    expect(mergedRaw).toEqual({ cowork: ['solo'] });
  });
});

describe('markRowClean / markRowDirty', () => {
  beforeEach(() => resetMockPostgres());

  it('markRowClean issues UPDATE ... phase2_dirty_at = NULL with parameterized id', async () => {
    queueResult({ rowCount: 1 });
    await markRowClean('jobs', 100);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].type).toBe('query');
    expect(sqlCalls[0].text).toBe('UPDATE jobs SET phase2_dirty_at = NULL WHERE id = $1::bigint');
    expect(sqlCalls[0].values).toEqual([100]);
  });

  it('markRowDirty issues UPDATE ... phase2_dirty_at = NOW() with parameterized id', async () => {
    queueResult({ rowCount: 1 });
    await markRowDirty('orders', '250');
    expect(sqlCalls[0].text).toBe('UPDATE orders SET phase2_dirty_at = NOW() WHERE id = $1::bigint');
    expect(sqlCalls[0].values).toEqual([250]);
  });

  it('silently no-ops on unconfigured Postgres', async () => {
    setConfigured(false);
    await markRowClean('jobs', 1);
    await markRowDirty('jobs', 1);
    expect(sqlCalls).toHaveLength(0);
  });

  it('silently no-ops on invalid id (no SQL injection via NaN)', async () => {
    await markRowClean('jobs', 'not-a-number');
    await markRowClean('jobs', 0);
    await markRowDirty('jobs', -1);
    expect(sqlCalls).toHaveLength(0);
  });
});

describe('updateJobInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresWriteError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(
      updateJobInPostgres({ id: 1, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on invalid id', async () => {
    await expect(
      updateJobInPostgres({ id: 0, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(
      updateJobInPostgres({ id: 'abc', name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns found:false WITHOUT issuing UPDATE when row missing in Postgres', async () => {
    queueResult({ rows: [], rowCount: 0 });  // SELECT empty
    const r = await updateJobInPostgres({
      id: 999, name: 'ghost', dept: 'print', staff: 'mo',
    });
    expect(r).toEqual({ ok: true, found: false });
    expect(callsContaining('SELECT raw FROM jobs')).toHaveLength(1);
    expect(callsContaining('UPDATE jobs')).toHaveLength(0);
  });

  it('updates all fields, sets phase2_dirty_at, merges raw with old snapshot', async () => {
    const oldRaw = {
      id: 42,
      name: 'old-name',
      date: '2026-05-09',
      dateIn: '2026-05-08',
      dept: 'graphic',
      staff: 'aor',
      status: 'pending',
      orderId: 100,
      cowork: ['mo'],   // ← preserved when input doesn't include cowork
      notes: 'extra',   // ← preserved (not part of input shape)
    };
    queueResult({ rows: [{ raw: oldRaw }], rowCount: 1 });  // SELECT
    queueResult({ rowCount: 1 });  // UPDATE

    const r = await updateJobInPostgres({
      id: 42,
      name: 'new-name',
      date: '2026-05-10',
      dateIn: '2026-05-09',
      dept: 'print',
      staff: 'top',
      status: 'pending',
      orderId: 100,
    });
    expect(r).toEqual({ ok: true, found: true });

    const update = findCallContaining('UPDATE jobs SET');
    expect(update).toBeDefined();

    // Critical: phase2_dirty_at MUST be set so heal cron pushes to Sheet.
    expect(update!.text).toContain('phase2_dirty_at = NOW()');
    expect(update!.text).toContain('order_id =');
    expect(update!.text).toContain('name =');
    expect(update!.text).toContain('dept =');
    expect(update!.text).toContain('staff =');
    expect(update!.text).toContain('cowork =');
    expect(update!.text).toContain('raw =');

    // The merged raw payload — verify by parsing the JSON parameter that
    // ends up in the `raw = $N::jsonb` slot.
    const rawParam = update!.values.find(
      (v) => typeof v === 'string' && v.startsWith('{'),
    ) as string | undefined;
    expect(rawParam).toBeDefined();
    const merged = JSON.parse(rawParam!);
    expect(merged.id).toBe(42);
    expect(merged.name).toBe('new-name');
    expect(merged.date).toBe('2026-05-10');
    expect(merged.dept).toBe('print');
    expect(merged.staff).toBe('top');
    // Untouched fields survive merge:
    expect(merged.cowork).toEqual(['mo']);
    expect(merged.notes).toBe('extra');
  });

  it('overwrites cowork when explicitly passed in input (matches v2 form intent)', async () => {
    queueResult({ rows: [{ raw: { id: 5, cowork: ['old'] } }], rowCount: 1 });
    queueResult({ rowCount: 1 });

    await updateJobInPostgres({
      id: 5, name: 'x', dept: 'print', staff: 'mo',
      cowork: ['new1', 'new2'],
    });
    const update = findCallContaining('UPDATE jobs SET');
    const rawParam = update!.values.find(
      (v) => typeof v === 'string' && v.startsWith('{'),
    ) as string;
    const merged = JSON.parse(rawParam);
    expect(merged.cowork).toEqual(['new1', 'new2']);
  });

  it('handles null orderId as null (not coerced to 0)', async () => {
    queueResult({ rows: [{ raw: { id: 7 } }], rowCount: 1 });
    queueResult({ rowCount: 1 });

    await updateJobInPostgres({
      id: 7, name: 'standalone', dept: 'print', staff: 'mo',
      orderId: '',  // form sends '' for "no parent order"
    });
    const update = findCallContaining('UPDATE jobs SET');
    // First parameter slot in the SET list is order_id — it should be null
    // (not 0 — bigint NULL is the orphan-job convention).
    expect(update!.values[0]).toBeNull();
  });

  it('treats undefined raw column as empty object (defensive)', async () => {
    queueResult({ rows: [{ raw: null }], rowCount: 1 });
    queueResult({ rowCount: 1 });

    const r = await updateJobInPostgres({
      id: 11, name: 'recovery', dept: 'print', staff: 'mo',
    });
    expect(r).toEqual({ ok: true, found: true });
    const update = findCallContaining('UPDATE jobs SET');
    const rawParam = update!.values.find(
      (v) => typeof v === 'string' && v.startsWith('{'),
    ) as string;
    const merged = JSON.parse(rawParam);
    expect(merged.id).toBe(11);
    expect(merged.name).toBe('recovery');
  });
});

describe('addJobToPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresWriteError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(
      addJobToPostgres({ id: 100, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on invalid id', async () => {
    await expect(
      addJobToPostgres({ id: 0, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(
      addJobToPostgres({ id: 'abc' as unknown as number, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on missing name', async () => {
    await expect(
      addJobToPostgres({ id: 100, name: '', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(
      addJobToPostgres({ id: 100, name: '   ', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('inserts with all fields + sets phase2_dirty_at', async () => {
    queueResult({ rowCount: 1 });
    const r = await addJobToPostgres({
      id: 12345,
      name: 'Brochure 1000',
      date: '2026-05-15',
      dateIn: '2026-05-11',
      dept: 'graphic',
      staff: 'aor',
      status: 'pending',
      orderId: 100,
    });
    expect(r).toEqual({ ok: true, id: 12345 });

    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert).toBeDefined();
    // Critical — Phase 2 INSERT must mark dirty so heal cron pushes to Sheet.
    expect(insert!.text).toContain('phase2_dirty_at');
    expect(insert!.text).toMatch(/VALUES.*NOW\(\)/);

    // Bound values: [id, orderId, name, date, dateIn, staff, dept, status, cowork, raw]
    expect(insert!.values[0]).toBe(12345);
    expect(insert!.values[1]).toBe(100);
    expect(insert!.values[2]).toBe('Brochure 1000');
    expect(insert!.values[3]).toBe('2026-05-15');
    expect(insert!.values[4]).toBe('2026-05-11');
    expect(insert!.values[5]).toBe('aor');
    expect(insert!.values[6]).toBe('graphic');
    expect(insert!.values[7]).toBe('pending');
    expect(insert!.values[8]).toBeNull(); // cowork starts null

    const raw = JSON.parse(insert!.values[9] as string);
    expect(raw).toMatchObject({
      id: 12345,
      name: 'Brochure 1000',
      dept: 'graphic',
      staff: 'aor',
      status: 'pending',
      orderId: 100,
    });
  });

  it('handles null/empty orderId as null (orphan job pattern)', async () => {
    queueResult({ rowCount: 1 });
    await addJobToPostgres({
      id: 200, name: 'standalone', dept: 'print', staff: 'mo',
      orderId: '',  // form sends '' for "no parent order"
    });
    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert!.values[1]).toBeNull();

    resetMockPostgres();
    queueResult({ rowCount: 1 });
    await addJobToPostgres({
      id: 201, name: 'standalone', dept: 'print', staff: 'mo',
      orderId: null,
    });
    const insert2 = findCallContaining('INSERT INTO jobs');
    expect(insert2!.values[1]).toBeNull();
  });

  it('defaults status to "pending" when not provided', async () => {
    queueResult({ rowCount: 1 });
    await addJobToPostgres({
      id: 300, name: 'x', dept: 'print', staff: 'mo',
    });
    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert!.values[7]).toBe('pending');
  });

  it('trims whitespace from name', async () => {
    queueResult({ rowCount: 1 });
    await addJobToPostgres({
      id: 400, name: '  job with spaces  ', dept: 'print', staff: 'mo',
    });
    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert!.values[2]).toBe('job with spaces');
  });
});

describe('createOrderInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws on unconfigured / invalid orderId / missing name', async () => {
    setConfigured(false);
    await expect(
      createOrderInPostgres({ orderId: 202605070, order: { name: 'x' } }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    setConfigured(true);
    await expect(
      createOrderInPostgres({ orderId: 0, order: { name: 'x' } }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(
      createOrderInPostgres({ orderId: 202605070, order: { name: '' } }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
  });

  it('INSERTs order row with phase2_dirty_at + draft (no job)', async () => {
    queueResult({ rowCount: 1 }); // order insert
    const r = await createOrderInPostgres({
      orderId: 202605070,
      order: {
        name: 'Brochure 1000',
        customer: 'TestCo',
        dateIn: '2026-05-11',
        status: 'draft',
      },
    });
    expect(r).toEqual({ ok: true, orderId: 202605070, jobId: null });

    const insert = findCallContaining('INSERT INTO orders');
    expect(insert, 'createOrderInPostgres must run INSERT INTO orders').toBeDefined();
    // Critical — phase2_dirty_at must be set so heal cron pushes to Sheet.
    expect(insert!.text, 'order INSERT must include phase2_dirty_at column').toContain('phase2_dirty_at');
    expect(insert!.text, 'phase2_dirty_at must be set via NOW()').toMatch(/NOW\(\)/);
    expect(insert!.text, 'order INSERT must be idempotent via ON CONFLICT').toContain('ON CONFLICT (id) DO NOTHING');

    expect(insert!.values[0]).toBe(202605070);
    expect(insert!.values[1]).toBe('Brochure 1000');
    expect(insert!.values[2]).toBe('TestCo');

    // No jobs INSERT for draft path
    expect(callsContaining('INSERT INTO jobs'), 'draft mode must NOT INSERT INTO jobs').toHaveLength(0);
  });

  it('INSERTs both order + job rows with shared phase2_dirty_at', async () => {
    queueResult({ rowCount: 1 }); // order
    queueResult({ rowCount: 1 }); // job

    const r = await createOrderInPostgres({
      orderId: 202605071,
      order: { name: 'Job Order', customer: 'CustB', status: 'sent' },
      jobId: 480,
      job: { name: 'Job Order', dept: 'graphic', staff: 'aor', dateIn: '2026-05-11' },
    });
    expect(r).toEqual({ ok: true, orderId: 202605071, jobId: 480 });

    const orderInsert = findCallContaining('INSERT INTO orders');
    expect(orderInsert, 'order INSERT must run on non-draft createOrder').toBeDefined();
    expect(orderInsert!.text, 'order INSERT must include phase2_dirty_at').toContain('phase2_dirty_at');

    const jobInsert = findCallContaining('INSERT INTO jobs');
    expect(jobInsert, 'job INSERT must run when input.job provided').toBeDefined();
    expect(jobInsert!.text, 'job INSERT must include phase2_dirty_at').toContain('phase2_dirty_at');
    expect(jobInsert!.text, 'job INSERT must be idempotent').toContain('ON CONFLICT (id) DO NOTHING');
    // jobs INSERT values: [id, orderId, name, ...]
    expect(jobInsert!.values[0]).toBe(480);
    expect(jobInsert!.values[1]).toBe(202605071);
  });

  it('throws when job is provided without jobId (caller bug guard)', async () => {
    queueResult({ rowCount: 1 }); // order succeeds
    await expect(
      createOrderInPostgres({
        orderId: 202605072,
        order: { name: 'x' },
        jobId: 0, // invalid
        job: { name: 'x', dept: 'graphic', staff: 'aor' },
      }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
  });
});

describe('findDuplicateOrdersInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns empty array when not configured', async () => {
    setConfigured(false);
    expect(await findDuplicateOrdersInPostgres('x', 'y')).toEqual([]);
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns empty array for empty inputs', async () => {
    expect(await findDuplicateOrdersInPostgres('', 'y')).toEqual([]);
    expect(await findDuplicateOrdersInPostgres('x', '')).toEqual([]);
    expect(sqlCalls).toHaveLength(0);
  });

  it('queries lowercased name + customer and excludes cancelled', async () => {
    queueResult({
      rows: [
        { id: 202605070, name: 'Brochure', customer: 'CustA', dateIn: '2026-05-01' },
      ],
    });
    const hits = await findDuplicateOrdersInPostgres('  Brochure  ', '  CustA  ');
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe(202605070);

    const select = findCallContaining('FROM orders');
    expect(select).toBeDefined();
    // Lowercased + trimmed lookup
    expect(select!.values).toContain('brochure');
    expect(select!.values).toContain('custa');
    // Excludes cancelled
    expect(select!.text).toMatch(/status.*!=.*'cancelled'/i);
  });
});

describe('moveToShippedInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when job missing — no INSERT, no tombstone', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await moveToShippedInPostgres({
      id: 999, name: 'ghost', shippedDate: '11/05/2026',
    });
    expect(r).toEqual({ ok: true, found: false });
    expect(callsContaining('INSERT INTO shipped'), 'must not insert when job missing').toHaveLength(0);
    expect(callsContaining('UPDATE jobs SET phase2_deleted_at'), 'must not tombstone missing job').toHaveLength(0);
  });

  it('INSERTs shipped + tombstones jobs row (atomic-ish 2-step)', async () => {
    queueResult({ rows: [{ raw: { id: 437, dept: 'post', staff: 'top' } }], rowCount: 1 }); // SELECT
    queueResult({ rowCount: 1 }); // INSERT shipped
    queueResult({ rowCount: 1 }); // UPDATE jobs

    const r = await moveToShippedInPostgres({
      id: 437, name: 'ใบยืมขวดลัง', shippedDate: '11/05/2026', orderId: 202605061,
    });
    expect(r).toEqual({ ok: true, found: true });

    const shippedInsert = findCallContaining('INSERT INTO shipped');
    expect(shippedInsert, 'must INSERT into shipped').toBeDefined();
    expect(shippedInsert!.text, 'shipped INSERT must mark dirty').toContain('phase2_dirty_at');
    expect(shippedInsert!.text, 'shipped INSERT must be idempotent').toContain('ON CONFLICT (id) DO UPDATE');

    const tombstone = findCallContaining('UPDATE jobs SET phase2_deleted_at');
    expect(tombstone, 'jobs row must be tombstoned via phase2_deleted_at').toBeDefined();
    expect(tombstone!.text).toContain('NOW()');
  });

  it('throws on invalid id', async () => {
    await expect(
      moveToShippedInPostgres({ id: 0, name: 'x', shippedDate: '' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
  });
});

describe('cancelJobInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when job missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await cancelJobInPostgres({
      id: 999, name: 'x', reason: 'r', cancelledBy: 'u', cancelledAt: 't',
    });
    expect(r).toEqual({ ok: true, found: false });
    expect(callsContaining('INSERT INTO cancelled')).toHaveLength(0);
  });

  it('INSERTs cancelled + tombstones jobs row, inherits dept/staff from raw', async () => {
    queueResult({
      rows: [{ raw: { id: 478, dept: 'graphic', staff: 'aor' } }],
      rowCount: 1,
    });
    queueResult({ rowCount: 1 }); // INSERT cancelled
    queueResult({ rowCount: 1 }); // UPDATE jobs

    const r = await cancelJobInPostgres({
      id: 478,
      name: 'job-X',
      reason: 'ลูกค้ายกเลิก',
      cancelledBy: 'admin:nook',
      cancelledAt: '11/05/2026',
    });
    expect(r).toEqual({ ok: true, found: true });

    const cancelInsert = findCallContaining('INSERT INTO cancelled');
    expect(cancelInsert, 'must INSERT into cancelled').toBeDefined();
    expect(cancelInsert!.text, 'cancelled INSERT must mark dirty').toContain('phase2_dirty_at');
    expect(cancelInsert!.text, 'cancelled INSERT must be idempotent').toContain('ON CONFLICT (id) DO UPDATE');
    // dept/staff inherited from raw (input didn't provide them)
    const dept = cancelInsert!.values.find((v) => v === 'graphic');
    expect(dept, 'dept must inherit from raw when not in input').toBe('graphic');

    const tombstone = findCallContaining('UPDATE jobs SET phase2_deleted_at');
    expect(tombstone).toBeDefined();
  });
});

describe('bulkForwardInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('row-missing item goes to failed[] — does NOT block other items', async () => {
    // Item 1: row exists (SELECT returns row, then INSERT + UPDATE)
    queueResult({ rows: [{ id: 100 }], rowCount: 1 });
    queueResult({ rowCount: 1 }); // INSERT new
    queueResult({ rowCount: 1 }); // UPDATE old (tombstone)
    // Item 2: row missing (SELECT empty)
    queueResult({ rows: [], rowCount: 0 });

    const r = await bulkForwardInPostgres([
      { oldId: 100, newJob: { id: 500, name: 'job-A', dept: 'print', staff: 'mo' } },
      { oldId: 999, newJob: { id: 501, name: 'job-B', dept: 'print', staff: 'mo' } },
    ]);
    expect(r.succeeded).toHaveLength(1);
    expect(r.succeeded[0]).toMatchObject({ oldId: 100, newId: 500, name: 'job-A' });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].oldId).toBe(999);
    expect(r.failed[0].error).toMatch(/not in Postgres mirror/i);
  });

  it('successful item INSERTs new with dirty mark + tombstones old', async () => {
    queueResult({ rows: [{ id: 200 }], rowCount: 1 });
    queueResult({ rowCount: 1 });
    queueResult({ rowCount: 1 });

    await bulkForwardInPostgres([
      { oldId: 200, newJob: { id: 700, name: 'fwd', dept: 'post', staff: 'top', orderId: 202605061 } },
    ]);

    const inserts = callsContaining('INSERT INTO jobs');
    expect(inserts, 'must INSERT new jobs row').toHaveLength(1);
    expect(inserts[0].text, 'new job must mark dirty').toContain('phase2_dirty_at');
    expect(inserts[0].text, 'INSERT must be idempotent').toContain('ON CONFLICT (id) DO NOTHING');

    const tombstones = callsContaining('UPDATE jobs SET phase2_deleted_at');
    expect(tombstones, 'old job must be tombstoned').toHaveLength(1);
  });

  it('per-item invalid input goes to failed without throwing', async () => {
    const r = await bulkForwardInPostgres([
      { oldId: 0, newJob: { id: 500, name: 'x', dept: 'print', staff: 'mo' } },
      { oldId: 200, newJob: { id: 0, name: 'x', dept: 'print', staff: 'mo' } },
      { oldId: 200, newJob: { id: 501, name: '', dept: 'print', staff: 'mo' } },
    ]);
    expect(r.succeeded).toHaveLength(0);
    expect(r.failed).toHaveLength(3);
    expect(r.failed[0].error).toMatch(/Invalid oldId/);
    expect(r.failed[1].error).toMatch(/Invalid newId/);
    expect(r.failed[2].error).toMatch(/Missing job name/);
    // No SQL ran for invalid items
    expect(sqlCalls).toHaveLength(0);
  });
});

describe('appendAuditToPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('inserts audit_log row with source=postgres + auto-generated summary', async () => {
    queueResult({ rowCount: 1 });
    await appendAuditToPostgres({
      action: 'addJob',
      role: 'admin',
      user: 'nook',
      targetId: 12345,
      data: { name: 'Brochure 1000', dept: 'graphic', staff: 'aor' },
    });
    const insert = findCallContaining('INSERT INTO audit_log');
    expect(insert).toBeDefined();
    // Critical — source must be 'postgres' so the from-Sheet cron's
    // DELETE WHERE source='sheet' doesn't wipe Phase 2 audit entries.
    expect(insert!.text).toContain("'postgres'");

    // Bound values: [actor, user, action, targetId, summary]
    expect(insert!.values[0]).toBe('admin:nook');  // formatActor
    expect(insert!.values[1]).toBe('nook');
    expect(insert!.values[2]).toBe('addJob');
    expect(insert!.values[3]).toBe(12345);
    // Summary follows Apps Script audit.ts convention:
    expect(insert!.values[4]).toBe('เพิ่มงาน "Brochure 1000" → graphic/aor');
  });

  it('drops user prefix when actor matches role (matches Apps Script formatActor)', async () => {
    queueResult({ rowCount: 1 });
    await appendAuditToPostgres({
      action: 'updateJob',
      role: 'admin',
      user: 'admin',  // same as role
      targetId: 1,
      data: { name: 'x', dept: 'print', staff: 'mo' },
    });
    const insert = findCallContaining('INSERT INTO audit_log');
    expect(insert!.values[0]).toBe('admin');  // not 'admin:admin'
  });

  it('uses provided summary when given (no auto-generation)', async () => {
    queueResult({ rowCount: 1 });
    await appendAuditToPostgres({
      action: 'customAction',
      role: 'admin',
      user: 'nook',
      targetId: 99,
      summary: 'Custom message',
    });
    const insert = findCallContaining('INSERT INTO audit_log');
    expect(insert!.values[4]).toBe('Custom message');
  });

  it('generates correct summary for setCowork (matches Apps Script switch)', async () => {
    queueResult({ rowCount: 1 });
    await appendAuditToPostgres({
      action: 'setCowork',
      role: 'admin',
      user: 'nook',
      targetId: 100,
      cowork: ['mo', 'top'],
    });
    const insert = findCallContaining('INSERT INTO audit_log');
    expect(insert!.values[4]).toBe('ตั้ง Co-work job=100: ["mo","top"]');
  });

  it('handles non-numeric targetId gracefully (extracts digits)', async () => {
    queueResult({ rowCount: 1 });
    await appendAuditToPostgres({
      action: 'updateJob',
      role: 'admin',
      targetId: 'job#42',  // weird input
      data: { name: 'x', dept: 'print', staff: 'mo' },
    });
    const insert = findCallContaining('INSERT INTO audit_log');
    expect(insert!.values[3]).toBe(42);
  });

  it('NEVER throws on Postgres failure — audit must not break user mutation', async () => {
    setConfigured(false);
    // Should silently no-op, not reject
    await expect(
      appendAuditToPostgres({ action: 'x', role: 'admin', targetId: 1 }),
    ).resolves.toBeUndefined();
    expect(sqlCalls).toHaveLength(0);
  });
});

describe('addTemplateToPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('inserts with Date.now() id + provided fields', async () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    queueResult({ rowCount: 1 });
    const r = await addTemplateToPostgres({
      name: 'My Template',
      rawData: { foo: 'bar' },
      createdBy: 'admin',
    });
    expect(r).toEqual({ ok: true, id: fixedNow });

    const insert = findCallContaining('INSERT INTO templates');
    expect(insert).toBeDefined();
    expect(insert!.values[0]).toBe(fixedNow);
    expect(insert!.values[1]).toBe('My Template');
    // raw_data column gets the rawData object stringified
    expect(JSON.parse(insert!.values[2] as string)).toEqual({ foo: 'bar' });
    expect(insert!.values[3]).toBe('admin');
    // raw column = full snapshot
    const raw = JSON.parse(insert!.values[5] as string);
    expect(raw).toMatchObject({ id: fixedNow, name: 'My Template', createdBy: 'admin' });
  });

  it('parses string rawData as JSON', async () => {
    queueResult({ rowCount: 1 });
    await addTemplateToPostgres({
      name: 'X',
      rawData: '{"a":1}',
    });
    const insert = findCallContaining('INSERT INTO templates');
    expect(JSON.parse(insert!.values[2] as string)).toEqual({ a: 1 });
  });

  it('falls back to {} when rawData string is invalid JSON (no throw)', async () => {
    queueResult({ rowCount: 1 });
    await addTemplateToPostgres({ name: 'Y', rawData: 'not json' });
    const insert = findCallContaining('INSERT INTO templates');
    expect(JSON.parse(insert!.values[2] as string)).toEqual({});
  });

  it('throws PostgresWriteError when name is empty/whitespace', async () => {
    await expect(addTemplateToPostgres({ name: '' })).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(addTemplateToPostgres({ name: '   ' })).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });
});

describe('deleteTemplateFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:true when row deleted', async () => {
    queueResult({ rowCount: 1 });
    const r = await deleteTemplateFromPostgres(123);
    expect(r).toEqual({ ok: true, found: true });
    const del = findCallContaining('DELETE FROM templates');
    expect(del!.values).toEqual([123]);
  });

  it('returns found:false when row missing (soft no-op, matches Sheet semantics)', async () => {
    queueResult({ rowCount: 0 });
    const r = await deleteTemplateFromPostgres(999);
    expect(r).toEqual({ ok: true, found: false });
  });

  it('throws on invalid id', async () => {
    await expect(deleteTemplateFromPostgres('abc')).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(deleteTemplateFromPostgres(0)).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });
});
