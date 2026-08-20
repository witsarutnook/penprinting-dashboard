import { NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { appendAuditToPostgres } from '@/lib/postgres-write';
import { bustLoadAllCache } from '@/lib/revalidate';
import {
  ORPHAN_CANCELLED_TARGETS,
  scanOrphanCancelled,
  deleteOrphanCancelled,
} from '@/lib/orphan-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * One-shot cleanup for DATA-orphan-cancelled ×4 (AUDIT-BACKLOG — integrity
 * scans 2026-05-15 / 2026-05-22): cancelled rows referencing orderIds whose
 * parent order no longer exists (202604024 "ใบปลิวสาขา" / 202604068 "สสส" /
 * 202605039 "test" / 202605055 "หหหห"). Imported into Postgres with the
 * 2026-05-18 migration; decision to delete all 4: คุณนุ๊ก 2026-08-20.
 *
 * Same shape as /api/admin/fix-date-anomaly:
 *
 * ── Usage ──
 *   GET  /api/admin/cleanup-orphan-cancelled           → dry run, live report
 *   GET  /api/admin/cleanup-orphan-cancelled?apply=1   → deletes the orphans
 *
 * Safety: the delete is ONE conditional-gated statement — a row is only
 * removed if its parent order does not exist AT DELETE TIME (NOT EXISTS in
 * the DELETE's WHERE). A row whose parent was re-created since the scan is
 * skipped, and the response says so. Idempotent: re-running after a
 * successful apply deletes nothing.
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }

  const url = new URL(req.url);
  const apply = url.searchParams.get('apply') === '1';

  const scan = await scanOrphanCancelled();
  const deletable = scan.filter((r) => r.deletable);
  const kept = scan.filter((r) => !r.deletable);

  if (!apply) {
    return NextResponse.json({
      mode: 'dryRun',
      hint: 'Add ?apply=1 to delete the deletable rows',
      targets: ORPHAN_CANCELLED_TARGETS,
      rows: scan,
      deletableCount: deletable.length,
      keptCount: kept.length,
    });
  }

  const deleted = await deleteOrphanCancelled();
  if (deleted.length > 0) {
    await appendAuditToPostgres({
      role: session.role,
      user: session.user,
      action: 'cleanupOrphanCancelled',
      summary: `ลบ cancelled orphan ×${deleted.length} (${deleted
        .map((d) => `#${d.orderId} "${d.name}"`)
        .join(', ')}) — DATA-orphan-cancelled cleanup`,
    });
    bustLoadAllCache();
  }

  return NextResponse.json({
    mode: 'apply',
    deletedCount: deleted.length,
    deleted,
    kept,
    note: 'Re-run without ?apply=1 — the scan should return 0 rows.',
  });
}
