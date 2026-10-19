// tests/ai-quote-run.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { Mock } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runQuoteTurn, detectEscalation, shouldPersistTurn, sanitizeHistory, stripChatMarkdown, mkTurn } from '@/lib/ai-quote/run';

// Minimal fake Anthropic client: messages.create returns scripted responses.
function fakeClient(responses: unknown[]) {
  let i = 0;
  return { messages: { create: vi.fn(async () => responses[i++]) } } as unknown as Anthropic;
}

const toolUseMsg = {
  stop_reason: 'tool_use',
  content: [
    { type: 'text', text: 'กำลังคิดราคาให้นะคะ' },
    { type: 'tool_use', id: 'tu_1', name: 'compute_quote',
      input: { productType: 'brochure', spec: { size: 'A4', color: '4', sides: 2, paperName: 'Art 130', qty: 1000 } } },
  ],
};
const finalMsg = {
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: 'ราคา ~5.05 บาท/ชิ้น (ยังไม่รวม VAT 7%)' }],
};

describe('runQuoteTurn', () => {
  it('runs a tool call then returns the final reply + quote', async () => {
    const client = fakeClient([toolUseMsg, finalMsg]);
    const compute = vi.fn().mockResolvedValue({
      ok: true, productType: 'brochure', spec: { qty: 1000 },
      result: { mode: 'offset', unitPrice: 5.048225 },
    });
    const out = await runQuoteTurn(
      { history: [], userMessage: 'โบรชัวร์ A4 4สี 2หน้า อาร์ต130 1000ใบ' },
      { client, compute, systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(compute).toHaveBeenCalledOnce();
    expect(out.quotes).toHaveLength(1);
    expect(out.quotes[0].unitPrice).toBe(5.048225);
    expect(out.reply).toContain('5.05');
    // history grows: prior(0) + user + assistant = 2 turns
    expect(out.newHistory.map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('feeds a 422 back to the model as a tool_result and still finishes', async () => {
    const client = fakeClient([toolUseMsg, finalMsg]);
    const compute = vi.fn().mockResolvedValue({ ok: false, recoverable: true, message: 'paperName: ไม่รู้จัก' });
    const out = await runQuoteTurn(
      { history: [], userMessage: 'x' },
      { client, compute, systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.quotes).toHaveLength(0);       // no successful quote
    expect(client.messages.create).toHaveBeenCalledTimes(2);  // looped after the error
  });

  it('no tool call → just returns the text reply', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ขอถามจำนวนกี่ใบคะ' }] }]);
    const out = await runQuoteTurn(
      { history: [], userMessage: 'อยากได้โบรชัวร์' },
      { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.reply).toContain('จำนวน');
    expect(out.quotes).toHaveLength(0);
    expect(out.priceTables).toEqual([]);   // never undefined — no send_price_table call
  });

  // Regression (audit H1): an empty assistant turn would brick the whole
  // session — the Anthropic API rejects empty text content blocks, so every
  // later message re-sending it 400s. reply + persisted turn must never be ''.
  it('never persists an empty assistant turn when the model stops with no text', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [] }]);
    const out = await runQuoteTurn(
      { history: [], userMessage: 'x' },
      { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.reply.trim()).not.toBe('');                                   // fallback, not empty
    const lastTurn = out.newHistory[out.newHistory.length - 1];
    expect(lastTurn.role).toBe('assistant');
    expect(lastTurn.text.trim()).not.toBe('');                               // empty turn never persisted
    expect(out.priceTables).toEqual([]);                                     // fallback path keeps the array
  });

  it('caps at MAX_TOOL_ROUNDS and still returns a non-empty fallback reply', async () => {
    // Model loops tool_use with no text block forever; the loop must cap.
    const toolOnly = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tu', name: 'compute_quote', input: { productType: 'brochure', spec: {} } },
    ] };
    const client = fakeClient(Array(10).fill(toolOnly));
    const compute = vi.fn().mockResolvedValue({ ok: true, productType: 'brochure', spec: {}, result: { mode: 'offset', unitPrice: 1 } });
    const out = await runQuoteTurn(
      { history: [], userMessage: 'x' },
      { client, compute, systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(client.messages.create).toHaveBeenCalledTimes(6);                 // MAX_TOOL_ROUNDS cap
    expect(out.reply.trim()).not.toBe('');                                   // fallback
  });

  // Audit M3: escalation must be wired off one source of truth so the route
  // can flag the lead "ต้องประเมินเอง". A successful quote turn never escalates;
  // a no-quote hand-off does.
  it('flags escalated on a no-quote hand-off reply', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [
      { type: 'text', text: 'งานกล่องรบกวนให้ทีมงานประเมินราคาให้นะคะ' },
    ] }]);
    const out = await runQuoteTurn(
      { history: [], userMessage: 'ทำกล่อง 500 ใบ' },
      { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.quotes).toHaveLength(0);
    expect(out.escalated).toBe(true);
  });

  it('does not flag escalated when a quote was produced', async () => {
    const client = fakeClient([toolUseMsg, finalMsg]);
    const compute = vi.fn().mockResolvedValue({ ok: true, productType: 'brochure', spec: {}, result: { mode: 'offset', unitPrice: 5 } });
    const out = await runQuoteTurn(
      { history: [], userMessage: 'โบรชัวร์' },
      { client, compute, systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.quotes).toHaveLength(1);
    expect(out.escalated).toBe(false);
  });

  // Polish 2026-07-10: no chat surface renders markdown (LINE / Messenger /
  // quote-assistant are all plain text) — a model reply with **bold** must go
  // out stripped, and the persisted history turn must match what was sent.
  it('strips ** markdown from the reply and the persisted assistant turn', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [
      { type: 'text', text: '**ราคา 5.05 บาท/ชิ้น** (ยังไม่รวม VAT 7%)\n**📋 ประเมินจาก:** A4 / 4 สี' },
    ] }]);
    const out = await runQuoteTurn(
      { history: [], userMessage: 'โบรชัวร์ 1000 ใบ' },
      { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'claude-haiku-4-5' },
    );
    expect(out.reply).toBe('ราคา 5.05 บาท/ชิ้น (ยังไม่รวม VAT 7%)\n📋 ประเมินจาก: A4 / 4 สี');
    const lastTurn = out.newHistory[out.newHistory.length - 1];
    expect(lastTurn.text).not.toContain('**');
    expect(lastTurn.text).toBe(out.reply);
  });
});

