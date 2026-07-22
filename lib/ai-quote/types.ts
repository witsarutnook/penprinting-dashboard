// lib/ai-quote/types.ts
// Shared shapes for the AI Quote Assistant (Phase 1a).
// Box/bag are recognised by the model but NOT quoted (escalate) — see D8.
// namecard added 2026-07-13 (fix rate/box on the calc API).

export type ProductType = 'brochure' | 'book' | 'notebook' | 'namecard';

/** Loose spec — the calc /api/quote endpoint is the source of truth for
 *  validation (returns 422 with issues on a bad spec). We forward as-is. */
export type QuoteSpec = Record<string, unknown>;

/** The `result` object calc returns. We only read these fields for display;
 *  keep the rest as unknown so calc can evolve without breaking us. */
export interface ComputeResult {
  mode?: string;          // brochure: 'offset' | 'digital'
  unitPrice: number;      // ฿/piece, before VAT — the number we show (D4)
  unitPriceVat?: number;
  totalPrice?: number;
  totalPriceVat?: number;
  [k: string]: unknown;
}

export type LeadStatus =
  | 'ใหม่' | 'กำลังติดตาม' | 'ปิดการขาย' | 'ไม่สนใจ' | 'escalated' | 'abandoned';

/** One persisted quote line (output of a compute_quote call). */
export interface AiQuote {
  id: number;
  sessionId: number;
  productType: ProductType;
  spec: QuoteSpec;
  result: ComputeResult;
  unitPrice: number;
  createdAt: string;
}

/** A conversation turn as stored in ai_quote_sessions.conversation (jsonb). */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  /** ISO time the turn was created (quote-logs 2026-07-20). Optional —
   *  turns persisted before the feature have none; UI shows order only. */
  ts?: string;
}

export interface AiQuoteSession {
  id: number;
  channel: 'dashboard' | 'line' | 'messenger';
  /** Channel-scoped owner binding (M5) — LINE userId หรือ Messenger PSID;
   *  non-null เฉพาะ chat channels. ชื่อ column `line_user_id` เป็น historical
   *  (1b-B) — ไม่ rename กลางอากาศ (spec 1c §2). */
  lineUserId: string | null;
  conversation: ConversationTurn[];
  extractedSpec: QuoteSpec | null;
  customerName: string | null;
  customerContact: string | null;
  leadStatus: LeadStatus;
  assignedTo: string | null;
  convertedOrderId: number | null;
  createdAt: string;
  updatedAt: string;
}

/** A lead row for the /quote-leads table — a session plus derived counts.
 *  Defined here (not db.ts) so the client table can import the type without
 *  pulling in the `server-only` db module. Slim by design
 *  (L-listleads-eager-conversation): the transcript never rides the list —
 *  lastMessage/turnCount are SQL-derived and the full conversation
 *  lazy-fetches per lead via GET /api/ai-quote/leads/[id] on expand. */
export interface LeadRow extends Omit<AiQuoteSession, 'conversation'> {
  quoteCount: number;
  lastMessage: string | null;
  /** jsonb_array_length(conversation) — drives the expand arrow without
   *  shipping the turns. */
  turnCount: number;
}

/** POST /api/ai-quote request + response.
 *  Chat is stateless: the client owns the conversation and replays it each
 *  turn via `history`. Nothing is persisted until the model escalates (auto-
 *  saved as a lead) or staff explicitly saves (POST /api/ai-quote/leads) —
 *  so plain quote chats never pile up as junk leads. Once a session exists
 *  (escalation/save) the client passes its `sessionId` and the server keeps
 *  it in sync. */
export interface AiQuoteRequest {
  sessionId?: number | null;       // set once a session exists; else omit
  history?: ConversationTurn[];    // prior turns (used when no sessionId yet)
  message: string;
}
export interface AiQuoteResponse {
  sessionId: number | null; // non-null once persisted (escalation/existing)
  reply: string;            // assistant text for the staff to read/copy
  quotes: AiQuote[];        // any compute_quote results produced this turn
  escalated: boolean;       // true if the model signalled an escalation
}

/** POST /api/ai-quote/leads — explicit "save as lead" (no-auto-save). */
export interface SaveLeadRequest {
  conversation: ConversationTurn[];
  quotes?: { productType: ProductType; spec: QuoteSpec; result: ComputeResult; unitPrice: number }[];
  customerName?: string;
  customerContact?: string;
}
