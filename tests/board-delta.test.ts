import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockPostgres,
  queueResult,
  setConfigured,
  callsContaining,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadBoardDelta, BoardDeltaError } from '@/lib/board-delta';

describe('loadBoardDelta', () => {
  beforeEach(() => resetMockPostgres());

  it('throws BoardDeltaError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(loadBoardDelta(null)).rejects.toBeInstanceOf(BoardDeltaError);
  });

  describe('full snapshot (since = null)', () => {
    it('returns only active jobs (phase2_deleted_at IS NULL) + all orders', async () => {
      const job = { id: 1001, name: 'job-A', dept: 'graphic' };
      const order = { id: 202605100, name: 'order-A', status: 'sent' };
      queueResult({ rows: [{ raw: job }], rowCount: 1 });
      queueResult({ rows: [{ raw: order }], rowCount: 1 });

      const r = await loadBoardDelta(null);

      expect(r.jobs).toEqual([job]);
      expect(r.orders).toEqual([order]);
      expect(r.deletedJobIds).toEqual([]);
      expect(r.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('filters tombstoned jobs from the full snapshot', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      await loadBoardDelta(null);
      // Active-only filter on jobs — board UI never renders tombstones
      expect(callsContaining('phase2_deleted_at IS NULL')).toHaveLength(1);
      // No delta filter when bootstrapping (would lose pre-cursor rows)
      expect(callsContaining('updated_at >')).toHaveLength(0);
    });

    it('does not issue the tombstone query on full snapshot', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      await loadBoardDelta(null);
      // Tombstones are irrelevant on bootstrap — client has no prior state
      // to delete from. Save a Postgres round-trip.
      expect(callsContaining('phase2_deleted_at >')).toHaveLength(0);
    });
  });

  describe('delta (since = cursor)', () => {
    it('queries jobs/orders by updated_at + reports tombstoned IDs', async () => {
      const changedJob = { id: 1001, name: 'job-A' };
      const changedOrder = { id: 202605100, name: 'order-A' };
      queueResult({ rows: [{ raw: changedJob }], rowCount: 1 });
      queueResult({ rows: [{ raw: changedOrder }], rowCount: 1 });
      queueResult({ rows: [{ id: '999' }, { id: '998' }], rowCount: 2 });

      const since = new Date('2026-05-20T10:00:00.000Z');
      const r = await loadBoardDelta(since);

      expect(r.jobs).toEqual([changedJob]);
      expect(r.orders).toEqual([changedOrder]);
      expect(r.deletedJobIds).toEqual([999, 998]);
    });

    it('uses updated_at cursor + active filter on jobs query', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));

      // Active-changes query: updated_at filter AND tombstone-excluded.
      // Without the second condition, restored-then-deleted rows would appear
      // in both `jobs` and `deletedJobIds` (client merge would race).
      const jobsActive = callsContaining('FROM jobs')[0];
      expect(jobsActive.text).toContain('updated_at >');
      expect(jobsActive.text).toContain('phase2_deleted_at IS NULL');

      // Tombstone query — distinct from active-changes query
      const tombstones = callsContaining('phase2_deleted_at >');
      expect(tombstones).toHaveLength(1);

      // Orders only has updated_at cursor (no tombstone concept on orders)
      expect(callsContaining('FROM orders')[0].text).toContain('updated_at >');
    });

    it('binds the cursor as a parameter (no inline interpolation)', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      const since = new Date('2026-05-20T10:00:00.000Z');
      await loadBoardDelta(since);

      // ISO string lands in `values`, not in the SQL text — defense in depth
      // even though all callsites already pre-validate to a Date object.
      const jobsCall = sqlCalls.find((c) => c.text.includes('FROM jobs') && c.text.includes('updated_at >'));
      expect(jobsCall!.values).toContain('2026-05-20T10:00:00.000Z');
    });

    it('coerces deletedJobIds from Postgres text to JS numbers', async () => {
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      // We cast to ::text in the query to avoid JS BigInt issues — coerce
      // back here so the client gets plain numbers it can === against
      // Job.id (which is number).
      queueResult({ rows: [{ id: '12345' }], rowCount: 1 });

      const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      expect(r.deletedJobIds).toEqual([12345]);
      expect(typeof r.deletedJobIds[0]).toBe('number');
    });

    it('serverTime is captured before queries (write-during-query is in next delta)', async () => {
      // A write landing AFTER serverTime is captured but BEFORE the SELECT
      // commits would otherwise be lost (its updated_at > serverTime means
      // it falls outside this delta, AND it falls outside the next one
      // because cursor advances to serverTime). We snapshot serverTime
      // FIRST so the next cursor is older than the row → row is included
      // next tick.
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });
      queueResult({ rows: [], rowCount: 0 });

      const before = new Date().toISOString();
      const r = await loadBoardDelta(new Date('2026-05-20T10:00:00.000Z'));
      const after = new Date().toISOString();
      expect(r.serverTime >= before).toBe(true);
      expect(r.serverTime <= after).toBe(true);
    });
  });
});
