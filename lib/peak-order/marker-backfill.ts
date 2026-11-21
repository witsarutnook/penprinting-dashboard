import 'server-only';
import { sql } from '@/lib/postgres';
import { AMBIGUOUS_SQL, APPLY_SQL, CONTROL_SQL, SCAN_MISSING_SQL, UNSEEN_SQL } from '@/lib/peak-order/marker-backfill-sql';

/**
 * One-shot repair (2026-11-21) — data layer of /api/admin/peak/backfill-markers.
 *
 * An order opened by `/order` carries `raw_data.peak` = { code, lineKeys, draftId }
 * (lib/peak-order/mapper.ts). Until 2026-11-21 an edit on the web wrote the form snapshot over
 * raw_data and the marker was gone (#202611104, #202611108). updateOrderInPostgres now keeps
 * it; this puts it back on the orders that already lost it, rebuilt from peak_order_drafts
 * (why that table: lib/peak-order/marker-backfill-sql.ts).
 *
 * Run it only when the deploy that carries the updateOrderInPostgres fix is fully live: an
 * edit that read its row before the repair and writes after it removes the marker again
 * (the second dry run shows it). The repair bumps the orders' updated_at (table trigger).
 *
 * Retire the endpoint, both files and the tests once the repair has run on production and a
 * second dry run answers `nothingLeft: true` — "missing" AND "unseen" both empty, or every row
 * still listed has been looked at by a person (PATTERNS §2.5).
 */

export interface PeakMarkerRepair {
  orderId: number;
  orderName: string;
  orderStatus: string;
  qoCode: string;
  lineKeys: string[];
  draftId: string;
}

export interface MissingPeakMarker extends PeakMarkerRepair {
  /** false = one of the snapshots that take the marker is not a JSON object; the repair skips the order. */
  patchable: boolean;
}

export interface UnseenPeakOrder {
  orderId: number;
  orderName: string;
  orderStatus: string;
  qoCode: string;
  /** How `/order` knows the order: 'link' (a peak_order_links row), 'existing-unit' (a draft unit adopted it). */
  via: string[];
}

export interface PeakMarkerControl {
  /** Orders that still have their marker and that a draft says it created. Must be > 0 before a repair. */
  checked: number;
  /** Of those: the stored marker is not the one the repair would rebuild. Must be empty before a repair. */
  different: Array<{ orderId: number; stored: unknown; rebuilt: unknown }>;
  /** Orders that more than one draft unit claims — the repair leaves them out. */
  ambiguousOrderIds: number[];
}

type Row = Record<string, unknown>;

const text = (v: unknown): string => (v == null ? '' : String(v));

/** A jsonb array of strings; a driver may hand it back as text. */
function keys(v: unknown): string[] {
  let a = v;
  if (typeof a === 'string') {
    try {
      a = JSON.parse(a);
    } catch {
      return [];
    }
  }
  return Array.isArray(a) ? a.filter((k): k is string => typeof k === 'string' && k !== '') : [];
}

const repair = (r: Row): PeakMarkerRepair => ({
  orderId: Number(r.order_id),
  orderName: text(r.name),
  orderStatus: text(r.status),
  qoCode: text(r.qo_code),
  lineKeys: keys(r.line_keys),
  draftId: text(r.draft_id),
});

/** Read-only: every order a draft created that has no marker object, with the marker it would get. */
export async function scanMissingPeakMarkers(): Promise<MissingPeakMarker[]> {
  const { rows } = await sql.query(SCAN_MISSING_SQL);
  return (rows as Row[]).map((r) => ({ ...repair(r), patchable: r.patchable === true }));
}

/**
 * Read-only: orders without a marker that `/order` knows about but the repair cannot rebuild
 * (see UNSEEN_SQL). For a person to look at.
 */
export async function scanUnseenPeakOrders(): Promise<UnseenPeakOrder[]> {
  const { rows } = await sql.query(UNSEEN_SQL);
  return (rows as Row[]).map((r) => ({
    orderId: Number(r.order_id),
    orderName: text(r.name),
    orderStatus: text(r.status),
    qoCode: text(r.qo_code),
    via: Array.isArray(r.via) ? r.via.map((v) => String(v)) : [],
  }));
}

/**
 * Read-only control: the rebuild, checked against the live orders that still have their marker.
 * `different` empty = the way the repair rebuilds a marker gives exactly what is stored.
 */
export async function checkRebuiltPeakMarkers(): Promise<PeakMarkerControl> {
  const control = (await sql.query(CONTROL_SQL)).rows as Row[];
  const ambiguous = (await sql.query(AMBIGUOUS_SQL)).rows as Row[];
  return {
    checked: control.length,
    different: control
      .filter((r) => r.same !== true)
      .map((r) => ({ orderId: Number(r.order_id), stored: r.stored, rebuilt: r.rebuilt })),
    ambiguousOrderIds: ambiguous.map((r) => Number(r.order_id)),
  };
}

/** Put the marker back (one gated statement — see APPLY_SQL). Returns what it restored. */
export async function backfillPeakMarkers(): Promise<PeakMarkerRepair[]> {
  const { rows } = await sql.query(APPLY_SQL);
  return (rows as Row[]).map(repair);
}