// ── Sonnet 5.5 migration (2026-10-08) ─────────────────────────────────────
// Two things the model swap changes at the request/response boundary:
// effort levels are recalibrated (so the level is set explicitly, not
// inherited from the API default), and safeguard refusals arrive as a normal
// 200 with stop_reason 'refusal' and no text — which used to fall through to
// the generic "ระบบยังประมวลผลไม่เสร็จ" retry copy, inviting the customer to
// resend the same request forever.
function createParams(client: Anthropic, call = 0): Record<string, unknown> {
  return (client.messages.create as unknown as { mock: { calls: unknown[][] } }).mock.calls[call][0] as Record<string, unknown>;
}

describe('runQuoteTurn — Sonnet 5.5 request shape', () => {
  it('sets output_config.effort explicitly (medium) — the recalibrated default is not a choice', async () => {
    const client = fakeClient([finalMsg]);
    await runQuoteTurn(
      { history: [], userMessage: 'x' },
      { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'claude-sonnet-5-5' },
    );
    expect(createParams(client).output_config).toEqual({ effort: 'medium' });
  });

  it('a safeguard refusal hands off to the team (escalated) instead of the generic retry copy — compute never runs', async () => {
    const refusal = {
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'general_harms', explanation: 'policy' },
      content: [],
    };
    const client = fakeClient([refusal, finalMsg]);
    const compute = vi.fn();
    const out = await runQuoteTurn(
      { history: [], userMessage: 'x' },
      { client, compute, systemPrompt: 'SYS', model: 'claude-sonnet-5-5' },
    );
    expect(client.messages.create).toHaveBeenCalledTimes(1); // the loop stops on a refusal
    expect(compute).not.toHaveBeenCalled();
    expect(out.escalated).toBe(true);
    expect(out.reply).toContain('ทีมงาน');
    expect(out.reply).not.toContain('พิมพ์คำขออีกครั้ง');
    expect(out.newHistory.at(-1)?.text).toBe(out.reply);
    expect(out.priceTables).toEqual([]);
  });
});

