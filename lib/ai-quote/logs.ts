// lib/ai-quote/logs.ts — data layer ของ /quote-logs (read + flag write).
// อ่านอย่างเดียวต่อ conversation — ห้ามมี mutation ของ ai_quote_sessions ในไฟล์นี้.
// List ใช้ single-query aggregate + NULL-param pattern (เดียวกับ slip-metrics).
import 'server-only';
import { sql } from '@/lib/postgres';
import type { ConversationTurn } from './types';

const PAGE_SIZE = 50;

export interface QuoteLogFilters {
  channel?: 'line' | 'messenger' | 'dashboard' | 'customer';
  q?: string;
  flaggedOnly?: boolean;
  status?: string;
  page?: number; // 1-based
}

export interface QuoteLogRow {
  id: number;
  channel: string;
  customerName: string | null;
  customerContact: string | null;
  leadStatus: string;
  turnCount: number;
  quoteCount: number;
  flagCount: number;
  updatedAt: string;
}

/** Session list + aggregates ในคิวรีเดียว. `channel: 'customer'` = line+messenger. */
export async function loadQuoteLogSessions(
  f: QuoteLogFilters,
): Promise<{ rows: QuoteLogRow[]; hasMore: boolean }> {
  const channels =
    f.channel === 'customer' ? ['line', 'messenger'] : f.channel ? [f.channel] : null;
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const status = f.status?.trim() || null;
  const flaggedOnly = f.flaggedOnly === true;
  const offset = (Math.max(1, f.page ?? 1) - 1) * PAGE_SIZE;
  const { rows } = await sql`
    SELECT s.id, s.channel, s.customer_name, s.customer_contact, s.lead_status,
           jsonb_array_length(s.conversation) AS turn_count,
           (SELECT COUNT(*) FROM ai_quotes aq WHERE aq.session_id = s.id) AS quote_count,
           (SELECT COUNT(*) FROM ai_quote_turn_flags fl WHERE fl.session_id = s.id) AS flag_count,
           s.updated_at
    FROM ai_quote_sessions s
    WHERE (${channels as unknown as string}::text[] IS NULL OR s.channel = ANY(${channels as unknown as string}::text[]))
      AND (${q}::text IS NULL OR s.customer_name ILIKE ${q} OR s.customer_contact ILIKE ${q})
      AND (${flaggedOnly} = false OR EXISTS (SELECT 1 FROM ai_quote_turn_flags fx WHERE fx.session_id = s.id))
      AND (${status}::text IS NULL OR s.lead_status = ${status})
    ORDER BY s.updated_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const page = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: Number(r.id),
    channel: String(r.channel),
    customerName: (r.customer_name as string | null) ?? null,
    customerContact: (r.customer_contact as string | null) ?? null,
    leadStatus: String(r.lead_status ?? 'ใหม่'),
    turnCount: Number(r.turn_count ?? 0),
    quoteCount: Number(r.quote_count ?? 0),
    flagCount: Number(r.flag_count ?? 0),
    updatedAt: String(r.updated_at),
  }));
  return { rows: page, hasMore: rows.length > PAGE_SIZE };
}

export interface QuoteLogQuote {
  id: number;
  productType: string;
  spec: Record<string, unknown>;
  unitPrice: number;
  createdAt: string;
}

export interface TurnFlag {
  id: number;
  sessionId: number;
  turnIndex: number;
  turnRole: string;
  turnText: string;
  note: string | null;
  flaggedBy: string;
  createdAt: string;
}

export interface QuoteLogDetail {
  id: number;
  channel: string;
  customerName: string | null;
  customerContact: string | null;
  leadStatus: string;
  conversation: ConversationTurn[];
  quotes: QuoteLogQuote[];
  flags: TurnFlag[];
  createdAt: string;
  updatedAt: string;
}

export async function loadQuoteLogDetail(id: number): Promise<QuoteLogDetail | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const s = rows[0];
  const { rows: qs } = await sql`
    SELECT id, product_type, spec, unit_price, created_at FROM ai_quotes
    WHERE session_id = ${id} ORDER BY created_at ASC`;
  const { rows: fs } = await sql`
    SELECT * FROM ai_quote_turn_flags WHERE session_id = ${id} ORDER BY turn_index ASC`;
  return {
    id: Number(s.id),
    channel: String(s.channel),
    customerName: (s.customer_name as string | null) ?? null,
    customerContact: (s.customer_contact as string | null) ?? null,
    leadStatus: String(s.lead_status ?? 'ใหม่'),
    conversation: (s.conversation as ConversationTurn[]) ?? [],
    quotes: qs.map((r) => ({
      id: Number(r.id),
      productType: String(r.product_type),
      spec: (r.spec as Record<string, unknown>) ?? {},
      unitPrice: Number(r.unit_price),
      createdAt: String(r.created_at),
    })),
    flags: fs.map(rowToFlag),
    createdAt: String(s.created_at),
    updatedAt: String(s.updated_at),
  };
}

function rowToFlag(r: Record<string, unknown>): TurnFlag {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    turnIndex: Number(r.turn_index),
    turnRole: String(r.turn_role),
    turnText: String(r.turn_text),
    note: (r.note as string | null) ?? null,
    flaggedBy: String(r.flagged_by),
    createdAt: String(r.created_at),
  };
}

/** Worklist — flags ทุก session เรียงใหม่→เก่า พร้อม customer context. */
export async function loadAllFlags(
  page = 1,
): Promise<{ rows: (TurnFlag & { channel: string; customerName: string | null })[]; hasMore: boolean }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const { rows } = await sql`
    SELECT fl.*, s.channel, s.customer_name
    FROM ai_quote_turn_flags fl
    JOIN ai_quote_sessions s ON s.id = fl.session_id
    ORDER BY fl.created_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  return {
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      ...rowToFlag(r),
      channel: String(r.channel),
      customerName: (r.customer_name as string | null) ?? null,
    })),
    hasMore: rows.length > PAGE_SIZE,
  };
}

