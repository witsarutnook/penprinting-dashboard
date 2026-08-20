/**
 * DATA-orphan-cancelled ×4 cleanup (AUDIT-BACKLOG — integrity scans
 * 2026-05-15 / 2026-05-22, decision to delete all 4: คุณนุ๊ก 2026-08-20).
 *
 * Pins for /api/admin/cleanup-orphan-cancelled's data layer
 * (lib/orphan-cleanup.ts):
 *
 *  1. The target list is exactly the 4 orderIds from the scans — widening
 *     this cleanup to other ids must be a conscious edit here.
 *  2. deleteOrphanCancelled is a SINGLE conditional-gated statement
 *     (precondition NOT EXISTS inside the DELETE's WHERE + RETURNING) —
 *     no SELECT-then-DELETE window where a restored parent order could be
 *     orphaned the other way around.
 *  3. A row whose parent order EXISTS is never deletable (scan reports it,
 *     delete's gate skips it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  ORPHAN_CANCELLED_TARGETS,
  scanOrphanCancelled,
  deleteOrphanCancelled,
} from '@/lib/orphan-cleanup';

describe('ORPHAN_CANCELLED_TARGETS', () => {
  it('pins exactly the 4 orphan orderIds from the 2026-05 integrity scans', () => {
    expect([...ORPHAN_CANCELLED_TARGETS]).toEqual([
      202604024, 202604068, 202605039, 202605055,
    ]);
  });
});

describe('scanOrphanCancelled', () => {
  beforeEach(() => resetMockPostgres());

  it('reports each matching cancelled row with a parent-existence flag', async () => {
    queueResult({
      rows: [
        { id: 142, order_id: '202604024', name: 'ใบปลิวสาขา', parent_exists: false },
        { id: 395, order_id: '202605039', name: 'test', parent_exists: true },
      ],
      rowCount: 2,
    });

    const rows = await scanOrphanCancelled();

    expect(rows).toEqual([
      {
        cancelledRowId: 142,
        orderId: 202604024,
        name: 'ใบปลิวสาขา',
        parentOrderExists: false,
        deletable: true,
      },
      {
        cancelledRowId: 395,
        orderId: 202605039,
        name: 'test',
        parentOrderExists: true,
        deletable: false,
      },
    ]);

    // Scan is read-only and scoped to the pinned targets.
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toMatch(/SELECT/i);
    expect(sqlCalls[0].text).not.toMatch(/DELETE/i);
    expect(
      sqlCalls[0].values.some(
        (v) => Array.isArray(v) && v.length === 4 && v.includes(202604024),
      ),
    ).toBe(true);
  });

  it('returns [] when none of the targets remain (post-cleanup idempotency)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await scanOrphanCancelled()).toEqual([]);
  });
});

describe('deleteOrphanCancelled', () => {
  beforeEach(() => resetMockPostgres());

  it('deletes via ONE conditional-gated statement (NOT EXISTS in WHERE + RETURNING)', async () => {
    queueResult({
      rows: [{ id: 142, order_id: '202604024', name: 'ใบปลิวสาขา' }],
      rowCount: 1,
    });

    const deleted = await deleteOrphanCancelled();

    // Single statement — the orphan precondition lives inside the DELETE
    // itself, so a concurrently re-created parent order can never lose its
    // cancelled row to a stale earlier read.
    expect(sqlCalls).toHaveLength(1);
    const call = sqlCalls[0];
    expect(call.text).toMatch(/DELETE FROM cancelled/i);
    expect(call.text).toMatch(/NOT EXISTS/i);
    expect(call.text).toMatch(/RETURNING/i);
    expect(
      call.values.some(
        (v) => Array.isArray(v) && v.length === 4 && v.includes(202605055),
      ),
    ).toBe(true);

    expect(deleted).toEqual([
      { cancelledRowId: 142, orderId: 202604024, name: 'ใบปลิวสาขา' },
    ]);
  });

  it('returns [] on a re-run after a successful apply (idempotent)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await deleteOrphanCancelled()).toEqual([]);
  });
});
