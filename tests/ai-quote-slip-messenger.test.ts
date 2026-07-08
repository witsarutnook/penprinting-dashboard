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

describe('buildSlipMessenger (4 states — copy mirrors slip-flex)', () => {
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
  it('unreadable → resend guidance; null-safe on empty result', () => {
    const m = buildSlipMessenger({ success: false });
    expect(m.text).toContain('ไม่สามารถยืนยันสลิป');
    expect(m.text).toContain('ส่งรูปสลิปใหม่');
  });
});
