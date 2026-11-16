import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from '@/lib/postgres';
import type { PeakQuotation } from '@/lib/peak/read';
import type { UnitChoices, UnitPlan } from '@/lib/peak-order/mapper';

/**
 * Postgres access for the /order-from-Peak LINE flow (spec §6.5):
 *   peak_order_staff  — LINE userId → orderer
 *   peak_order_drafts — one row per draft; every tap advances it through a
 *                       conditional gate (advanceDraft) as its first statement
 *   peak_order_links  — (qo_code, line_key) → order: the duplicate guard
 *
 * Invariant: one Peak line ↔ at most one live work order. A link row is live
 * when order_id points at an orders row that is alive, or when order_id IS
 * NULL and claimed_at is younger than 2 minutes (in-flight claim). Anything
 * else is dead and may be taken over by claimLines.
 *
 * An order is alive by the dashboard's own definition of "not cancelled"
 * (lib/order-lock.ts, lib/orders-list.ts): the orders row exists, its status
 * is not 'cancelled', AND no `cancelled` row exists for it (a job cancelled
 * from the board card leaves status 'sent' + a cancelled row).
 *
 * JSONB is written as a string parameter with an explicit ::jsonb cast and read
 * back defensively (the driver may hand back a parsed value or a string).
 * BIGINT order ids come back as strings and are mapped to numbers.
 */

export type DraftStep =
  | 'mode'
  | 'unit'
  | 'graphic'
  | 'press'
  | 'date'
  | 'confirm'
  | 'dup'
  | 'creating'
  | 'done'
  | 'cancelled';

export interface DraftUnit extends UnitPlan {
  choices: Partial<UnitChoices>;
  result?: { kind: 'order' | 'draft' | 'skipped' | 'existing'; orderId?: number; jobId?: number | null; pin?: string };
}

export interface DraftRow {
  id: string;
  groupId: string;
  lineUserId: string;
  orderer: string;
  qoCode: string;
  snapshot: { quotation: PeakQuotation; customerName: string };
  mode: 'single' | 'merged' | 'split' | null;
  units: DraftUnit[];
  unitIdx: number;
  step: DraftStep;
  creatingKind: 'create' | 'draft' | null; // what the in-flight 'creating' step is doing
  lastTouchedAt: string;
}

export interface LiveLink {
  lineKey: string;
  orderId: number | null;
  orderName: string | null;
  orderStatus: string | null;
}

export interface PeakOrderDb {
  getStaff(lineUserId: string): Promise<{ orderer: string } | null>;
  setStaff(lineUserId: string, orderer: string, displayName: string | null): Promise<void>;
  listStaff(): Promise<Array<{ lineUserId: string; orderer: string; displayName: string | null; createdAt: string }>>;
  deleteStaff(lineUserId: string): Promise<void>;
  createDraft(d: Omit<DraftRow, 'lastTouchedAt' | 'creatingKind'>): Promise<void>;
  loadDraft(id: string): Promise<DraftRow | null>;
  /** Conditional gate: succeeds only if the row is still at (from.unitIdx, from.step). null = lost the race / stale tap. */
  advanceDraft(
    id: string,
    from: { unitIdx: number; step: DraftStep },
    to: {
      unitIdx: number;
      step: DraftStep;
      mode?: DraftRow['mode'];
      units?: DraftUnit[];
      creatingKind?: DraftRow['creatingKind'];
    },
  ): Promise<DraftRow | null>;
  /** false if already done/cancelled/creating (or missing). */
  cancelDraft(id: string): Promise<boolean>;
  liveLinks(qoCode: string): Promise<LiveLink[]>;
  /** Codes with ≥ 1 live link. */
  openedCodes(codes: string[]): Promise<Set<string>>;
  /** All-or-nothing. */
  claimLines(qoCode: string, lineKeys: string[], draftId: string, by: string): Promise<boolean>;
  /** Deletes this draft's rows that have no order_id. */
  releaseClaim(qoCode: string, draftId: string): Promise<void>;
  finalizeLinks(qoCode: string, draftId: string, orderId: number): Promise<void>;
  findOrderByPeakMarker(qoCode: string, lineKeys: string[]): Promise<{ id: number; status: string } | null>;
}

// ─── row mapping ───────────────────────────────────────────────────

const DRAFT_STEPS: readonly DraftStep[] = [
  'mode',
  'unit',
  'graphic',
  'press',
  'date',
  'confirm',
  'dup',
  'creating',
  'done',
  'cancelled',
];

