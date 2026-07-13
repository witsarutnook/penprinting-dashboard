// app/api/ai-quote/line/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildLineAdapter, getLineProfile } from '@/lib/ai-quote/channels/line';
import { handleInbound, type HandleDeps } from '@/lib/ai-quote/webhook-router';
import { buildCustomerAiDeps, lineHintEnabled } from '@/lib/ai-quote/customer-deps';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipFlex } from '@/lib/ai-quote/slip-flex';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { buildOrderFlex } from '@/lib/ai-quote/track-flex';
import { loadOrder } from '@/lib/api';
import { loadActiveJobsByCustomer } from '@/lib/customer-track';
import { loadRegistrationByGroup } from '@/lib/registrations';
import { buildCustomerJobsFlex } from '@/lib/ai-quote/customer-jobs-flex';
import { createLineSession } from '@/lib/ai-quote/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';

/** Channel-specific piece of the shared builder: LINE profile fetch (best-effort
 *  display name) + owner-bound session insert. */
async function createSessionForLineUser(uid: string): Promise<{ id: number; customerName: string | null }> {
  const profile = await getLineProfile(uid);
  const s = await createLineSession(uid, profile?.displayName ?? null);
  return { id: s.id, customerName: s.customerName };
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
  // AI arms need the quote backend + Anthropic key — flag ON with any env
  // missing degrades safely to 1b-A behaviour (slip/track only), mirroring
  // the staff route's guard instead of throwing inside after().
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  const aiEnabled = process.env.AI_QUOTE_LINE_ENABLED === 'true'
    && !!quoteUrl && !!quoteToken && !!process.env.ANTHROPIC_API_KEY;

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
          aiCustomer: aiEnabled ? buildCustomerAiDeps({
            channel: 'line',
            hintEnabled: lineHintEnabled(process.env.AI_QUOTE_LINE_HINT_ENABLED),
            createSessionForUser: createSessionForLineUser,
            anthropic, quoteUrl: quoteUrl!, quoteToken: quoteToken!,
          }) : undefined,
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
