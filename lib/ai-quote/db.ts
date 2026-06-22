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

export async function loadSession(id: number): Promise<AiQuoteSession | null> {
  const { rows } = await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  return rows[0] ? rowToSession(rows[0]) : null;
}

/** Replace the conversation history (full array) after a turn. */
export async function saveConversation(id: number, conversation: ConversationTurn[]): Promise<void> {
  await sql`
    UPDATE ai_quote_sessions
       SET conversation = ${JSON.stringify(conversation)}::jsonb, updated_at = NOW()
     WHERE id = ${id}`;
}

export async function saveQuote(
  sessionId: number, q: { productType: ProductType; spec: QuoteSpec; result: ComputeResult; unitPrice: number },
): Promise<void> {
  await sql`
    INSERT INTO ai_quotes (session_id, product_type, spec, result, unit_price)
    VALUES (${sessionId}, ${q.productType}, ${JSON.stringify(q.spec)}::jsonb, ${JSON.stringify(q.result)}::jsonb, ${q.unitPrice})`;
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
