// lib/ai-quote/db.ts
import 'server-only';
import { sql } from '@/lib/postgres';
import type {
  AiQuoteSession, ConversationTurn, LeadStatus, ProductType, QuoteSpec, ComputeResult, LeadRow,
} from './types';

function rowToSession(r: Record<string, unknown>): AiQuoteSession {
  return {
    id: Number(r.id),
    channel: (r.channel as 'dashboard' | 'line') ?? 'dashboard',
    lineUserId: (r.line_user_id as string | null) ?? null,
    conversation: (r.conversation as ConversationTurn[]) ?? [],
    extractedSpec: (r.extracted_spec as QuoteSpec | null) ?? null,
    customerName: (r.customer_name as string | null) ?? null,
    customerContact: (r.customer_contact as string | null) ?? null,
    leadStatus: (r.lead_status as LeadStatus) ?? 'ใหม่',
    assignedTo: (r.assigned_to as string | null) ?? null,
    convertedOrderId: r.converted_order_id == null ? null : Number(r.converted_order_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function createSession(): Promise<AiQuoteSession> {
  const { rows } = await sql`
    INSERT INTO ai_quote_sessions (channel, conversation, lead_status)
    VALUES ('dashboard', '[]'::jsonb, 'ใหม่')
    RETURNING *`;
  return rowToSession(rows[0]);
}

/** Explicit "save as lead" (no-auto-save) — create a session straight to
 *  'กำลังติดตาม' with the full chat + customer info, owned by the saver
 *  (auto-assign — the person who quoted is the natural owner). Quotes are
 *  saved by the caller via saveQuote. Returns the new session id. */
export async function createLead(input: {
  conversation: ConversationTurn[];
  customerName?: string | null;
  customerContact?: string | null;
  assignedTo?: string | null;
}): Promise<number> {
  const { rows } = await sql`
    INSERT INTO ai_quote_sessions (channel, conversation, lead_status, customer_name, customer_contact, assigned_to)
    VALUES ('dashboard', ${JSON.stringify(input.conversation)}::jsonb, 'กำลังติดตาม', ${input.customerName ?? null}, ${input.customerContact ?? null}, ${input.assignedTo ?? null})
    RETURNING id`;
  return Number(rows[0].id);
}

/** Release a lead's owner (set assigned_to NULL → claimable again). When
 *  `onlyOwner` is given, releases only if that user currently holds it (a
 *  non-admin can release their own; admin passes undefined to release any). */
export async function releaseLead(id: number, onlyOwner?: string): Promise<void> {
  if (onlyOwner) {
    await sql`UPDATE ai_quote_sessions SET assigned_to = NULL, updated_at = NOW() WHERE id = ${id} AND assigned_to = ${onlyOwner}`;
  } else {
    await sql`UPDATE ai_quote_sessions SET assigned_to = NULL, updated_at = NOW() WHERE id = ${id}`;
  }
}

/** Load a session by id. Pass `opts.channel` to scope the lookup to a single
 *  channel — the staff chat route passes 'dashboard' so a staff sessionId can
 *  never cross-load a LINE-channel session (and vice-versa). Pass
 *  `opts.lineUserId` (LINE flow) for the full M5 owner-check: the session is
 *  returned only when channel='line' AND the webhook-verified sender owns it —
 *  mismatch → null, indistinguishable from not-found (never leaks existence).
 *  See design-ai-quoting.md §7. */
export async function loadSession(
  id: number,
  opts?: { channel?: 'dashboard' | 'line'; lineUserId?: string },
): Promise<AiQuoteSession | null> {
  const { rows } = opts?.lineUserId
    ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = 'line' AND line_user_id = ${opts.lineUserId}`
    : opts?.channel
      ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = ${opts.channel}`
      : await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  return rows[0] ? rowToSession(rows[0]) : null;
}

/** Replace the conversation history (full array) after a turn. */
export async function saveConversation(id: number, conversation: ConversationTurn[]): Promise<void> {
  await sql`
    UPDATE ai_quote_sessions
       SET conversation = ${JSON.stringify(conversation)}::jsonb, updated_at = NOW()
     WHERE id = ${id}`;
}

/** Persist one compute_quote result. Returns the new ai_quotes.id so the route
 *  can surface a real persisted id on the response (not a transient array
 *  index) — closes the Low "quote id = array index" finding. */
export async function saveQuote(
  sessionId: number, q: { productType: ProductType; spec: QuoteSpec; result: ComputeResult; unitPrice: number },
): Promise<number> {
  const { rows } = await sql`
    INSERT INTO ai_quotes (session_id, product_type, spec, result, unit_price)
    VALUES (${sessionId}, ${q.productType}, ${JSON.stringify(q.spec)}::jsonb, ${JSON.stringify(q.result)}::jsonb, ${q.unitPrice})
    RETURNING id`;
  return Number(rows[0].id);
}

export async function markEscalated(sessionId: number): Promise<void> {
  await sql`UPDATE ai_quote_sessions SET lead_status = 'escalated', updated_at = NOW() WHERE id = ${sessionId} AND lead_status = 'ใหม่'`;
}

export async function listLeads(): Promise<LeadRow[]> {
  const { rows } = await sql`
    SELECT s.*, COALESCE(q.cnt, 0) AS quote_count
      FROM ai_quote_sessions s
      LEFT JOIN (SELECT session_id, COUNT(*) cnt FROM ai_quotes GROUP BY session_id) q ON q.session_id = s.id
     ORDER BY s.updated_at DESC
     LIMIT 200`;
  return rows.map((r) => {
    const s = rowToSession(r);
    const conv = s.conversation;
    return { ...s, quoteCount: Number(r.quote_count) || 0, lastMessage: conv.length ? conv[conv.length - 1].text : null };
  });
}

/** Hard-delete a lead (its ai_quotes rows go too via ON DELETE CASCADE).
 *  Admin-only at the route — used to clear test/junk sessions. */
export async function deleteLead(id: number): Promise<void> {
  await sql`DELETE FROM ai_quote_sessions WHERE id = ${id}`;
}

/** Claim a lead atomically (audit M4). Conditional on `assigned_to IS NULL`
 *  so two staff racing to "หยิบงาน" can't silently overwrite each other —
 *  returns false when someone already holds it (route → 409). */
export async function claimLead(id: number, user: string): Promise<boolean> {
  const { rowCount } = await sql`
    UPDATE ai_quote_sessions
       SET assigned_to = ${user}, updated_at = NOW()
     WHERE id = ${id} AND assigned_to IS NULL`;
  return (rowCount ?? 0) > 0;
}

export async function updateLead(
  id: number, patch: { leadStatus?: LeadStatus; assignedTo?: string | null; customerName?: string | null; customerContact?: string | null },
): Promise<void> {
  // Build a small dynamic update via COALESCE so we only touch provided fields.
  await sql`
    UPDATE ai_quote_sessions SET
      lead_status      = COALESCE(${patch.leadStatus ?? null}, lead_status),
      assigned_to      = COALESCE(${patch.assignedTo ?? null}, assigned_to),
      customer_name    = COALESCE(${patch.customerName ?? null}, customer_name),
      customer_contact = COALESCE(${patch.customerContact ?? null}, customer_contact),
      updated_at       = NOW()
    WHERE id = ${id}`;
}

/** Create a LINE-channel session bound to its webhook-verified owner (M5).
 *  Unlike the dashboard flow (no-auto-save), LINE persists from the first AI
 *  turn — there is no client to hold history between webhook calls, and spec
 *  §6 counts turns/escalations off ai_quote_sessions. */
export async function createLineSession(lineUserId: string, displayName?: string | null): Promise<AiQuoteSession> {
  const { rows } = await sql`
    INSERT INTO ai_quote_sessions (channel, line_user_id, conversation, lead_status, customer_name, customer_contact)
    VALUES ('line', ${lineUserId}, '[]'::jsonb, 'ใหม่', ${displayName ?? null}, 'LINE')
    RETURNING *`;
  return rowToSession(rows[0]);
}

/** Number of persisted quotes in a session — gates trigger ④ (order intent
 *  is only a qualified lead when a price was actually produced). */
export async function countQuotes(sessionId: number): Promise<number> {
  const { rows } = await sql`SELECT COUNT(*)::int AS count FROM ai_quotes WHERE session_id = ${sessionId}`;
  return Number((rows[0] as { count?: number } | undefined)?.count) || 0;
}
