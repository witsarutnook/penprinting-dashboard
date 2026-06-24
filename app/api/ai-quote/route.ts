// app/api/ai-quote/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireSession } from '@/lib/route-helpers';
import { runQuoteTurn } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildSystemPrompt } from '@/lib/ai-quote/prompt';
import { createSession, loadSession, saveConversation, saveQuote, markEscalated } from '@/lib/ai-quote/db';
import type { AiQuoteRequest, AiQuoteResponse } from '@/lib/ai-quote/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  if (!apiKey || !quoteUrl || !quoteToken) {
    return NextResponse.json({ error: 'AI quoting ยังไม่ได้ตั้งค่า env (ANTHROPIC_API_KEY / QUOTE_API_URL / QUOTE_API_TOKEN)' }, { status: 500 });
  }

  let body: AiQuoteRequest;
  try { body = (await req.json()) as AiQuoteRequest; } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'message ว่างหรือไม่ถูกต้อง' }, { status: 400 });
  }
  const userMessage = body.message.trim().slice(0, 4000);  // cap length (cost/timeout guard)

  const sess = body.sessionId ? await loadSession(body.sessionId) : await createSession();
  if (!sess) return NextResponse.json({ error: 'ไม่พบ session' }, { status: 404 });

  const client = new Anthropic({ apiKey });
  let out;
  try {
    out = await runQuoteTurn(
      { history: sess.conversation, userMessage },
      { client, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildSystemPrompt(), model: MODEL },
    );
  } catch (err) {
    // Log full detail server-side (Sentry/console); never echo backend error
    // bodies (e.g. calc response) to the staff client.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ai-quote] compute turn failed:', msg);
    return NextResponse.json({ error: 'คิดราคาไม่สำเร็จ (ระบบขัดข้อง) — รบกวนลองใหม่ หรือแจ้งแอดมิน' }, { status: 502 });
  }

  // Persist: conversation + any quotes. On an escalation hand-off (no quote +
  // handoff wording, see detectEscalation) flag the lead so the sales team can
  // tell "needs manual pricing" leads apart from fresh ones on /quote-leads
  // (audit M3). markEscalated only promotes a still-'ใหม่' lead, so it never
  // clobbers a status a human already set.
  await saveConversation(sess.id, out.newHistory);
  for (const q of out.quotes) await saveQuote(sess.id, q);
  if (out.escalated) await markEscalated(sess.id);

  const resp: AiQuoteResponse = {
    sessionId: sess.id,
    reply: out.reply,
    quotes: out.quotes.map((q, i) => ({
      id: i, sessionId: sess.id, productType: q.productType, spec: q.spec, result: q.result, unitPrice: q.unitPrice, createdAt: new Date().toISOString(),
    })),
    escalated: out.escalated,
  };
  return NextResponse.json(resp);
}
