// tests/ai-quote-slip.test.ts
import { describe, it, expect } from 'vitest';
import { formatSlipReply } from '@/lib/ai-quote/slip';

describe('formatSlipReply', () => {
  it('confirms a valid slip with amount + sender', () => {
    const msg = formatSlipReply({ success: true, data: {
      isDuplicate: false, isAccountMatched: true,
      rawSlip: { amount: { amount: 1500 }, sender: { account: { name: { th: 'สมชาย ใจดี' } } } },
    } });
    expect(msg).toContain('1,500');
    expect(msg).toContain('สมชาย');
    expect(msg).toMatch(/ได้รับสลิป|ขอบคุณ/);
  });
  it('flags a duplicate slip', () => {
    const msg = formatSlipReply({ success: true, data: { isDuplicate: true } });
    expect(msg).toMatch(/เคยส่ง|ซ้ำ/);
  });
  it('flags an account mismatch', () => {
    const msg = formatSlipReply({ success: true, data: { isDuplicate: false, isAccountMatched: false } });
    expect(msg).toMatch(/ไม่ตรง/);
  });
  it('handles an unreadable slip (SLIP_NOT_FOUND)', () => {
    const msg = formatSlipReply({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } });
    expect(msg).toMatch(/อ่านสลิปไม่ได้|รบกวนส่งใหม่/);
  });
});

import { isSlipImage } from '@/lib/ai-quote/slip';

function fakeClient(replyText: string) {
  return { messages: { create: async () => ({ content: [{ type: 'text', text: replyText }] }) } } as never;
}

describe('isSlipImage (Haiku vision pre-filter)', () => {
  const b64 = 'iVBORw0KGgo=';
  it('returns true when the model answers yes', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('yes'), model: 'm' })).toBe(true);
  });
  it('returns false when the model answers no', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('no, this is food'), model: 'm' })).toBe(false);
  });
  it('fail-safe: returns true when the model call throws (better waste 1 quota than miss a slip)', async () => {
    const throwing = { messages: { create: async () => { throw new Error('boom'); } } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: throwing, model: 'm' })).toBe(true);
  });
});
