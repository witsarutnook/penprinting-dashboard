// app/api/ai-quote/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { requireSession } from '@/lib/route-helpers';
import { runQuoteTurn } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildSystemPrompt } from '@/lib/ai-quote/prompt';
import { createSession, loadSession, saveConversation, saveQuote } from '@/lib/ai-quote/db';
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
  if (!body.message?.trim()) return NextResponse.json({ error: 'message ว่าง' }, { status: 400 });

  const sess = body.sessionId ? await loadSession(body.sessionId) : await createSession();
  if (!sess) return NextResponse.json({ error: 'ไม่พบ session' }, { status: 404 });

  const client = new Anthropic({ apiKey });
  let out;
  try {
    out = await runQuoteTurn(
      { history: sess.conversation, userMessage: body.message },
      { client, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildSystemPrompt(), model: MODEL },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `คิดราคาไม่สำเร็จ: ${msg}` }, { status: 502 });
  }

  // Persist: conversation + any quotes. Escalation lead-status is NOT auto-set
  // here — heuristic detection of "the model handed off" is unreliable, so
  // staff set it on /quote-leads. We only surface an `escalated` hint flag.
  await saveConversation(sess.id, out.newHistory);
  for (const q of out.quotes) await saveQuote(sess.id, q);

  const resp: AiQuoteResponse = {
    sessionId: sess.id,
    reply: out.reply,
    quotes: out.quotes.map((q, i) => ({
      id: i, sessionId: sess.id, productType: q.productType, spec: q.spec, result: q.result, unitPrice: q.unitPrice, createdAt: new Date().toISOString(),
    })),
    escalated: out.quotes.length === 0 && /ทีมงาน|ประเมินราคา/.test(out.reply),
  };
  return NextResponse.json(resp);
}
