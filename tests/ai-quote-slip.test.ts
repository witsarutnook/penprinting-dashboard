// tests/ai-quote-slip.test.ts
import { describe, it, expect } from 'vitest';
import { formatSlipReply } from '@/lib/ai-quote/slip';

describe('formatSlipReply', () => {
  const EXPECTED = 'อัพเดทผลการตรวจสอบสลิป';
  it('uses the generic altText for a valid slip', () => {
    const msg = formatSlipReply({ success: true, data: {
      isDuplicate: false, isAccountMatched: true,
      rawSlip: { amount: { amount: 1500 }, sender: { account: { name: { th: 'สมชาย ใจดี' } } } },
    } });
    expect(msg).toBe(EXPECTED);
  });
  it('uses the generic altText for a duplicate slip', () => {
    expect(formatSlipReply({ success: true, data: { isDuplicate: true } })).toBe(EXPECTED);
  });
  it('uses the generic altText for an account mismatch', () => {
    expect(formatSlipReply({ success: true, data: { isDuplicate: false, isAccountMatched: false } })).toBe(EXPECTED);
  });
  it('uses the generic altText for an unreadable slip (SLIP_NOT_FOUND)', () => {
    expect(formatSlipReply({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } })).toBe(EXPECTED);
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
  it('fail-safe: returns true when the model returns no text blocks', async () => {
    const noText = { messages: { create: async () => ({ content: [] }) } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: noText, model: 'm' })).toBe(true);
  });
});
