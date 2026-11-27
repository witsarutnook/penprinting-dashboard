import 'server-only';
import { randomInt } from 'node:crypto';
import { sql } from '@/lib/postgres';
import { ISSUE_SQL, SCAN_SQL } from './order-pin-reissue-sql';

/**
 * One-shot repair (2026-11-27, audit H1-board-edit-wipes-pin): an edit from a board card wrote
 * pin "" over the order's PIN, and the PIN was stored nowhere else. The cause is fixed
 * (lib/postgres-write.ts keeps the stored PIN); this gives the orders that are still in
 * production a new one. Retire with its route and tests after it has run on production.
 */

/** An order that holds no PIN, and whether the reissue would give it one. */
export interface PinlessOrder {
  orderId: number;
  name: string;
  customer: string | null;
  status: string | null;
  dateDue: string | null;
  liveJobs: number;
  shipped: boolean;
  cancelled: boolean;
  eligible: boolean;
}

const textOrNull = (v: unknown): string | null => (v == null ? null : String(v));

/** Dry run: every order without a PIN. Reads only. */
export async function scanPinlessOrders(): Promise<PinlessOrder[]> {
  const { rows } = await sql.query(SCAN_SQL);
  return (rows as Record<string, unknown>[]).map((r) => ({
    orderId: Number(r.id),
    name: String(r.name ?? ''),
    customer: textOrNull(r.customer),
    status: textOrNull(r.status),
    dateDue: textOrNull(r.date_due),
    liveJobs: Number(r.live_jobs) || 0,
    shipped: r.shipped === true,
    cancelled: r.cancelled === true,
    eligible: r.eligible === true,
  }));
}

/** A 4-digit PIN, 1000–9999 — the shape lib/orders-create.ts makes. */
export function newOrderPin(): string {
  return String(randomInt(1000, 10000));
}

/**
 * Gives each of `orderIds` a new PIN — only those the statement still finds eligible (its WHERE
 * is the gate). Returns the ids that got one, ascending. The PINs are not returned: they are
 * read from the order afterwards.
 */
export async function issuePins(orderIds: number[], makePin: () => string = newOrderPin): Promise<number[]> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return [];
  const pairs = ids.map((id) => ({ id, pin: makePin() }));
  const { rows } = await sql.query(ISSUE_SQL, [JSON.stringify(pairs)]);
  return (rows as Array<{ id: unknown }>).map((r) => Number(r.id)).sort((a, b) => a - b);
}
