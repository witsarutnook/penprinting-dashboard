// app/api/ai-quote/line/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildLineAdapter } from '@/lib/ai-quote/channels/line';
import { handleInbound, type HandleDeps, type CustomerAiDeps } from '@/lib/ai-quote/webhook-router';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipFlex } from '@/lib/ai-quote/slip-flex';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { buildOrderFlex } from '@/lib/ai-quote/track-flex';
import { loadOrder } from '@/lib/api';
import { loadActiveJobsByCustomer } from '@/lib/customer-track';
import { loadRegistrationByGroup } from '@/lib/registrations';
import { buildCustomerJobsFlex } from '@/lib/ai-quote/customer-jobs-flex';
import { runQuoteTurn, sanitizeHistory } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';
import { loadSession, createLineSession, saveConversation, saveQuote, countQuotes, loadLastQuote, updateLead } from '@/lib/ai-quote/db';
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed } from '@/lib/ai-quote/line-mode';
import { getLineProfile, pushLine } from '@/lib/ai-quote/channels/line';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';
// Same engine decision as the staff route (2026-07-02): Sonnet 5 quote engine,
// Haiku stays on the slip-vision gate. See app/api/ai-quote/route.ts.
const MODEL = 'claude-sonnet-5';
const AI_RATE_LIMIT = { limit: 30, windowSec: 3600 };   // spec §6 — per line_user_id

function buildCustomerAiDeps(anthropic: Anthropic, quoteUrl: string, quoteToken: string): CustomerAiDeps {
  const staffGroupId = process.env.LINE_STAFF_GROUP_ID || null;
  return {
    loadMode: loadLineMode,
    enterMode: enterLineMode,
    touchMode: touchLineMode,
    exitMode: exitLineMode,
    markHintSent,
    modeActive,
    hintAllowed,
    hintEnabled: process.env.AI_QUOTE_LINE_HINT_ENABLED === 'true',
    checkRateLimit: async (uid) => (await checkRateLimit(`ai-quote-line:${uid}`, AI_RATE_LIMIT)).ok,
    loadSessionForUser: async (id, uid) => {
      const s = await loadSession(id, { lineUserId: uid });
      return s ? { conversation: s.conversation, customerName: s.customerName } : null;
    },
    createSessionForUser: async (uid) => {
      const profile = await getLineProfile(uid);   // best-effort display name
      const s = await createLineSession(uid, profile?.displayName ?? null);
      return { id: s.id, customerName: s.customerName };
    },
    saveConversation,
    saveQuote,
    countQuotes,
    loadLastQuote,
    updateLeadStatus: (sessionId, status) => updateLead(sessionId, { leadStatus: status }),
    runTurn: (history, userMessage) =>
      runQuoteTurn(
        // sanitizeHistory caps replayed turns (LINE conversations grow every
        // turn); slice(0,4000) mirrors the staff route's message cap (M2).
        { history: sanitizeHistory(history), userMessage: userMessage.slice(0, 4000) },
        { client: anthropic, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildCustomerSystemPrompt(), model: MODEL },
      ),
    buildEscalationFlex,
    pushStaff: staffGroupId ? (message) => pushLine(staffGroupId, message) : null,
  };
}

async function blobToBase64(b: Blob): Promise<{ data: string; mediaType: string }> {
  const buf = Buffer.from(await b.arrayBuffer());
  return { data: buf.toString('base64'), mediaType: b.type || 'image/jpeg' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  const rawBody = await req.text();
  const adapter = buildLineAdapter(secret);
  if (!adapter.verifySignature(rawBody, req.headers.get('x-line-signature') ?? '')) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }
  const messages = adapter.parseEvents(body);
  if (messages.length === 0) return NextResponse.json({ ok: true });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // AI arms need the quote backend — flag ON without QUOTE_API env degrades
  // safely to 1b-A behaviour (slip/track only).
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  const aiEnabled = process.env.AI_QUOTE_LINE_ENABLED === 'true' && !!quoteUrl && !!quoteToken;

  // ตอบ 200 ทันที → ทำงานหนัก (Haiku/Thunder/lookup) ใน after() แล้ว reply via API
  after(async () => {
    for (const m of messages) {
      try {
        await handleInbound(m, {
          adapter,
          blobToBase64,
          // isSlipImage: concrete type uses Anthropic, interface uses unknown — safe cast
          isSlipImage: isSlipImage as HandleDeps['isSlipImage'],
          verifyBankSlipImage,
          buildSlipFlex,
          // loadOrder: concrete type returns LoadOrderResponse, interface uses loose type — safe cast (via unknown)
          loadOrder: loadOrder as unknown as HandleDeps['loadOrder'],
          // buildOrderFlex: concrete type uses TrackState|null, interface uses unknown — safe cast
          buildOrderFlex: buildOrderFlex as HandleDeps['buildOrderFlex'],
          // track-customer (group name search) — Postgres-backed; loose casts mirror loadOrder/buildOrderFlex above
          loadRegistrationByGroup: loadRegistrationByGroup as unknown as HandleDeps['loadRegistrationByGroup'],
          loadActiveJobsByCustomer: loadActiveJobsByCustomer as unknown as HandleDeps['loadActiveJobsByCustomer'],
          buildCustomerJobsFlex: buildCustomerJobsFlex as unknown as HandleDeps['buildCustomerJobsFlex'],
          recordSlipCheck,
          anthropic,
          visionModel: VISION_MODEL,
          aiEnabled,
          aiCustomer: aiEnabled ? buildCustomerAiDeps(anthropic, quoteUrl!, quoteToken!) : undefined,
        });
      } catch (err) {
        console.error('[ai-quote/line] handleInbound failed:', err instanceof Error ? err.message : err);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, service: 'penprinting line webhook' });
}