// ── send_price_table (calendar / PVC price-table products, 2026-10-19) ─────
// The model sends a price-table image via a second tool. Every tool_use block
// MUST get a tool_result next round (a missing one 400s the API), duplicates
// within a turn collapse, and an unknown id is fed back as is_error.
describe('runQuoteTurn — send_price_table', () => {
  const sendTableMsg = { stop_reason: 'tool_use', content: [
    { type: 'tool_use', id: 'tu_a', name: 'send_price_table', input: { table: 'calendar_hanging' } },
    { type: 'tool_use', id: 'tu_b', name: 'send_price_table', input: { table: 'calendar_hanging' } },   // duplicate
    { type: 'tool_use', id: 'tu_c', name: 'send_price_table', input: { table: 'sticker' } },            // unknown
  ] };

  it('collects price tables once each and feeds a tool_result per call', async () => {
    const client = fakeClient([sendTableMsg, { stop_reason: 'end_turn', content: [{ type: 'text', text: '📊 ตารางราคาปฏิทินแขวนอยู่ด้านบนนะคะ ขนาดไหน กี่ชุดดีคะ' }] }]);
    const out = await runQuoteTurn({ history: [], userMessage: 'แขวน' }, { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'm' });
    expect(out.priceTables).toEqual(['calendar_hanging']);
    const second = (client.messages.create as Mock).mock.calls[1][0].messages.at(-1);   // tool_result turn
    expect(second.content).toHaveLength(3);
    expect(second.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_a', content: JSON.stringify({ sent: true, table: 'calendar_hanging' }) });
    expect(second.content[0].is_error).toBeUndefined();
    expect(second.content[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_b' });   // duplicate still answered
    expect(second.content[1].is_error).toBeUndefined();
    expect(second.content[2]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_c', is_error: true, content: 'unknown table id' });
    expect(out.quotes).toHaveLength(0);
  });

  it('keeps first-call order across tables and rounds, deduped', async () => {
    const r1 = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 't1', name: 'send_price_table', input: { table: 'pvc_card' } },
    ] };
    const r2 = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 't2', name: 'send_price_table', input: { table: 'calendar_desk' } },
      { type: 'tool_use', id: 't3', name: 'send_price_table', input: { table: 'pvc_card' } },
    ] };
    const client = fakeClient([r1, r2, finalMsg]);
    const out = await runQuoteTurn({ history: [], userMessage: 'x' }, { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'm' });
    expect(out.priceTables).toEqual(['pvc_card', 'calendar_desk']);
  });

  it('mixes compute_quote and send_price_table in one round — each gets its own tool_result', async () => {
    const mixed = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'tq', name: 'compute_quote', input: { productType: 'brochure', spec: {} } },
      { type: 'tool_use', id: 'tt', name: 'send_price_table', input: { table: 'calendar_chinese' } },
    ] };
    const client = fakeClient([mixed, finalMsg]);
    const compute = vi.fn().mockResolvedValue({ ok: true, productType: 'brochure', spec: {}, result: { mode: 'offset', unitPrice: 1 } });
    const out = await runQuoteTurn({ history: [], userMessage: 'x' }, { client, compute, systemPrompt: 'SYS', model: 'm' });
    expect(out.quotes).toHaveLength(1);
    expect(out.priceTables).toEqual(['calendar_chinese']);
    const second = (client.messages.create as Mock).mock.calls[1][0].messages.at(-1);
    expect(second.content.map((b: { tool_use_id: string }) => b.tool_use_id)).toEqual(['tq', 'tt']);
  });

  it('a non-string / missing table input is an unknown id (is_error), not a crash', async () => {
    const bad = { stop_reason: 'tool_use', content: [
      { type: 'tool_use', id: 'x1', name: 'send_price_table', input: {} },
      { type: 'tool_use', id: 'x2', name: 'send_price_table', input: { table: 42 } },
    ] };
    const client = fakeClient([bad, finalMsg]);
    const out = await runQuoteTurn({ history: [], userMessage: 'x' }, { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'm' });
    expect(out.priceTables).toEqual([]);
    const second = (client.messages.create as Mock).mock.calls[1][0].messages.at(-1);
    expect(second.content).toHaveLength(2);
    expect(second.content.every((b: { is_error?: boolean }) => b.is_error === true)).toBe(true);
  });

  it('both tools are offered to the model', async () => {
    const client = fakeClient([finalMsg]);
    await runQuoteTurn({ history: [], userMessage: 'x' }, { client, compute: vi.fn(), systemPrompt: 'SYS', model: 'm' });
    const tools = createParams(client).tools as { name: string }[];
    expect(tools.map((t) => t.name)).toEqual(['compute_quote', 'send_price_table']);
  });
});

