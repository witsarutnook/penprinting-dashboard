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

import { isSlipImage, SLIP_PREFILTER_PROMPT, slipAccountMatched } from '@/lib/ai-quote/slip';

describe('slipAccountMatched (Thunder v2 + legacy dual-read)', () => {
  it('v2: matchedAccount object → true, null → false', () => {
    expect(slipAccountMatched({ success: true, data: { matchedAccount: { nameTh: 'บริษัท เพ็ญพรินติ้ง จำกัด' } } } as never)).toBe(true);
    expect(slipAccountMatched({ success: true, data: { matchedAccount: null } } as never)).toBe(false);
  });
  it('legacy: isAccountMatched boolean passthrough when matchedAccount absent', () => {
    expect(slipAccountMatched({ success: true, data: { isAccountMatched: true } })).toBe(true);
    expect(slipAccountMatched({ success: true, data: { isAccountMatched: false } })).toBe(false);
  });
  it('neither field / no data → null (check not performed — never a mismatch)', () => {
    expect(slipAccountMatched({ success: true, data: { isDuplicate: false } })).toBeNull();
    expect(slipAccountMatched({ success: false })).toBeNull();
  });
});

describe('SLIP_PREFILTER_PROMPT (2026-07-23 incident pins)', () => {
  it('memo/theme immunity — a slip whose memo says "sticker" must not be judged by it (prod drop, slip_checks id 424)', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('ข้อความในช่องบันทึกช่วยจำ/memo ของสลิป (เช่นคำว่า sticker หรือชื่อสินค้า) และลายพื้นหลัง/ธีมตกแต่งของธนาคาร ไม่มีผลต่อการตัดสิน');
  });
  it('the no-list says สติกเกอร์ไลน์/รูปการ์ตูน — never the bare word สติกเกอร์ (collides with slip memo text)', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('สติกเกอร์ไลน์/รูปการ์ตูน');
    expect(SLIP_PREFILTER_PROMPT).not.toMatch(/สติกเกอร์[,)]/);
  });
  it('bill-payment slips stay explicitly in-scope', () => {
    expect(SLIP_PREFILTER_PROMPT).toContain('จ่ายบิลสำเร็จ');
  });
});

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
