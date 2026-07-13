// app/api/ai-quote/messenger/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMessengerAdapter, getMessengerProfile } from '@/lib/ai-quote/channels/messenger';
import { handleInbound, type HandleDeps } from '@/lib/ai-quote/webhook-router';
import { buildCustomerAiDeps, messengerHintEnabled, normalizeFbAppId } from '@/lib/ai-quote/customer-deps';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipMessenger } from '@/lib/ai-quote/slip-messenger';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { createMessengerSession } from '@/lib/ai-quote/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';

// track/groupid ปิดฝั่ง Messenger (spec 1c D1) — deps เหล่านี้ unreachable เมื่อ
// trackEnabled=false; stub-throw กันเรียกพลาดเงียบๆ ถ้า routing เปลี่ยนในอนาคต
function unreachable(name: string): never {
  throw new Error(`[ai-quote/messenger] ${name} unreachable (trackEnabled=false, 2026-07-08)`);
}

/** Channel-specific piece of the shared builder: Messenger profile fetch
 *  (best-effort display name) + owner-bound (PSID) session insert. */
async function createSessionForMessengerUser(uid: string): Promise<{ id: number; customerName: string | null }> {
  const profile = await getMessengerProfile(uid);
  const s = await createMessengerSession(uid, profile?.displayName ?? null);
  return { id: s.id, customerName: s.customerName };
}

async function blobToBase64(b: Blob): Promise<{ data: string; mediaType: string }> {
  const buf = Buffer.from(await b.arrayBuffer());
  return { data: buf.toString('base64'), mediaType: b.type || 'image/jpeg' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  // Normalized once — a padded FB_APP_ID would break echo classification
  // (see normalizeFbAppId docstring, HINT-1 I1).
  const fbAppId = normalizeFbAppId(process.env.FB_APP_ID);

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
          aiCustomer: aiEnabled ? buildCustomerAiDeps({
            channel: 'messenger',
            hintEnabled: messengerHintEnabled(process.env.AI_QUOTE_MESSENGER_HINT_ENABLED, fbAppId),
            createSessionForUser: createSessionForMessengerUser,
            anthropic, quoteUrl: quoteUrl!, quoteToken: quoteToken!,
          }) : undefined,
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
