// app/api/ai-quote/messenger/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMessengerAdapter, getMessengerProfile } from '@/lib/ai-quote/channels/messenger';
import { handleInbound, type HandleDeps, type CustomerAiDeps } from '@/lib/ai-quote/webhook-router';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipMessenger } from '@/lib/ai-quote/slip-messenger';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { runQuoteTurn, sanitizeHistory } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';
import { loadSession, createMessengerSession, saveConversation, saveQuote, countQuotes, loadLastQuote, updateLead } from '@/lib/ai-quote/db';
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed, staffActive, recordStaffReply } from '@/lib/ai-quote/line-mode';
import { pushLine } from '@/lib/ai-quote/channels/line';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';
// Same engine decision as LINE/staff (2026-07-02): Sonnet 5 quote engine,
// Haiku on the slip-vision gate.
const MODEL = 'claude-sonnet-5';
const AI_RATE_LIMIT = { limit: 30, windowSec: 3600 };   // spec 1c §2 — per PSID

// track/groupid ปิดฝั่ง Messenger (spec 1c D1) — deps เหล่านี้ unreachable เมื่อ
// trackEnabled=false; stub-throw กันเรียกพลาดเงียบๆ ถ้า routing เปลี่ยนในอนาคต
function unreachable(name: string): never {
  throw new Error(`[ai-quote/messenger] ${name} unreachable (trackEnabled=false, 2026-07-08)`);
}

function buildCustomerAiDeps(anthropic: Anthropic, quoteUrl: string, quoteToken: string, fbAppId: string | undefined): CustomerAiDeps {
  const staffGroupId = process.env.LINE_STAFF_GROUP_ID || null;
  return {
    // mode table (ai_quote_line_modes) is keyed on channel_user_id — PSID rows
    // coexist with LINE userIds (ID spaces disjoint: 'U'+hex vs numeric)
    loadMode: loadLineMode,
    enterMode: enterLineMode,
    touchMode: touchLineMode,
    exitMode: exitLineMode,
    markHintSent,
    modeActive,
    hintAllowed,
    staffActive,
    recordStaffReply,
    // HINT-1 fail-closed: no FB_APP_ID = echoes can't be classified = the
    // suppression signal doesn't exist → hint must stay off.
    hintEnabled: process.env.AI_QUOTE_MESSENGER_HINT_ENABLED === 'true' && !!fbAppId,
    checkRateLimit: async (uid) => (await checkRateLimit(`ai-quote-msgr:${uid}`, AI_RATE_LIMIT)).ok,
    loadSessionForUser: async (id, uid) => {
      const s = await loadSession(id, { channel: 'messenger', channelUserId: uid });
      return s ? { conversation: s.conversation, customerName: s.customerName } : null;
    },
    createSessionForUser: async (uid) => {
      const profile = await getMessengerProfile(uid);   // best-effort display name
      const s = await createMessengerSession(uid, profile?.displayName ?? null);
      return { id: s.id, customerName: s.customerName };
    },
    saveConversation,
    saveQuote,
    countQuotes,
    loadLastQuote,
    updateLeadStatus: (sessionId, status) => updateLead(sessionId, { leadStatus: status }),
    runTurn: (history, userMessage) =>
      runQuoteTurn(
        { history: sanitizeHistory(history), userMessage: userMessage.slice(0, 4000) },
        { client: anthropic, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildCustomerSystemPrompt(), model: MODEL },
      ),
    buildEscalationFlex,
    // escalation ยัง push เข้ากลุ่ม LINE พนักงานเดิม (spec 1c D3)
    pushStaff: staffGroupId ? (message) => pushLine(staffGroupId, message) : null,
  };
}

async function blobToBase64(b: Blob): Promise<{ data: string; mediaType: string }> {
  const buf = Buffer.from(await b.arrayBuffer());
  return { data: buf.toString('base64'), mediaType: b.type || 'image/jpeg' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  // Trimmed once: a whitespace-padded FB_APP_ID would fail the exact-string
  // echo comparison → our own echoes misclassified as staff → mode cleared on
  // every bot reply. trim + empty→undefined keeps the fail-safe intact.
  const fbAppId = process.env.FB_APP_ID?.trim() || undefined;

  const rawBody = await req.text();
  const adapter = buildMessengerAdapter(appSecret, fbAppId);
  if (!adapter.verifySignature(rawBody, req.headers.get('x-hub-signature-256') ?? '')) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }
  const messages = adapter.parseEvents(body);
  if (messages.length === 0) return NextResponse.json({ ok: true });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // AI arms need the quote backend + Anthropic key — flag ON with any env
  // missing degrades safely to slip-only (mirror LINE route guard).
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  const aiEnabled = process.env.AI_QUOTE_MESSENGER_ENABLED === 'true'
    && !!quoteUrl && !!quoteToken && !!process.env.ANTHROPIC_API_KEY;

  // ตอบ 200 ทันที → งานหนัก (Haiku/Thunder/engine) ใน after() แล้วส่งผ่าน Send API
  after(async () => {
    for (const m of messages) {
      try {
        await handleInbound(m, {
          adapter,
          blobToBase64,
          // isSlipImage: concrete type uses Anthropic, interface uses unknown — safe cast (mirror LINE route)
          isSlipImage: isSlipImage as HandleDeps['isSlipImage'],
          verifyBankSlipImage,
          // Messenger ไม่มี Flex — slip result เป็น text message (spec 1c §3)
          buildSlipFlex: buildSlipMessenger,
          loadOrder: (() => unreachable('loadOrder')) as unknown as HandleDeps['loadOrder'],
          buildOrderFlex: (() => unreachable('buildOrderFlex')) as HandleDeps['buildOrderFlex'],
          loadRegistrationByGroup: (() => unreachable('loadRegistrationByGroup')) as unknown as HandleDeps['loadRegistrationByGroup'],
          loadActiveJobsByCustomer: (() => unreachable('loadActiveJobsByCustomer')) as unknown as HandleDeps['loadActiveJobsByCustomer'],
          buildCustomerJobsFlex: (() => unreachable('buildCustomerJobsFlex')) as unknown as HandleDeps['buildCustomerJobsFlex'],
          recordSlipCheck,
          anthropic,
          visionModel: VISION_MODEL,
          aiEnabled,
          trackEnabled: false,   // spec 1c D1 — no /track /groupid on Messenger
          aiCustomer: aiEnabled ? buildCustomerAiDeps(anthropic, quoteUrl!, quoteToken!, fbAppId) : undefined,
        });
      } catch (err) {
        console.error('[ai-quote/messenger] handleInbound failed:', err instanceof Error ? err.message : err);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

/** Meta webhook verification handshake (GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...)
 *  → echo hub.challenge เมื่อ token ตรง. เรียกครั้งเดียวตอน subscribe ใน app dashboard.
 *  ไม่มี hub params = health probe (mirror LINE route GET). */
export function GET(req: NextRequest): NextResponse {
  const p = req.nextUrl.searchParams;
  if (p.get('hub.mode') === 'subscribe') {
    const expected = process.env.FB_VERIFY_TOKEN;
    if (expected && p.get('hub.verify_token') === expected) {
      return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
    }
    return new NextResponse('forbidden', { status: 403 });
  }
  return NextResponse.json({ ok: true, service: 'penprinting messenger webhook' });
}
