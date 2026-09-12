// tests/ai-quote-slip-messenger.test.ts
import { describe, it, expect } from 'vitest';
import { buildSlipMessenger } from '@/lib/ai-quote/slip-messenger';
import type { ThunderVerifyResponse } from '@/lib/ai-quote/slip';

const success: ThunderVerifyResponse = {
  success: true,
  data: {
    isDuplicate: false, isAccountMatched: true,
    rawSlip: {
      amount: { amount: 1500 }, date: '2026-07-08T03:00:00Z',
      sender: { account: { name: { th: 'สมชาย ใจดี' } }, bank: { name: 'กสิกรไทย' } },
      receiver: { account: { name: { th: 'เพ็ญพรินติ้ง' }, number: '123-4' } },
    },
  },
};

describe('buildSlipMessenger (5 states — copy mirrors slip-flex)', () => {
  it('success → ✅ + amount + sender + bank', () => {
    const m = buildSlipMessenger(success);
    expect(m.text).toContain('✅');
    expect(m.text).toContain('฿1,500.00');
    expect(m.text).toContain('สมชาย ใจดี');
    expect(m.text).toContain('กสิกรไทย');
  });
  it('duplicate → เคยส่งแล้ว + sender line + แจ้งทีมงาน', () => {
    const m = buildSlipMessenger({ success: true, data: { isDuplicate: true, rawSlip: { amount: { amount: 500 }, sender: { account: { name: { th: 'สมชาย ใจดี' } } } } } });
    expect(m.text).toContain('เคยส่งแล้ว');
    expect(m.text).toContain('฿500.00');
    expect(m.text).toContain('จาก สมชาย ใจดี');
  });
  it('mismatch → recheck copy + amount, never exposes the destination account (D4)', () => {
    const m = buildSlipMessenger({ success: true, data: { isDuplicate: false, isAccountMatched: false, rawSlip: { amount: { amount: 250 }, receiver: { account: { number: '999-9' } } } } });
    expect(m.text).toContain('ไม่ตรงบัญชี');
    expect(m.text).toContain('฿250.00');
    expect(m.text).not.toContain('999-9');
  });
  // 2026-09-11: both no-verdict states used to end with "รบกวนส่งรูปสลิปใหม่ให้
  // ชัดเจน". On a SLIP_NOT_FOUND run that is advice the customer cannot act on —
  // the same image fails identically — so they re-sent, and every resend spent
  // another Thunder quota slot (slip_checks 1235-1241). Neither state may ask
  // for a re-send again; these two assertions are the guard.
  it('unreadable → hands off to staff and explicitly does NOT ask for a re-send', () => {
    const m = buildSlipMessenger({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } });
    expect(m.text).toContain('ยืนยันสลิปใบนี้ไม่ได้');
    expect(m.text).toContain('ทีมงานจะตรวจสอบ');
    expect(m.text).toContain('ไม่ต้องส่งซ้ำ');
    expect(m.text).not.toContain('ส่งรูปสลิปใหม่');
  });
  it('system error (quota/auth/5xx) → "ขัดข้องชั่วคราว", never blames the image', () => {
    const m = buildSlipMessenger({ success: false, error: { code: 'QUOTA_EXCEEDED', message: 'x' } });
    expect(m.text).toContain('ขัดข้องชั่วคราว');
    expect(m.text).toContain('ทีมงานจะตรวจสอบ');
    expect(m.text).not.toContain('ส่งรูปสลิปใหม่');
  });
  it('null-safe: a body with neither data nor error still renders', () => {
    expect(typeof buildSlipMessenger({ success: false }).text).toBe('string');
  });
});
