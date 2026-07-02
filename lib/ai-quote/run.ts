// lib/ai-quote/run.ts
import type Anthropic from '@anthropic-ai/sdk';
import type { ConversationTurn, ProductType, QuoteSpec, ComputeResult } from './types';
import { COMPUTE_QUOTE_TOOL, type ComputeQuoteInput, type ComputeQuoteOutcome } from './tools';

const MAX_TOOL_ROUNDS = 6;     // safety cap on the agentic loop
// Replies are short, but Sonnet 5 runs adaptive thinking by default (thinking
// is unset below) and those thinking tokens count against max_tokens. 2048 risked
// truncating mid-thought → an empty text turn → the retry fallback. 4096 leaves
// room for thinking + a tool call + the reply; still well under the streaming
// threshold. (Haiku 4.5, which doesn't think by default, was fine at 2048.)
const MAX_TOKENS = 4096;

export interface RunQuoteTurnInput {
  history: ConversationTurn[]; // prior turns (user/assistant text)
  userMessage: string;
}
export interface RunQuoteTurnDeps {
  client: Anthropic;
  compute: (input: ComputeQuoteInput) => Promise<ComputeQuoteOutcome>;
  systemPrompt: string;
  model: string;
}
export interface ProducedQuote {
  productType: ProductType;
  spec: QuoteSpec;
  result: ComputeResult;
  unitPrice: number;
}
export interface RunQuoteTurnOutput {
  reply: string;
  quotes: ProducedQuote[];
  escalated: boolean;              // model handed off (no quote + handoff wording)
  newHistory: ConversationTurn[];  // history + this user turn + this assistant turn
}

/** No-auto-save rule: a turn is persisted ONLY when a session already exists
 *  (escalation/explicit save earlier) or the model escalated this turn (must
 *  not lose a hand-off). Plain quote chats stay unsaved until staff saves. */
export function shouldPersistTurn(hasSession: boolean, escalated: boolean): boolean {
  return hasSession || escalated;
}

/** Clamp a client-supplied conversation to safe bounds before replaying it to
 *  the model (the client owns history now — don't trust its size/shape). Keeps
 *  the last MAX turns, drops malformed entries, caps each text. */
export function sanitizeHistory(input: unknown, maxTurns = 40, maxLen = 4000): ConversationTurn[] {
  if (!Array.isArray(input)) return [];
  const turns: ConversationTurn[] = [];
  for (const t of input) {
    if (!t || typeof t !== 'object') continue;
    const { role, text } = t as { role?: unknown; text?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) continue;
    turns.push({ role, text: text.slice(0, maxLen) });
  }
  return turns.slice(-maxTurns);
}

/** Did this turn escalate to the sales team rather than quote? Heuristic:
 *  no compute_quote succeeded AND the reply uses handoff wording. Pure +
 *  exported so the route can wire the lead-status badge off one source of
 *  truth (audit M3) and tests can pin the trigger. */
export function detectEscalation(quoteCount: number, reply: string): boolean {
  return quoteCount === 0 && /ทีมงาน|ประเมินราคา/.test(reply);
}

/** Map our stored history to Anthropic message params (text-only turns). */
function toMessages(history: ConversationTurn[], userMessage: string): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.text }));
  msgs.push({ role: 'user', content: userMessage });
  return msgs;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
}

export async function runQuoteTurn(
  input: RunQuoteTurnInput,
  deps: RunQuoteTurnDeps,
): Promise<RunQuoteTurnOutput> {
  const { client, compute, systemPrompt, model } = deps;
  const messages = toMessages(input.history, input.userMessage);
  const quotes: ProducedQuote[] = [];
  let replyText = '';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      // Cache the big stable system block (verify cache_read_input_tokens > 0).
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools: [COMPUTE_QUOTE_TOOL as Anthropic.Tool],
      messages,
    });

    // Capture any text the model produced this round.
    const roundText = textOf(res.content);
    if (roundText) replyText = roundText;

    if (res.stop_reason !== 'tool_use') break;

    // Execute each compute_quote call, append assistant turn + tool_result user turn.
    messages.push({ role: 'assistant', content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use' || block.name !== 'compute_quote') continue;
      const inp = block.input as ComputeQuoteInput;
      const outcome = await compute(inp);   // throws on 401/500 → caller maps to 502
      if (outcome.ok) {
        quotes.push({ productType: outcome.productType, spec: outcome.spec, result: outcome.result, unitPrice: outcome.result.unitPrice });
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(outcome.result) });
      } else {
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, is_error: true, content: outcome.message });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // Never persist an empty assistant turn: the Anthropic API rejects empty
  // text content blocks, so an empty turn in history would 400 every later
  // message and brick the whole session. Fall back to a retry prompt if the
  // loop ended without text (MAX_TOOL_ROUNDS hit while still tool_use, or a
  // tool-use-only / max_tokens stop with no text block).
  const reply = replyText.trim() || 'ขออภัยค่ะ ระบบยังประมวลผลคำขอไม่เสร็จ — รบกวนพิมพ์คำขออีกครั้งนะคะ';

  const newHistory: ConversationTurn[] = [
    ...input.history,
    { role: 'user', text: input.userMessage },
    { role: 'assistant', text: reply },
  ];
  return { reply, quotes, escalated: detectEscalation(quotes.length, reply), newHistory };
}