function toIso(v: unknown): string {
  if (v === null || v === undefined) return '';
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function parseJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function mapDraft(r: Record<string, unknown>): DraftRow {
  const units = parseJson(r.units);
  const mode = r.mode;
  const kind = r.creating_kind;
  return {
    id: str(r.id),
    groupId: str(r.group_id),
    lineUserId: str(r.line_user_id),
    orderer: str(r.orderer),
    qoCode: str(r.qo_code),
    snapshot: parseJson(r.snapshot) as DraftRow['snapshot'],
    mode: mode === 'single' || mode === 'merged' || mode === 'split' ? mode : null,
    units: Array.isArray(units) ? (units as DraftUnit[]) : [],
    unitIdx: toNum(r.unit_idx) ?? 0,
    step: (DRAFT_STEPS as readonly string[]).includes(str(r.step)) ? (r.step as DraftStep) : 'cancelled',
    creatingKind: kind === 'create' || kind === 'draft' ? kind : null,
    lastTouchedAt: toIso(r.last_touched_at),
  };
}

/** Sorted ascending + de-duplicated: fixed lock order, one row per key. */
const sortedKeysJson = (keys: string[]): string => JSON.stringify([...new Set(keys)].sort());

// ─── implementation ────────────────────────────────────────────────

export const peakOrderDb: PeakOrderDb = {
  async getStaff(lineUserId) {
    const { rows } = await sql`SELECT orderer FROM peak_order_staff WHERE line_user_id = ${lineUserId}`;
    const r = rows[0] as { orderer?: unknown } | undefined;
    return r && typeof r.orderer === 'string' ? { orderer: r.orderer } : null;
  },

  async setStaff(lineUserId, orderer, displayName) {
    await sql`
      INSERT INTO peak_order_staff (line_user_id, orderer, display_name)
      VALUES (${lineUserId}, ${orderer}, ${displayName})
      ON CONFLICT (line_user_id) DO UPDATE SET orderer = EXCLUDED.orderer, display_name = EXCLUDED.display_name`;
  },

  async listStaff() {
    const { rows } = await sql`
      SELECT line_user_id, orderer, display_name, created_at
        FROM peak_order_staff ORDER BY created_at, line_user_id`;
    return (rows as Record<string, unknown>[]).map((r) => ({
      lineUserId: str(r.line_user_id),
      orderer: str(r.orderer),
      displayName: strOrNull(r.display_name),
      createdAt: toIso(r.created_at),
    }));
  },

  async deleteStaff(lineUserId) {
    await sql`DELETE FROM peak_order_staff WHERE line_user_id = ${lineUserId}`;
  },

  async createDraft(d) {
    await sql`
      INSERT INTO peak_order_drafts
        (id, group_id, line_user_id, orderer, qo_code, snapshot, mode, units, unit_idx, step)
      VALUES
        (${d.id}, ${d.groupId}, ${d.lineUserId}, ${d.orderer}, ${d.qoCode},
         ${JSON.stringify(d.snapshot)}::jsonb, ${d.mode}, ${JSON.stringify(d.units)}::jsonb,
         ${d.unitIdx}, ${d.step})`;
  },

  async loadDraft(id) {
    const { rows } = await sql`SELECT * FROM peak_order_drafts WHERE id = ${id}`;
    const r = rows[0] as Record<string, unknown> | undefined;
    return r ? mapDraft(r) : null;
  },

  async advanceDraft(id, from, to) {
    const unitsJson = to.units === undefined ? null : JSON.stringify(to.units);
    // mode / units: omitted → unchanged (COALESCE). creating_kind: always set,
    // so leaving 'creating' without passing one clears it.
    const { rows } = await sql`
      UPDATE peak_order_drafts
         SET step = ${to.step}, unit_idx = ${to.unitIdx}, mode = COALESCE(${to.mode ?? null}, mode),
             units = COALESCE(${unitsJson}::jsonb, units), creating_kind = ${to.creatingKind ?? null},
             last_touched_at = NOW()
       WHERE id = ${id} AND unit_idx = ${from.unitIdx} AND step = ${from.step}
      RETURNING *`;
    const r = rows[0] as Record<string, unknown> | undefined;
    return r ? mapDraft(r) : null;
  },

  async cancelDraft(id) {
    const { rows } = await sql`
      UPDATE peak_order_drafts SET step = 'cancelled', last_touched_at = NOW()
       WHERE id = ${id} AND step NOT IN ('done', 'cancelled', 'creating')
      RETURNING id`;
    return rows.length > 0;
  },

  async liveLinks(qoCode) {
    const { rows } = await sql`
      SELECT l.line_key, l.order_id, o.name AS order_name, o.status AS order_status
        FROM peak_order_links l
        LEFT JOIN orders o ON o.id = l.order_id
       WHERE l.qo_code = ${qoCode}
         AND ((l.order_id IS NULL AND l.claimed_at >= NOW() - INTERVAL '2 minutes')
           OR (l.order_id IS NOT NULL AND o.id IS NOT NULL AND COALESCE(o.status, '') <> 'cancelled'
               AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))
       ORDER BY l.line_key`;
    return (rows as Record<string, unknown>[]).map((r) => ({
      lineKey: str(r.line_key),
      orderId: toNum(r.order_id),
      orderName: strOrNull(r.order_name),
      orderStatus: strOrNull(r.order_status),
    }));
  },

  async openedCodes(codes) {
    if (codes.length === 0) return new Set();
    const { rows } = await sql`
      SELECT DISTINCT l.qo_code
        FROM peak_order_links l
        LEFT JOIN orders o ON o.id = l.order_id
       WHERE l.qo_code IN (SELECT jsonb_array_elements_text(${sortedKeysJson(codes)}::jsonb))
         AND ((l.order_id IS NULL AND l.claimed_at >= NOW() - INTERVAL '2 minutes')
           OR (l.order_id IS NOT NULL AND o.id IS NOT NULL AND COALESCE(o.status, '') <> 'cancelled'
               AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))`;
    return new Set((rows as Record<string, unknown>[]).map((r) => str(r.qo_code)));
  },

  async claimLines(qoCode, lineKeys, draftId, by) {
    // Claiming nothing must never license a create.
    if (lineKeys.length === 0) return false;
    const keysJson = sortedKeysJson(lineKeys);
    const wanted = (JSON.parse(keysJson) as string[]).length;
    const { rows } = await sql`
      INSERT INTO peak_order_links (qo_code, line_key, draft_id, created_by, order_id, claimed_at)
      SELECT ${qoCode}, k, ${draftId}, ${by}, NULL, NOW()
        FROM jsonb_array_elements_text(${keysJson}::jsonb) AS k
      ON CONFLICT (qo_code, line_key) DO UPDATE
         SET draft_id = EXCLUDED.draft_id, created_by = EXCLUDED.created_by, order_id = NULL, claimed_at = NOW()
       WHERE (peak_order_links.order_id IS NULL AND peak_order_links.claimed_at < NOW() - INTERVAL '2 minutes')
          OR (peak_order_links.order_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM orders o WHERE o.id = peak_order_links.order_id AND COALESCE(o.status, '') <> 'cancelled'
                   AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)))
      RETURNING line_key`;
    if (rows.length < wanted) {
      await peakOrderDb.releaseClaim(qoCode, draftId);
      return false;
    }
    return true;
  },

  async releaseClaim(qoCode, draftId) {
    await sql`
      DELETE FROM peak_order_links
       WHERE qo_code = ${qoCode} AND draft_id = ${draftId} AND order_id IS NULL`;
  },

  async finalizeLinks(qoCode, draftId, orderId) {
    // Only still-unlinked rows: a split draft finalizes one unit at a time
    // under the same draftId and must not overwrite earlier units' order ids.
    await sql`
      UPDATE peak_order_links SET order_id = ${orderId}
       WHERE qo_code = ${qoCode} AND draft_id = ${draftId} AND order_id IS NULL`;
  },

  async findOrderByPeakMarker(qoCode, lineKeys) {
    if (lineKeys.length === 0) return null;
    const { rows } = await sql`
      SELECT id, status FROM orders
       WHERE raw_data->'peak'->>'code' = ${qoCode} AND COALESCE(status, '') <> 'cancelled'
         AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = orders.id)
         AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(raw_data->'peak'->'lineKeys') lk
                      WHERE lk IN (SELECT jsonb_array_elements_text(${sortedKeysJson(lineKeys)}::jsonb)))
       ORDER BY id DESC LIMIT 1`;
    const r = rows[0] as Record<string, unknown> | undefined;
    const id = r ? toNum(r.id) : null;
    return r && id !== null ? { id, status: str(r.status) } : null;
  },
};

/** 12 url-safe chars (72 random bits) — goes into postback data. */
export function newDraftId(): string {
  return randomBytes(9).toString('base64url');
}
