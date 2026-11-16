import 'server-only';
import { sql } from '@/lib/postgres';
import { peakOrderDb, type PeakOrderDb } from '@/lib/peak-order/db';

/**
 * Restore guard for work orders opened from a Peak quotation (`/order`).
 *
 * Why it exists: a job cancelled from the board leaves its order with status
 * 'sent' + a `cancelled` row. lib/peak-order/db.ts counts that order as dead,
 * so `/order` may open the same quotation line as a NEW work order. Restoring
 * the old job (`/api/jobs/restore` deletes the `cancelled` row) would then
 * bring the old order back to life next to the new one — two live work orders
 * on one Peak line, the thing the link table exists to prevent.
 *
 * How: before the restore the route takes the order's lines back through the
 * SAME claim the `/order` flow uses (peakOrderDb.claimLines). A restore and
 * an `/order` tap therefore contend on the same link row and exactly one
 * wins — a plain "look, then restore" check would leave a window between the
 * look and the DELETE. After the claim the marker lookup runs, as it does on
 * every `/order` takeover (a live order can exist without a link row when a
 * create died before finalizing).
 *
 *   claim ok → restoreJobInPostgres → settlePeakRestore(claim, true)  (link → order)
 *   claim ok → restore fails        → settlePeakRestore(claim, false) (claim released)
 *   line taken                      → PeakLineTakenError → the route answers 409
 *
 * If the finalize is lost after a successful restore, the claim lapses after
 * 2 minutes and the next `/order` on that line adopts the restored order
 * through its marker — never a second order.
 *
 * Orders without a `raw_data.peak` marker are not touched, and the link
 * tables are only queried for orders that carry one (so this is safe before
 * the peak_order_* tables exist).
 */

export interface PeakMarker {
  code: string;
  lineKeys: string[];
}

/** The order's Peak line(s) belong to another live work order, or to an `/order` claim in flight (`otherOrderId` null). */
export class PeakLineTakenError extends Error {
  constructor(
    readonly qoCode: string,
    readonly otherOrderId: number | null,
  ) {
    super('peak line taken');
    this.name = 'PeakLineTakenError';
  }
}

export interface PeakRestoreClaim {
  qoCode: string;
  claimId: string;
  orderId: number;
}

export interface RestoreGuardDeps {
  readMarker(orderId: number): Promise<PeakMarker | null>;
  db: Pick<PeakOrderDb, 'claimLines' | 'releaseClaim' | 'finalizeLinks' | 'findOrderByPeakMarker' | 'liveLinks'>;
}

/** The `raw_data.peak` marker written by lib/peak-order/mapper.ts, or null. Throws when the read itself fails. */
export async function readPeakMarker(orderId: number): Promise<PeakMarker | null> {
  const { rows } = await sql`SELECT raw_data->'peak' AS peak FROM orders WHERE id = ${orderId} LIMIT 1`;
  let peak: unknown = (rows[0] as Record<string, unknown> | undefined)?.peak;
  if (typeof peak === 'string') {
    try {
      peak = JSON.parse(peak);
    } catch {
      return null;
    }
  }
  if (!peak || typeof peak !== 'object') return null;
  const { code, lineKeys } = peak as { code?: unknown; lineKeys?: unknown };
  if (typeof code !== 'string' || code === '' || !Array.isArray(lineKeys)) return null;
  const keys = lineKeys.filter((k): k is string => typeof k === 'string' && k !== '');
  return keys.length > 0 ? { code, lineKeys: keys } : null;
}

const defaultDeps: RestoreGuardDeps = { readMarker: readPeakMarker, db: peakOrderDb };

/**
 * Take the order's Peak lines back before its cancelled job is restored.
 * null = the order has no Peak marker (nothing to guard).
 * Throws PeakLineTakenError when another live order, or a fresh `/order`
 * claim, holds any of the lines; any other error means the check itself failed.
 */
export async function claimPeakLinesForRestore(
  orderId: number,
  jobId: number,
  by: string,
  deps: RestoreGuardDeps = defaultDeps,
): Promise<PeakRestoreClaim | null> {
  const marker = await deps.readMarker(orderId);
  if (!marker) return null;

  const claimId = `restore:${jobId}`; // draft ids are base64url — no ':' — so this never collides with one
  const claimed = await deps.db.claimLines(marker.code, marker.lineKeys, claimId, by);
  if (!claimed) {
    const holder = (await deps.db.liveLinks(marker.code)).filter((l) => marker.lineKeys.includes(l.lineKey));
    const other = holder.find((l) => l.orderId !== null && l.orderId !== orderId);
    throw new PeakLineTakenError(marker.code, other?.orderId ?? null);
  }

  // Same rule as every /order takeover: a live order may carry the line in
  // its marker without a link row. The order being restored is still dead
  // here (its cancelled row is not deleted yet), so a hit is another order.
  const live = await deps.db.findOrderByPeakMarker(marker.code, marker.lineKeys);
  if (live && live.id !== orderId) {
    await deps.db.releaseClaim(marker.code, claimId);
    throw new PeakLineTakenError(marker.code, live.id);
  }

  return { qoCode: marker.code, claimId, orderId };
}

/** After the restore: point the claimed lines at the order (restored) or give them back (restore failed). */
export async function settlePeakRestore(
  claim: PeakRestoreClaim,
  restored: boolean,
  deps: RestoreGuardDeps = defaultDeps,
): Promise<void> {
  if (restored) await deps.db.finalizeLinks(claim.qoCode, claim.claimId, claim.orderId);
  else await deps.db.releaseClaim(claim.qoCode, claim.claimId);
}

/** The 409 text for the /cancelled page. */
export function peakLineTakenMessage(err: PeakLineTakenError): string {
  if (err.otherOrderId === null) {
    return `กู้คืนไม่ได้ตอนนี้ — มีคนกำลังเปิดงานจากใบเสนอราคา ${err.qoCode} ในกลุ่ม LINE อยู่ · รอ 2 นาทีแล้วลองใหม่`;
  }
  return (
    `กู้คืนไม่ได้ — รายการนี้ของใบเสนอราคา ${err.qoCode} ถูกเปิดเป็นใบสั่งงานใหม่ #${err.otherOrderId} แล้ว · ` +
    `ถ้าต้องการใช้งานเดิม ให้ยกเลิกใบ #${err.otherOrderId} ก่อน แล้วกู้คืนอีกครั้ง`
  );
}
