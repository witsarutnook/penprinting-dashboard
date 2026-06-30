// app/api/ai-quote/line/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildLineAdapter } from '@/lib/ai-quote/channels/line';
import { handleInbound, type HandleDeps } from '@/lib/ai-quote/webhook-router';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipFlex } from '@/lib/ai-quote/slip-flex';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { buildOrderFlex } from '@/lib/ai-quote/track-flex';
import { loadOrder } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';

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
  const aiEnabled = process.env.AI_QUOTE_LINE_ENABLED === 'true';

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
          recordSlipCheck,
          anthropic,
          visionModel: VISION_MODEL,
          aiEnabled,
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