describe('stripChatMarkdown', () => {
  it('unwraps paired **bold** keeping the inner text', () => {
    expect(stripChatMarkdown('ราคา **5.05 บาท/ชิ้น** ค่ะ')).toBe('ราคา 5.05 บาท/ชิ้น ค่ะ');
  });
  it('handles multiple pairs across lines', () => {
    expect(stripChatMarkdown('**หนังสือ A5**\nราคา **32.64** บาท/เล่ม'))
      .toBe('หนังสือ A5\nราคา 32.64 บาท/เล่ม');
  });
  it('drops a stray unpaired ** marker', () => {
    expect(stripChatMarkdown('ราคา **5.05 บาท')).toBe('ราคา 5.05 บาท');
  });
  it('leaves text without markdown unchanged (single * intact)', () => {
    const plain = 'ราคา 5.05 บาท/ชิ้น (ยังไม่รวม VAT 7%) · ขนาด 10*15 ซม.';
    expect(stripChatMarkdown(plain)).toBe(plain);
  });
});

describe('detectEscalation', () => {
  it('true only when there is no quote AND the reply uses hand-off wording', () => {
    expect(detectEscalation(0, 'รบกวนให้ทีมงานช่วยดูให้นะคะ')).toBe(true);
    expect(detectEscalation(0, 'ขอประเมินราคาเพิ่มเติมก่อนนะคะ')).toBe(true);
  });
  it('false when a quote exists, even with hand-off wording', () => {
    expect(detectEscalation(1, 'ให้ทีมงานยืนยันอีกครั้งนะคะ')).toBe(false);
  });
  it('false when no quote but the reply is an ordinary clarifying question', () => {
    expect(detectEscalation(0, 'ขอจำนวนกี่ใบคะ')).toBe(false);
  });
});

// No-auto-save: a plain quote chat is NOT persisted until it escalates or
// staff explicitly saves.
describe('shouldPersistTurn', () => {
  it('persists when a session already exists', () => {
    expect(shouldPersistTurn(true, false)).toBe(true);
  });
  it('persists a fresh chat only when it escalated', () => {
    expect(shouldPersistTurn(false, true)).toBe(true);
    expect(shouldPersistTurn(false, false)).toBe(false); // plain chat → not saved
  });
});

describe('sanitizeHistory', () => {
  it('keeps well-formed turns and drops junk', () => {
    const out = sanitizeHistory([
      { role: 'user', text: 'hi' },
      { role: 'bot', text: 'nope' },     // bad role
      { role: 'assistant', text: '' },   // empty
      { role: 'assistant', text: 'ok' },
      'garbage',
    ]);
    expect(out).toEqual([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'ok' }]);
  });
  it('returns [] for non-array input and clamps to the last N turns', () => {
    expect(sanitizeHistory('nope')).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ role: 'user', text: `m${i}` }));
    expect(sanitizeHistory(many, 40)).toHaveLength(40);
  });
});

describe('per-turn timestamp (quote-logs spec 2026-07-20)', () => {
  it('mkTurn stamps role/text/ts (ISO parseable)', () => {
    const t = mkTurn('assistant', 'สวัสดีค่ะ');
    expect(t.role).toBe('assistant');
    expect(t.text).toBe('สวัสดีค่ะ');
    expect(typeof t.ts).toBe('string');
    expect(Number.isNaN(Date.parse(t.ts!))).toBe(false);
  });
  it('sanitizeHistory preserves a valid ts', () => {
    const out = sanitizeHistory([{ role: 'user', text: 'hi', ts: '2026-07-20T10:00:00.000Z' }]);
    expect(out[0].ts).toBe('2026-07-20T10:00:00.000Z');
  });
  it('sanitizeHistory drops an invalid ts but keeps the turn', () => {
    const out = sanitizeHistory([{ role: 'user', text: 'hi', ts: 'not-a-date' }]);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBeUndefined();
  });
});