/** Tag ข้อความ AI ว่าตอบผิด. Snapshot role+text จาก DB ฝั่ง server (ไม่รับจาก
 *  client — กัน mismatch). ON CONFLICT DO NOTHING → 'duplicate'. */
export async function flagTurn(
  sessionId: number,
  turnIndex: number,
  note: string | null,
  flaggedBy: string,
): Promise<'ok' | 'not-found' | 'not-assistant' | 'duplicate'> {
  const { rows } = await sql`SELECT conversation FROM ai_quote_sessions WHERE id = ${sessionId}`;
  if (rows.length === 0) return 'not-found';
  const conv = (rows[0].conversation as ConversationTurn[]) ?? [];
  const turn = conv[turnIndex];
  if (!turn || turn.role !== 'assistant') return 'not-assistant';
  const { rowCount } = await sql`
    INSERT INTO ai_quote_turn_flags (session_id, turn_index, turn_role, turn_text, note, flagged_by)
    VALUES (${sessionId}, ${turnIndex}, ${turn.role}, ${turn.text.slice(0, 1000)}, ${note}, ${flaggedBy})
    ON CONFLICT (session_id, turn_index) DO NOTHING`;
  return (rowCount ?? 0) === 0 ? 'duplicate' : 'ok';
}

export async function unflagTurn(sessionId: number, turnIndex: number): Promise<boolean> {
  const { rowCount } = await sql`
    DELETE FROM ai_quote_turn_flags WHERE session_id = ${sessionId} AND turn_index = ${turnIndex}`;
  return (rowCount ?? 0) > 0;
}

// ── Timeline merge (pure — testable) ─────────────────────────────────
export type TimelineItem =
  | { kind: 'turn'; index: number; turn: ConversationTurn }
  | { kind: 'quote'; quote: QuoteLogQuote };

/** แทรก quote cards ระหว่าง turns ตามเวลา: quote วางหลัง turn ล่าสุด เมื่อเวลา
 *  quote ≤ ts ของ turn ถัดไปที่มีเวลา. Turn ไม่มี ts เลยทั้ง session →
 *  quotes ทั้งหมดต่อท้าย (session เก่าก่อน feature ts). */
export function mergeTimeline(
  turns: ConversationTurn[],
  quotes: QuoteLogQuote[],
): TimelineItem[] {
  const anyTs = turns.some((t) => t.ts);
  const sorted = [...quotes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const items: TimelineItem[] = [];
  let qi = 0;
  turns.forEach((turn, index) => {
    items.push({ kind: 'turn', index, turn });
    if (!anyTs) return;
    const nextTs = nextTurnTs(turns, index);
    while (qi < sorted.length && (nextTs === null || Date.parse(sorted[qi].createdAt) <= nextTs)) {
      items.push({ kind: 'quote', quote: sorted[qi++] });
    }
  });
  for (; qi < sorted.length; qi++) items.push({ kind: 'quote', quote: sorted[qi] });
  return items;
}

function nextTurnTs(turns: ConversationTurn[], from: number): number | null {
  for (let i = from + 1; i < turns.length; i++) {
    const ts = turns[i].ts;
    if (ts) return Date.parse(ts);
  }
  return null;
}
