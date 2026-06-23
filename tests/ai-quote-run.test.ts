// tests/ai-quote-run.test.ts
import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runQuoteTurn } from '@/lib/ai-quote/run';

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
});
