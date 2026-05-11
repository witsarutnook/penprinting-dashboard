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
