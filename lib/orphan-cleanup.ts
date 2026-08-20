import { sql } from '@/lib/postgres';

/**
 * DATA-orphan-cancelled ×4 — cancelled rows whose parent order no longer
 * exists anywhere (AUDIT-BACKLOG, integrity scans 2026-05-15 / 2026-05-22;
 * imported into Postgres with the 2026-05-18 migration; decision to delete
 * all 4: คุณนุ๊ก 2026-08-20).
 *
 * Data layer for /api/admin/cleanup-orphan-cancelled. The target list is
 * pinned — this is a one-shot cleanup for these specific rows, not a
 * general orphan reaper (a general one would need its own review of what
 * "orphan" means across archive windows).
 */
export const ORPHAN_CANCELLED_TARGETS: readonly number[] = [
  202604024, // "ใบปลิวสาขา" — cancelled 04/2026, reason "แก้"
  202604068, // "สสส" — cancelled 04/2026, reason "ยกเลิก"
  202605039, // "test" — cascade-deleted order, test data
  202605055, // "หหหห" — reason "ทดลอง", test data
];

export interface OrphanCancelledScanRow {
  cancelledRowId: number;
  orderId: number;
  name: string;
  parentOrderExists: boolean;
  deletable: boolean;
}

export interface OrphanCancelledDeletedRow {
  cancelledRowId: number;
  orderId: number;
  name: string;
}

/** Array bind for `= ANY(${...}::bigint[])` — same convention as
 *  postgres-write.ts bulk gates. */
const TARGETS = [...ORPHAN_CANCELLED_TARGETS] as unknown as string;

/** Read-only report: each cancelled row matching a target orderId, with a
 *  live parent-existence check. `deletable: false` means the parent order
 *  exists (e.g. was re-created since the scan) and the row must be kept. */
export async function scanOrphanCancelled(): Promise<OrphanCancelledScanRow[]> {
  const r = await sql<{
    id: number | string;
    order_id: string;
    name: string | null;
    parent_exists: boolean;
  }>`
    SELECT c.id, c.order_id::text AS order_id,
           c.raw->>'name' AS name,
           EXISTS (SELECT 1 FROM orders o WHERE o.id = c.order_id) AS parent_exists
    FROM cancelled c
    WHERE c.order_id = ANY(${TARGETS}::bigint[])
    ORDER BY c.order_id
  `;
  return r.rows.map((row) => ({
    cancelledRowId: Number(row.id),
    orderId: Number(row.order_id),
    name: row.name ?? '',
    parentOrderExists: row.parent_exists,
    deletable: !row.parent_exists,
  }));
}

/** Delete the orphaned rows in ONE conditional-gated statement — the
 *  NOT EXISTS precondition lives inside the DELETE's WHERE (+ RETURNING for
 *  evidence), so there is no read-then-delete window where a concurrently
 *  restored parent order could still lose its cancelled row. Idempotent:
 *  a re-run matches nothing and returns []. */
export async function deleteOrphanCancelled(): Promise<OrphanCancelledDeletedRow[]> {
  const r = await sql<{ id: number | string; order_id: string; name: string | null }>`
    DELETE FROM cancelled c
    WHERE c.order_id = ANY(${TARGETS}::bigint[])
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = c.order_id)
    RETURNING c.id, c.order_id::text AS order_id, c.raw->>'name' AS name
  `;
  return r.rows.map((row) => ({
    cancelledRowId: Number(row.id),
    orderId: Number(row.order_id),
    name: row.name ?? '',
  }));
}
