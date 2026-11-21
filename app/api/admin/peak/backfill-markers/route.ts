import 'server-only';
import { NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { appendAuditToPostgres } from '@/lib/postgres-write';
import { bustLoadAllCache } from '@/lib/revalidate';
import {
  backfillPeakMarkers,
  checkRebuiltPeakMarkers,
  scanMissingPeakMarkers,
  scanUnseenPeakOrders,
  type PeakMarkerControl,
} from '@/lib/peak-order/marker-backfill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * One-shot repair (2026-11-21): give orders opened by `/order` their Peak marker back after a
 * web edit removed it (see lib/peak-order/marker-backfill.ts). Admin only.
 *
 *   GET  → dry run: what would be restored / skipped, what a person must look at ("unseen":
 *          orders /order knows about that the repair cannot rebuild), and the control (do the
 *          markers that are still stored equal the ones the repair would rebuild?)
 *   POST → refuses (409) unless the control checked at least one order and found no
 *          difference; then restores (one gated statement), writes one audit row, busts the cache
 *
 * POST, not GET?apply=1: a GET with a SameSite=Lax cookie can be triggered by a link (PATTERNS §2.5).
 * Idempotent — a second POST restores nothing. Retire after it has run on production.
 */
function refuse(): NextResponse | null {
  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }
  return null;
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The rebuild is proven on this data: it was checked against at least one stored marker, and none differed. */
const proven = (control: PeakMarkerControl): boolean => control.checked > 0 && control.different.length === 0;

export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const no = refuse();
  if (no) return no;

  try {
    const missing = await scanMissingPeakMarkers();
    const unseen = await scanUnseenPeakOrders();
    const control = await checkRebuiltPeakMarkers();
    const patchableCount = missing.filter((r) => r.patchable).length;
    return NextResponse.json({
      mode: 'dryRun',
      hint: 'POST to this URL to restore the patchable rows (refused unless safeToApply)',
      missing,
      patchableCount,
      skippedCount: missing.length - patchableCount,
      unseen,
      control,
      safeToApply: proven(control),
      // No order without a marker in any list. "missing" empty alone is not enough.
      nothingLeft: missing.length === 0 && unseen.length === 0,
    });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}

export async function POST() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const no = refuse();
  if (no) return no;

  try {
    // The rebuild must reproduce every marker that is still stored before it may write one.
    const control = await checkRebuiltPeakMarkers();
    if (!proven(control)) {
      const error =
        control.checked === 0
          ? 'no stored marker to check the rebuild against — nothing was changed'
          : 'rebuilt markers differ from stored ones — nothing was changed';
      return NextResponse.json({ error, control }, { status: 409 });
    }

    const restored = await backfillPeakMarkers();
    if (restored.length > 0) {
      await appendAuditToPostgres({
        role: session.role,
        user: session.user,
        action: 'backfillPeakMarkers',
        summary: `คืนเครื่องหมาย Peak ให้ใบสั่งงาน ×${restored.length} (${restored
          .map((r) => `#${r.orderId} ← ${r.qoCode}`)
          .join(', ')}) — หายตอนแก้ไขใบผ่านเว็บ`,
      });
      bustLoadAllCache();
    }
    return NextResponse.json({
      mode: 'apply',
      restoredCount: restored.length,
      restored,
      control,
      note: 'GET this URL again — "missing" should hold only rows that cannot be patched.',
    });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
