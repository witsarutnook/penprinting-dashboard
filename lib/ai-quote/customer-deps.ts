// lib/ai-quote/customer-deps.ts — shared CustomerAiDeps wiring for the chat
// webhook routes (LINE + Messenger). Extracted 2026-07-13 (follow-up from the
// HINT-1 quality review): the two route-local builders were ~90% identical.
// The channel picks the session scope + rate-limit key; callers inject only
// what genuinely differs — hint-flag composition and profile-aware session
// creation.
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import type { CustomerAiDeps } from './webhook-router';
import { runQuoteTurn, sanitizeHistory } from './run';
import { runComputeQuote } from './tools';
import { buildCustomerSystemPrompt } from './prompt-customer';
import { buildEscalationFlex } from './escalation-flex';
import { loadSession, saveConversation, saveQuote, countQuotes, loadLastQuote, updateLead } from './db';
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed, staffActive, recordStaffReply } from './line-mode';
import { pushLine } from './channels/line';
import { checkRateLimit } from '@/lib/rate-limit';

export type CustomerChannel = 'line' | 'messenger';

// Same engine decision as the staff route (2026-07-02): Sonnet 5 quote engine,
// Haiku stays on the slip-vision gate. See app/api/ai-quote/route.ts.
const MODEL = 'claude-sonnet-5';
const AI_RATE_LIMIT = { limit: 30, windowSec: 3600 };   // spec §6 / 1c §2 — per channel user id

/** Rate-limit key per channel user. The prefixes are live counter state in the
 *  KV store — changing one silently resets that channel's counters (pinned by
 *  test). 'msgr' is historical, not a typo to fix. */
export function rateLimitKey(channel: CustomerChannel, uid: string): string {
  return channel === 'line' ? `ai-quote-line:${uid}` : `ai-quote-msgr:${uid}`;
}

/** Pure hint-flag composition (LINE). Permanently off in prod by HINT-1 D2 —
 *  OA Manager replies have no webhook, so staff activity is undetectable and
 *  the rich menu is the entry point — but the flag still gates the code path. */
export function lineHintEnabled(flag: string | undefined): boolean {
  return flag === 'true';
}

/** Pure hint-flag composition (Messenger). HINT-1 fail-closed: no FB_APP_ID =
 *  echoes can't be classified = the staff-suppression signal doesn't exist →
 *  hint must stay off regardless of the flag. */
export function messengerHintEnabled(flag: string | undefined, fbAppId: string | undefined): boolean {
  return flag === 'true' && !!fbAppId;
}

/** Normalize FB_APP_ID once (HINT-1 I1): a whitespace-padded value would fail
 *  the exact-string echo comparison → our own echoes misclassified as staff →
 *  mode cleared on every bot reply. trim + empty→undefined keeps the fail-safe
 *  intact. */
export function normalizeFbAppId(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined;
}

export function buildCustomerAiDeps(opts: {
  channel: CustomerChannel;
  /** Compose via lineHintEnabled / messengerHintEnabled at the route. */
  hintEnabled: boolean;
  /** Channel-specific: profile fetch + owner-bound session insert. */
  createSessionForUser: CustomerAiDeps['createSessionForUser'];
  anthropic: Anthropic;
  quoteUrl: string;
  quoteToken: string;
}): CustomerAiDeps {
  const { channel, anthropic, quoteUrl, quoteToken } = opts;
  const staffGroupId = process.env.LINE_STAFF_GROUP_ID || null;
  return {
    // mode table (ai_quote_line_modes) is keyed on channel_user_id — PSID rows
    // coexist with LINE userIds (ID spaces disjoint: 'U'+hex vs numeric).
    loadMode: loadLineMode,
    enterMode: enterLineMode,
    touchMode: touchLineMode,
    exitMode: exitLineMode,
    markHintSent,
    modeActive,
    hintAllowed,
    // Live signal on Messenger only — the LINE adapter never emits staff-echo,
    // so last_staff_reply_at stays NULL there and staffActive is never true.
    staffActive,
    recordStaffReply,
    hintEnabled: opts.hintEnabled,
    checkRateLimit: async (uid) => (await checkRateLimit(rateLimitKey(channel, uid), AI_RATE_LIMIT)).ok,
    loadSessionForUser: async (id, uid) => {
      const s = await loadSession(id, { channel, channelUserId: uid });
      return s ? { conversation: s.conversation, customerName: s.customerName } : null;
    },
    createSessionForUser: opts.createSessionForUser,
    saveConversation,
    saveQuote,
    countQuotes,
    loadLastQuote,
    updateLeadStatus: (sessionId, status) => updateLead(sessionId, { leadStatus: status }),
    runTurn: (history, userMessage) =>
      runQuoteTurn(
        // sanitizeHistory caps replayed turns (chat conversations grow every
        // turn); slice(0,4000) mirrors the staff route's message cap (M2).
        { history: sanitizeHistory(history), userMessage: userMessage.slice(0, 4000) },
        { client: anthropic, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildCustomerSystemPrompt(), model: MODEL },
      ),
    buildEscalationFlex,
    // Escalation always pushes to the staff LINE group — even for Messenger
    // leads (spec 1c D3). null = LINE_STAFF_GROUP_ID unset → push skipped (logged).
    pushStaff: staffGroupId ? (message) => pushLine(staffGroupId, message) : null,
  };
}
