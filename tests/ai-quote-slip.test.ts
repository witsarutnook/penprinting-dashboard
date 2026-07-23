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
  it('passes when the model answers yes — answer captured for slip_checks', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('yes'), model: 'm' }))
      .toEqual({ pass: true, answer: 'yes' });
  });
  it('drops on an explicit English refusal ("no ...")', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('no, this is food'), model: 'm' }))
      .toEqual({ pass: false, answer: 'no, this is food' });
  });
  it('drops on an explicit Thai refusal ("ไม่ใช่..." / bare "ไม่")', async () => {
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่ใช่สลิป'), model: 'm' })).pass).toBe(false);
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่'), model: 'm' })).pass).toBe(false);
  });
  it('"ไม่แน่ใจ" (unsure) must fail-safe to PASS — 2026-07-23 incident: startsWith("ไม่") read it as a refusal and silently dropped a real slip', async () => {
    expect(await isSlipImage(b64, 'image/png', { client: fakeClient('ไม่แน่ใจ'), model: 'm' }))
      .toEqual({ pass: true, answer: 'ไม่แน่ใจ' });
  });
  it('"not sure" must fail-safe to PASS — refusal needs the word "no", not the prefix', async () => {
    expect((await isSlipImage(b64, 'image/png', { client: fakeClient('not sure'), model: 'm' })).pass).toBe(true);
  });
  it('fail-safe: passes when the model call throws (better waste 1 quota than miss a slip) — answer null', async () => {
    const throwing = { messages: { create: async () => { throw new Error('boom'); } } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: throwing, model: 'm' }))
      .toEqual({ pass: true, answer: null });
  });
  it('fail-safe: passes when the model returns no text blocks', async () => {
    const noText = { messages: { create: async () => ({ content: [] }) } } as never;
    expect(await isSlipImage(b64, 'image/png', { client: noText, model: 'm' }))
      .toEqual({ pass: true, answer: '' });
  });
});
