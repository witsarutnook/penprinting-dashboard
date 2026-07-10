// tests/ai-quote-run.test.ts
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runQuoteTurn, detectEscalation, shouldPersistTurn, sanitizeHistory, stripChatMarkdown } from '@/lib/ai-quote/run';

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
