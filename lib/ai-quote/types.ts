// lib/ai-quote/types.ts
// Shared shapes for the AI Quote Assistant (Phase 1a).
// Box/bag are recognised by the model but NOT quoted in 1a (escalate) — see D8.

export type ProductType = 'brochure' | 'book' | 'notebook';

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
}

export interface AiQuoteSession {
  id: number;
  channel: 'dashboard' | 'line';
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

/** POST /api/ai-quote request + response. */
export interface AiQuoteRequest {
  sessionId?: number;       // omit to start a new session
  message: string;
}
export interface AiQuoteResponse {
  sessionId: number;
  reply: string;            // assistant text for the staff to read/copy
  quotes: AiQuote[];        // any compute_quote results produced this turn
  escalated: boolean;       // true if the model signalled an escalation
}
