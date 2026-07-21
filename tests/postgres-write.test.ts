import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sqlCalls,
  resetMockPostgres,
  queueResult,
  queueError,
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
  updateOrderInPostgres,
  promoteDraftInPostgres,
  cancelOrderInPostgres,
  deleteJobInPostgres,
  restoreJobInPostgres,
  isActiveJobConflict,
  appendAuditToPostgres,
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

  it('updates cowork column + raw snapshot when row exists', async () => {
    const oldRaw = { id: 42, name: 'job-A', cowork: null, dept: 'print' };
    queueResult({ rows: [{ raw: oldRaw }], rowCount: 1 });  // SELECT
    queueResult({ rowCount: 1 });  // UPDATE

    const r = await setCoworkInPostgres({ id: 42, cowork: ['mo', 'aor'] });
    expect(r).toEqual({ ok: true, found: true });

    const update = findCallContaining('UPDATE jobs');
    expect(update).toBeDefined();
    expect(update!.text).toContain('cowork =');
    expect(update!.text).toContain('raw =');
    // §12 Step 2F: phase2_dirty_at dropped — the UPDATE must no longer write it.
    expect(update!.text).not.toContain('phase2_dirty_at');

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

  it('updates all fields, merges raw with old snapshot', async () => {
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

    // §12 Step 2F: phase2_dirty_at dropped — the UPDATE must no longer write it.
    expect(update!.text).not.toContain('phase2_dirty_at');
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

  it('inserts with all fields', async () => {
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
    // §12 Step 2F: phase2_dirty_at dropped — INSERT must no longer reference it.
    expect(insert!.text).not.toContain('phase2_dirty_at');

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

  it('INSERTs order row as draft (no job)', async () => {
    queueResult({ rows: [{ id: 202605070 }], rowCount: 1 }); // order insert
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
    // §12 Step 2F: phase2_dirty_at dropped — order INSERT must not reference it.
    expect(insert!.text, 'order INSERT must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(insert!.text, 'order INSERT must be idempotent via ON CONFLICT').toContain('ON CONFLICT (id) DO NOTHING');

    expect(insert!.values[0]).toBe(202605070);
    expect(insert!.values[1]).toBe('Brochure 1000');
    expect(insert!.values[2]).toBe('TestCo');

    // No jobs INSERT for draft path
    expect(callsContaining('INSERT INTO jobs'), 'draft mode must NOT INSERT INTO jobs').toHaveLength(0);
  });

  it('INSERTs both order + job rows', async () => {
    queueResult({ rows: [{ id: 202605071 }], rowCount: 1 }); // order
    queueResult({ rows: [{ id: 480 }], rowCount: 1 }); // job

    const r = await createOrderInPostgres({
      orderId: 202605071,
      order: { name: 'Job Order', customer: 'CustB', status: 'sent' },
      jobId: 480,
      job: { name: 'Job Order', dept: 'graphic', staff: 'aor', dateIn: '2026-05-11' },
    });
    expect(r).toEqual({ ok: true, orderId: 202605071, jobId: 480 });

    const orderInsert = findCallContaining('INSERT INTO orders');
    expect(orderInsert, 'order INSERT must run on non-draft createOrder').toBeDefined();
    expect(orderInsert!.text, 'order INSERT must not write phase2_dirty_at').not.toContain('phase2_dirty_at');

    const jobInsert = findCallContaining('INSERT INTO jobs');
    expect(jobInsert, 'job INSERT must run when input.job provided').toBeDefined();
    expect(jobInsert!.text, 'job INSERT must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(jobInsert!.text, 'job INSERT must be idempotent').toContain('ON CONFLICT (id) DO NOTHING');
    // jobs INSERT values: [id, orderId, name, ...]
    expect(jobInsert!.values[0]).toBe(480);
    expect(jobInsert!.values[1]).toBe(202605071);
  });

  it('throws when job is provided without jobId (caller bug guard)', async () => {
    queueResult({ rows: [{ id: 202605072 }], rowCount: 1 }); // order succeeds
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

  it('only matches still-open orders — active job (non-tombstoned), draft, or pure orphan', async () => {
    // Shipped/finished orders must NOT trigger the duplicate warning:
    // repeat orders from the same customer are routine (2026-06-11 fix).
    // "Shipped" is derived from jobs (all rows tombstoned/moved), NOT from
    // orders.status, which isn't reliably updated to 'shipped'.
    queueResult({ rows: [] });
    await findDuplicateOrdersInPostgres('Brochure', 'CustA');

    const select = findCallContaining('FROM orders');
    expect(select).toBeDefined();
    expect(select!.text, 'must gate on an active job in jobs table').toContain('EXISTS');
    expect(select!.text, 'active job = not tombstoned').toContain('phase2_deleted_at IS NULL');
    expect(select!.text, 'drafts (no job yet) still count as open').toMatch(/status.*=.*'draft'/i);
    // Pure orphan (partial createOrder failure: order row but no job anywhere)
    // must keep warning — otherwise a retry silently mints a duplicate (M1).
    expect(select!.text, 'orphans still count as open').toContain('NOT EXISTS');
    expect(select!.text).toContain('FROM shipped');
    expect(select!.text).toContain('FROM cancelled');
  });
});

describe('moveToShippedInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when gate matches nothing (missing OR already transitioned) — no INSERT', async () => {
    queueResult({ rows: [], rowCount: 0 }); // conditional tombstone matches 0 rows
    const r = await moveToShippedInPostgres({
      id: 999, name: 'ghost', shippedDate: '11/05/2026',
    });
    expect(r).toEqual({ ok: true, found: false });
    // The gate IS the conditional tombstone — it ran but matched nothing.
    const gates = callsContaining('UPDATE jobs SET phase2_deleted_at = NOW()');
    expect(gates, 'gate must be a single conditional tombstone').toHaveLength(1);
    expect(gates[0].text, 'gate must be conditional (race mutual-exclusion)').toContain('phase2_deleted_at IS NULL');
    expect(callsContaining('INSERT INTO shipped'), 'must not insert when gate lost').toHaveLength(0);
  });

  it('gates via conditional tombstone FIRST, then INSERTs shipped (audit H3 2026-07-21)', async () => {
    queueResult({ rows: [{ id: 437 }], rowCount: 1 }); // gate UPDATE ... RETURNING id
    queueResult({ rowCount: 1 }); // INSERT shipped

    const r = await moveToShippedInPostgres({
      id: 437, name: 'ใบยืมขวดลัง', shippedDate: '11/05/2026', orderId: 202605061,
    });
    expect(r).toEqual({ ok: true, found: true });

    // Order pin: the tombstone gate must run BEFORE the terminal-table INSERT —
    // that single conditional statement is what makes racing transitions
    // (ship∥ship, ship∥forward, ship∥cancel) mutually exclusive.
    const gateIdx = sqlCalls.findIndex((c) => c.text.includes('UPDATE jobs SET phase2_deleted_at = NOW()'));
    const insertIdx = sqlCalls.findIndex((c) => c.text.includes('INSERT INTO shipped'));
    expect(gateIdx, 'gate must exist').toBeGreaterThanOrEqual(0);
    expect(insertIdx, 'shipped INSERT must exist').toBeGreaterThan(gateIdx);
    expect(sqlCalls[gateIdx].text).toContain('phase2_deleted_at IS NULL');
    expect(sqlCalls[gateIdx].text).toContain('RETURNING');

    const shippedInsert = sqlCalls[insertIdx];
    expect(shippedInsert.text, 'shipped INSERT must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(shippedInsert.text, 'shipped INSERT must be idempotent').toContain('ON CONFLICT (id) DO UPDATE');
  });

  it('compensates (un-tombstones) and rethrows when the shipped INSERT fails after the gate', async () => {
    queueResult({ rows: [{ id: 437 }], rowCount: 1 }); // gate wins
    queueError(new Error('insert exploded'));           // INSERT shipped fails
    queueResult({ rowCount: 1 });                       // compensating un-tombstone

    await expect(
      moveToShippedInPostgres({ id: 437, name: 'x', shippedDate: '11/05/2026' }),
    ).rejects.toThrow('insert exploded');

    const revive = findCallContaining('phase2_deleted_at = NULL');
    expect(revive, 'failed INSERT must revive the source row (no vanishing job)').toBeDefined();
  });

  it('throws on invalid id', async () => {
    await expect(
      moveToShippedInPostgres({ id: 0, name: 'x', shippedDate: '' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
  });
});

describe('cancelJobInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when gate matches nothing (missing OR already transitioned)', async () => {
    queueResult({ rows: [], rowCount: 0 }); // conditional tombstone matches 0 rows
    const r = await cancelJobInPostgres({
      id: 999, name: 'x', reason: 'r', cancelledBy: 'u', cancelledAt: 't',
    });
    expect(r).toEqual({ ok: true, found: false });
    expect(callsContaining('INSERT INTO cancelled')).toHaveLength(0);
    const gates = callsContaining('UPDATE jobs SET phase2_deleted_at = NOW()');
    expect(gates).toHaveLength(1);
    expect(gates[0].text, 'gate must be conditional').toContain('phase2_deleted_at IS NULL');
  });

  it('gates via conditional tombstone (RETURNING raw) then INSERTs cancelled, inherits dept/staff from raw', async () => {
    queueResult({
      rows: [{ raw: { id: 478, dept: 'graphic', staff: 'aor' } }],
      rowCount: 1,
    }); // gate UPDATE ... RETURNING raw
    queueResult({ rowCount: 1 }); // INSERT cancelled

    const r = await cancelJobInPostgres({
      id: 478,
      name: 'job-X',
      reason: 'ลูกค้ายกเลิก',
      cancelledBy: 'admin:nook',
      cancelledAt: '11/05/2026',
    });
    expect(r).toEqual({ ok: true, found: true });

    // Gate before INSERT (race mutual-exclusion) + RETURNING raw feeds the
    // dept/staff inheritance without a separate SELECT.
    const gateIdx = sqlCalls.findIndex((c) => c.text.includes('UPDATE jobs SET phase2_deleted_at = NOW()'));
    const insertIdx = sqlCalls.findIndex((c) => c.text.includes('INSERT INTO cancelled'));
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(gateIdx);
    expect(sqlCalls[gateIdx].text).toContain('phase2_deleted_at IS NULL');
    expect(sqlCalls[gateIdx].text).toContain('RETURNING raw');

    const cancelInsert = sqlCalls[insertIdx];
    expect(cancelInsert.text, 'cancelled INSERT must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(cancelInsert.text, 'cancelled INSERT must be idempotent').toContain('ON CONFLICT (id) DO UPDATE');
    // dept/staff inherited from raw (input didn't provide them)
    const dept = cancelInsert.values.find((v) => v === 'graphic');
    expect(dept, 'dept must inherit from raw when not in input').toBe('graphic');
  });

  it('compensates (un-tombstones) and rethrows when the cancelled INSERT fails after the gate', async () => {
    queueResult({ rows: [{ raw: { id: 478 } }], rowCount: 1 }); // gate wins
    queueError(new Error('insert exploded'));                    // INSERT cancelled fails
    queueResult({ rowCount: 1 });                                // compensating un-tombstone

    await expect(
      cancelJobInPostgres({ id: 478, name: 'x', reason: 'r', cancelledBy: 'u', cancelledAt: 't' }),
    ).rejects.toThrow('insert exploded');
    expect(findCallContaining('phase2_deleted_at = NULL'), 'must revive source row').toBeDefined();
  });
});

describe('bulkForwardInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('gate-lost item (missing OR already forwarded — double-click loser) goes to failed[] — does NOT block other items', async () => {
    // Item 1: gate wins (conditional tombstone RETURNING id), then INSERT new
    queueResult({ rows: [{ id: 100 }], rowCount: 1 });
    queueResult({ rows: [{ id: 500 }], rowCount: 1 }); // INSERT new
    // Item 2: gate matches 0 rows (missing or already tombstoned by the racing winner)
    queueResult({ rows: [], rowCount: 0 });

    const r = await bulkForwardInPostgres([
      { oldId: 100, newJob: { id: 500, name: 'job-A', dept: 'print', staff: 'mo' } },
      { oldId: 999, newJob: { id: 501, name: 'job-B', dept: 'print', staff: 'mo' } },
    ]);
    expect(r.succeeded).toHaveLength(1);
    expect(r.succeeded[0]).toMatchObject({ oldId: 100, newId: 500, name: 'job-A' });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].oldId).toBe(999);
    expect(r.failed[0].error).toMatch(/not found or already forwarded/i);
    // The loser must NOT have inserted a second card (the H2 double-forward bug).
    expect(callsContaining('INSERT INTO jobs')).toHaveLength(1);
  });

  it('successful item gates old via conditional tombstone FIRST, then INSERTs new (audit H2 2026-07-21)', async () => {
    queueResult({ rows: [{ id: 200 }], rowCount: 1 }); // gate
    queueResult({ rows: [{ id: 700 }], rowCount: 1 }); // INSERT new

    await bulkForwardInPostgres([
      { oldId: 200, newJob: { id: 700, name: 'fwd', dept: 'post', staff: 'top', orderId: 202605061 } },
    ]);

    // Order pin: conditional tombstone (the race gate) BEFORE the new-job INSERT.
    const gateIdx = sqlCalls.findIndex((c) => c.text.includes('UPDATE jobs SET phase2_deleted_at = NOW()'));
    const insertIdx = sqlCalls.findIndex((c) => c.text.includes('INSERT INTO jobs'));
    expect(gateIdx, 'gate must exist').toBeGreaterThanOrEqual(0);
    expect(insertIdx, 'INSERT must come after the gate').toBeGreaterThan(gateIdx);
    expect(sqlCalls[gateIdx].text).toContain('phase2_deleted_at IS NULL');
    expect(sqlCalls[gateIdx].text).toContain('RETURNING');

    const insert = sqlCalls[insertIdx];
    expect(insert.text, 'new job must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(insert.text, 'INSERT must be idempotent').toContain('ON CONFLICT (id) DO NOTHING');
  });

  it('compensates (un-tombstones old) when the new-job INSERT fails after the gate', async () => {
    queueResult({ rows: [{ id: 200 }], rowCount: 1 }); // gate wins
    queueError(new Error('insert exploded'));           // INSERT new fails
    queueResult({ rowCount: 1 });                       // compensating un-tombstone

    const r = await bulkForwardInPostgres([
      { oldId: 200, newJob: { id: 700, name: 'fwd', dept: 'post', staff: 'top' } },
    ]);
    expect(r.succeeded).toHaveLength(0);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/insert exploded/);
    // Failed forward must leave the board unchanged — source row revived.
    expect(findCallContaining('phase2_deleted_at = NULL'), 'must revive old job').toBeDefined();
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

describe('updateOrderInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when order missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await updateOrderInPostgres({ id: 999, name: 'x' });
    expect(r).toEqual({ ok: true, found: false });
    expect(callsContaining('UPDATE orders SET')).toHaveLength(0);
  });

  it('UPDATEs order with merged fields', async () => {
    queueResult({ rows: [{ raw: { id: 202605061, name: 'old', customer: 'Cust' } }], rowCount: 1 });
    queueResult({ rowCount: 1 });
    const r = await updateOrderInPostgres({
      id: 202605061,
      name: 'new-name',
      customer: 'Cust',
      dateDue: '2026-05-20',
    });
    expect(r).toEqual({ ok: true, found: true });
    const upd = findCallContaining('UPDATE orders SET');
    expect(upd, 'must UPDATE orders').toBeDefined();
    expect(upd!.text, 'orders UPDATE must not write phase2_dirty_at').not.toContain('phase2_dirty_at');
    expect(upd!.text).toContain('name =');
    expect(upd!.text).toContain('date_due =');
  });
});

describe('promoteDraftInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  // M-promote-draft-double-submit (audit 2026-07-21): the old shape was
  // SELECT order → INSERT job → unconditional flip. Two concurrent promotes
  // both passed the route's job-existence read → 2 initial jobs. New shape:
  // the draft→sent flip IS the gate and runs FIRST — statement atomicity
  // makes racing promotes mutual-exclusive (conditional-gate-first, same
  // pattern as H2/H3 forward/ship/cancel).

  it('gate-first: conditional draft→sent flip runs BEFORE the job INSERT', async () => {
    queueResult({ rows: [{ id: 202605061 }], rowCount: 1 }); // gate: flip won
    queueResult({ rows: [{ id: 510 }], rowCount: 1 });       // INSERT jobs

    const r = await promoteDraftInPostgres({
      orderId: 202605061,
      jobId: 510,
      job: { name: 'order-X', dept: 'graphic', staff: 'aor', dateIn: '2026-05-11' },
    });
    expect(r).toEqual({
      ok: true, orderId: 202605061, jobId: 510, found: true, alreadyPromoted: false,
    });

    const gate = sqlCalls[0];
    expect(gate.text, 'first statement must be the conditional flip').toContain('UPDATE orders');
    expect(gate.text, 'gate must require draft state').toContain("status = 'draft'");
    expect(gate.text).toMatch(/status\s*=\s*'sent'/);
    expect(gate.text, 'gate needs RETURNING to detect the loser').toContain('RETURNING');
    expect(gate.text).not.toContain('phase2_dirty_at');

    const jobInsert = findCallContaining('INSERT INTO jobs');
    expect(jobInsert, 'must INSERT new job').toBeDefined();
    expect(jobInsert!.text).not.toContain('phase2_dirty_at');
    expect(jobInsert!.text).toContain('ON CONFLICT (id) DO NOTHING');
    expect(sqlCalls.indexOf(jobInsert!), 'INSERT must come after the gate').toBeGreaterThan(0);
  });

  it('loser: gate 0 rows + order exists → alreadyPromoted, no job INSERT', async () => {
    queueResult({ rows: [], rowCount: 0 });                      // gate: lost the race
    queueResult({ rows: [{ status: 'sent' }], rowCount: 1 });    // probe: order exists

    const r = await promoteDraftInPostgres({
      orderId: 202605061, jobId: 511,
      job: { name: 'order-X', dept: 'graphic', staff: 'aor' },
    });
    expect(r.found).toBe(true);
    expect(r.alreadyPromoted).toBe(true);
    expect(callsContaining('INSERT INTO jobs')).toHaveLength(0);
  });

  it('returns found:false when order missing', async () => {
    queueResult({ rows: [], rowCount: 0 }); // gate: no match
    queueResult({ rows: [], rowCount: 0 }); // probe: no order at all
    const r = await promoteDraftInPostgres({
      orderId: 999, jobId: 500,
      job: { name: 'x', dept: 'graphic', staff: 'aor' },
    });
    expect(r.found).toBe(false);
    expect(callsContaining('INSERT INTO jobs')).toHaveLength(0);
  });

  it('compensates the flip back to draft when the job INSERT fails', async () => {
    queueResult({ rows: [{ id: 202605061 }], rowCount: 1 }); // gate: flip won
    queueError(new Error('insert exploded'));                 // INSERT jobs → SQL error
    queueResult({ rowCount: 1 });                             // compensating un-flip

    await expect(
      promoteDraftInPostgres({
        orderId: 202605061, jobId: 512,
        job: { name: 'order-X', dept: 'graphic', staff: 'aor' },
      }),
    ).rejects.toThrow('insert exploded');

    const unflip = callsContaining('UPDATE orders').find((c) => c.text.includes("'draft'"));
    expect(unflip, 'must flip the order back to draft so the draft is not lost').toBeDefined();
  });
});

describe('isActiveJobConflict', () => {
  // M-jobs-add-guard-race (audit 2026-07-21): the route's SELECT-then-INSERT
  // guard can't stop concurrent adds (no common row to lock under READ
  // COMMITTED) — the partial unique index uq_jobs_active_order is the real
  // gate. This helper lets routes map its 23505 violation to a friendly 409
  // instead of a raw 500.
  it('detects a unique violation on uq_jobs_active_order', () => {
    const err = new Error(
      'duplicate key value violates unique constraint "uq_jobs_active_order"',
    );
    expect(isActiveJobConflict(err)).toBe(true);
  });

  it('ignores other errors (different constraint / non-Error)', () => {
    expect(isActiveJobConflict(new Error('duplicate key value violates unique constraint "jobs_pkey"'))).toBe(false);
    expect(isActiveJobConflict(new Error('connection refused'))).toBe(false);
    expect(isActiveJobConflict('uq_jobs_active_order')).toBe(false);
    expect(isActiveJobConflict(null)).toBe(false);
  });
});

describe('cancelOrderInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('returns found:false when order missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await cancelOrderInPostgres({
      orderId: 999, reason: 'r', cancelledBy: 'u', cancelledAt: 't',
    });
    expect(r.found).toBe(false);
  });

  it('cascade-cancels all active jobs + flips order status', async () => {
    queueResult({ rows: [{ raw: { id: 202605061, status: 'sent' } }], rowCount: 1 }); // SELECT order
    queueResult({
      rows: [
        { id: 100, raw: { id: 100, name: 'job-A', dept: 'graphic', staff: 'aor' } },
        { id: 101, raw: { id: 101, name: 'job-B', dept: 'print', staff: 'mo' } },
      ],
      rowCount: 2,
    }); // SELECT jobs
    // For each job in cascade: gate (conditional tombstone RETURNING raw) + INSERT cancelled (= 2 calls × 2 jobs)
    for (let i = 0; i < 2; i++) {
      queueResult({ rows: [{ raw: { id: 100 + i, name: 'job-' + i } }], rowCount: 1 });
      queueResult({ rowCount: 1 });
    }
    queueResult({ rowCount: 1 }); // UPDATE orders status

    const r = await cancelOrderInPostgres({
      orderId: 202605061,
      reason: 'ลูกค้ายกเลิก',
      cancelledBy: 'admin:nook',
      cancelledAt: '2026-05-11T...',
    });
    expect(r.found).toBe(true);
    expect(r.cancelledJobs).toEqual([100, 101]);

    const cancelInserts = callsContaining('INSERT INTO cancelled');
    expect(cancelInserts, 'must INSERT cancelled per job').toHaveLength(2);

    const tombstones = callsContaining('UPDATE jobs SET phase2_deleted_at');
    expect(tombstones, 'must tombstone each cascaded job').toHaveLength(2);

    const orderFlip = findCallContaining('UPDATE orders SET');
    expect(orderFlip, 'must flip order status').toBeDefined();
    expect(orderFlip!.text).toMatch(/status\s*=\s*'cancelled'/);
    expect(r.failedJobs).toEqual([]);
  });

  // M-cancelorder-partial-failure (audit 2026-07-21): the cascade loop used
  // to swallow per-job errors (catch {}) and flip the order to 'cancelled'
  // unconditionally — an active job stayed stranded under a cancelled order
  // and the route reported ok. Now a failed cascade aborts the flip and is
  // reported; the SELECT re-fetches only still-active jobs, so a retry
  // cancels the remainder and then flips (idempotent convergence).
  it('aborts the status flip and reports failedJobs when a cascade cancel fails', async () => {
    queueResult({ rows: [{ raw: { id: 202605061, status: 'sent' } }], rowCount: 1 }); // SELECT order
    queueResult({
      rows: [
        { id: 100, raw: { id: 100, name: 'job-A', dept: 'graphic', staff: 'aor' } },
        { id: 101, raw: { id: 101, name: 'job-B', dept: 'print', staff: 'mo' } },
      ],
      rowCount: 2,
    }); // SELECT jobs
    queueResult({ rows: [{ raw: { id: 100, name: 'job-A' } }], rowCount: 1 }); // job 100 gate
    queueResult({ rowCount: 1 });                                             // job 100 INSERT cancelled
    queueError(new Error('db down'));                                          // job 101 gate → SQL error

    const r = await cancelOrderInPostgres({
      orderId: 202605061,
      reason: 'ลูกค้ายกเลิก',
      cancelledBy: 'admin:nook',
      cancelledAt: '2026-05-11T...',
    });

    expect(r.found).toBe(true);
    expect(r.cancelledJobs).toEqual([100]);
    expect(r.failedJobs).toEqual([{ id: 101, error: 'db down' }]);
    const flips = callsContaining('UPDATE orders').filter((c) => c.text.includes("'cancelled'"));
    expect(flips, 'must NOT flip the order while a job is still active').toHaveLength(0);
  });

  it('skips a job already cancelled by a racer (gate 0 rows) and still flips', async () => {
    queueResult({ rows: [{ raw: { id: 202605061, status: 'sent' } }], rowCount: 1 }); // SELECT order
    queueResult({
      rows: [{ id: 100, raw: { id: 100, name: 'job-A', dept: 'graphic', staff: 'aor' } }],
      rowCount: 1,
    }); // SELECT jobs
    queueResult({ rows: [], rowCount: 0 }); // gate: racer already terminal → found:false
    queueResult({ rowCount: 1 });           // UPDATE orders flip

    const r = await cancelOrderInPostgres({
      orderId: 202605061,
      reason: 'r', cancelledBy: 'u', cancelledAt: 't',
    });

    // Already-terminal is not a failure — nothing left active, flip proceeds.
    expect(r.cancelledJobs).toEqual([]);
    expect(r.failedJobs).toEqual([]);
    const flip = callsContaining('UPDATE orders').find((c) => c.text.includes("'cancelled'"));
    expect(flip, 'flip must proceed when remaining jobs are already terminal').toBeDefined();
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

describe('deleteJobInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresWriteError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(deleteJobInPostgres(1)).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on invalid id', async () => {
    await expect(deleteJobInPostgres('abc')).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(deleteJobInPostgres(0)).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(deleteJobInPostgres(-3)).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('returns found:false when the single conditional UPDATE matches nothing', async () => {
    queueResult({ rows: [], rowCount: 0 });  // conditional tombstone matches 0 rows
    const r = await deleteJobInPostgres(999);
    expect(r).toEqual({ ok: true, found: false });
    // One atomic statement — no separate SELECT (audit H3 2026-07-21: the
    // old SELECT-then-UPDATE pair was a race window).
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toContain('UPDATE jobs SET phase2_deleted_at = NOW()');
    expect(sqlCalls[0].text).toContain('phase2_deleted_at IS NULL');
  });

  it('tombstones the row via one conditional UPDATE when it exists', async () => {
    queueResult({ rows: [{ id: 42 }], rowCount: 1 });  // conditional UPDATE ... RETURNING id
    const r = await deleteJobInPostgres(42);
    expect(r).toEqual({ ok: true, found: true });
    expect(sqlCalls).toHaveLength(1);
    const update = sqlCalls[0];
    expect(update.text).toContain('phase2_deleted_at = NOW()');
    expect(update.text).toContain('phase2_deleted_at IS NULL');
    expect(update.text).toContain('RETURNING');
  });
});

describe('restoreJobInPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresWriteError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(
      restoreJobInPostgres({ id: 1, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on invalid id', async () => {
    await expect(
      restoreJobInPostgres({ id: 0, name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    await expect(
      restoreJobInPostgres({ id: 'abc', name: 'x', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('throws PostgresWriteError on missing name', async () => {
    await expect(
      restoreJobInPostgres({ id: 5, name: '   ', dept: 'print', staff: 'mo' }),
    ).rejects.toBeInstanceOf(PostgresWriteError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('upserts the jobs row clearing the tombstone, then deletes the cancelled row', async () => {
    queueResult({ rowCount: 1 });  // INSERT ... ON CONFLICT
    queueResult({ rowCount: 1 });  // DELETE FROM cancelled
    const r = await restoreJobInPostgres({
      id: 77, name: 'job-X', dept: 'post', staff: 'aor',
      orderId: 202605001, date: '2026-05-20', dateIn: '2026-05-18',
    });
    expect(r).toEqual({ ok: true });

    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert).toBeDefined();
    // ON CONFLICT must clear the tombstone — else a stale cancel tombstone
    // keeps the restored job hidden from /board. phase2_dirty_at dropped (§12 2F).
    expect(insert!.text).toContain('phase2_deleted_at = NULL');
    expect(insert!.text).not.toContain('phase2_dirty_at');

    expect(callsContaining('DELETE FROM cancelled')).toHaveLength(1);
  });
});

describe('bulkForwardInPostgres — cowork pass-through', () => {
  beforeEach(() => resetMockPostgres());

  it('preserves cowork in the new row when newJob.cowork is provided (forward-undo)', async () => {
    queueResult({ rows: [{ id: 100 }], rowCount: 1 });  // SELECT exists
    queueResult({ rows: [{ id: 200 }], rowCount: 1 });  // INSERT new
    queueResult({ rowCount: 1 });  // UPDATE tombstone old
    const r = await bulkForwardInPostgres([{
      oldId: 100,
      newJob: { id: 200, name: 'j', staff: 'mo', dept: 'print', cowork: ['aor', 'kik'] },
    }]);
    expect(r.succeeded).toHaveLength(1);
    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert).toBeDefined();
    // VALUES order: id, order_id, name, date, date_in, staff, dept, status, cowork, raw
    expect(insert!.values[8]).toBe(JSON.stringify(['aor', 'kik']));
    expect(JSON.parse(insert!.values[9] as string)).toMatchObject({ cowork: ['aor', 'kik'] });
  });

  it('clears cowork (null) when newJob.cowork is omitted (forward)', async () => {
    queueResult({ rows: [{ id: 101 }], rowCount: 1 });
    queueResult({ rows: [{ id: 201 }], rowCount: 1 });
    queueResult({ rowCount: 1 });
    await bulkForwardInPostgres([{
      oldId: 101,
      newJob: { id: 201, name: 'j', staff: 'mo', dept: 'print' },
    }]);
    const insert = findCallContaining('INSERT INTO jobs');
    expect(insert!.values[8]).toBeNull();
    // raw snapshot carries no cowork key when none was passed
    expect(JSON.parse(insert!.values[9] as string)).not.toHaveProperty('cowork');
  });
});

describe('ID-collision guard — post-insert read-back (§6/R5)', () => {
  beforeEach(() => resetMockPostgres());

  it('createOrder throws when the order INSERT is swallowed by a colliding row', async () => {
    queueResult({ rows: [], rowCount: 0 });                  // INSERT...RETURNING empty = conflict
    queueResult({ rows: [{ name: 'a different order' }] });  // read-back → name mismatch
    await expect(
      createOrderInPostgres({ orderId: 202605070, order: { name: 'Brochure 1000' } }),
    ).rejects.toThrow(/ID collision on order 202605070/);
  });

  it('createOrder tolerates a colliding row that is identical (idempotent retry)', async () => {
    queueResult({ rows: [], rowCount: 0 });                  // INSERT...RETURNING empty = conflict
    queueResult({ rows: [{ name: 'Brochure 1000' }] });      // read-back → name matches
    const r = await createOrderInPostgres({ orderId: 202605070, order: { name: 'Brochure 1000' } });
    expect(r).toEqual({ ok: true, orderId: 202605070, jobId: null });
  });

  it('promoteDraft throws when the minted job ID collides with a different job', async () => {
    queueResult({ rows: [{ id: 202605061 }], rowCount: 1 });               // gate: flip won
    queueResult({ rows: [], rowCount: 0 });                                // job INSERT → conflict
    queueResult({ rows: [{ name: 'someone elses job', order_id: 999 }] }); // read-back → mismatch
    queueResult({ rowCount: 1 });                                          // compensating un-flip
    await expect(
      promoteDraftInPostgres({
        orderId: 202605061, jobId: 510,
        job: { name: 'order-X', dept: 'graphic', staff: 'aor' },
      }),
    ).rejects.toThrow(/ID collision on job 510/);
    // Gate-first means the flip already happened — collision must un-flip
    // so the draft isn't silently promoted with no job.
    const unflip = callsContaining('UPDATE orders').find((c) => c.text.includes("'draft'"));
    expect(unflip, 'must compensate the flip on collision').toBeDefined();
  });

  it('bulkForward routes a colliding new-job ID to failed[] and revives the old job (compensation)', async () => {
    queueResult({ rows: [{ id: 200 }], rowCount: 1 });           // gate: old job tombstoned
    queueResult({ rows: [], rowCount: 0 });                      // new job INSERT → conflict
    queueResult({ rows: [{ name: 'unrelated', order_id: 7 }] }); // read-back → mismatch
    queueResult({ rowCount: 1 });                                // compensating un-tombstone
    const r = await bulkForwardInPostgres([
      { oldId: 200, newJob: { id: 700, name: 'fwd', dept: 'post', staff: 'top', orderId: 202605061 } },
    ]);
    expect(r.succeeded).toHaveLength(0);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/ID collision on job 700/);
    // a failed forward must leave the board unchanged — the gate-first order
    // means the old job WAS tombstoned, so compensation must revive it.
    expect(findCallContaining('phase2_deleted_at = NULL'), 'must revive old job after collision').toBeDefined();
  });
});
