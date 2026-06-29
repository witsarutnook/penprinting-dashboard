// tests/ai-quote-slip-flex.test.ts
import { describe, it, expect } from 'vitest';
import { buildSlipFlex } from '@/lib/ai-quote/slip-flex';
import { formatSlipReply } from '@/lib/ai-quote/slip';
import type { ThunderVerifyResponse } from '@/lib/ai-quote/slip';

const success: ThunderVerifyResponse = {
  success: true,
  data: {
    isDuplicate: false,
    isAccountMatched: true,
    rawSlip: {
      transRef: 'REF016180114150',
      transDate: '2026-06-29T10:46:00+07:00',
      amount: { amount: 10000 },
      sender: { account: { name: { th: 'สมิง อ.' }, number: 'xxx-x-x513-7' }, bank: { nameTh: 'กสิกรไทย' } },
      receiver: { account: { name: { th: 'บจก. เพ็ญพรินติ้ง' }, number: 'xxx-x-x360-3' }, bank: { nameTh: 'กสิกรไทย' } },
    },
  },
};

function json(v: unknown): string {
  return JSON.stringify(v);
}

describe('buildSlipFlex', () => {
  it('is a LINE flex message with a non-empty altText equal to formatSlipReply', () => {
    const flex = buildSlipFlex(success);
    expect(flex.type).toBe('flex');
    expect(typeof flex.altText).toBe('string');
    expect((flex.altText as string).length).toBeGreaterThan(0);
    expect(flex.altText).toBe(formatSlipReply(success));
  });

  it('success: green header + amount + sender + receiver + transRef', () => {
    const s = json(buildSlipFlex(success));
    expect(s).toContain('#e1f5ee');      // green header bg
    expect(s).toContain('สลิปถูกต้อง');
    expect(s).toContain('10,000');       // amount, th locale grouping
    expect(s).toContain('สมิง');         // sender
    expect(s).toContain('เพ็ญพรินติ้ง');  // receiver
    expect(s).toContain('REF016180114150'); // transRef
    expect(s).toContain('กสิกรไทย');     // bank
  });

  it('every state carries the Penprinting footer (not Thunder branding)', () => {
    const s = json(buildSlipFlex(success));
    expect(s).toContain('ตรวจสอบอัตโนมัติ');
    expect(s).toContain('Penprinting');
    expect(s).not.toContain('ธันเดอร์');
    expect(s).not.toContain('Thunder');
  });

  it('duplicate: amber header + duplicate notice', () => {
    const flex = buildSlipFlex({ success: true, data: { isDuplicate: true, rawSlip: { amount: { amount: 50 }, sender: { account: { name: { th: 'ก ข' } } } } } });
    const s = json(flex);
    expect(s).toContain('#faeeda');      // amber header bg
    expect(s).toMatch(/เคยส่ง|ซ้ำ/);
    expect(flex.altText).toMatch(/เคยส่ง|ซ้ำ/);
  });

  it('account mismatch: red header + does NOT reveal the wrong destination account', () => {
    const flex = buildSlipFlex({ success: true, data: { isDuplicate: false, isAccountMatched: false, rawSlip: { amount: { amount: 50 }, receiver: { account: { name: { th: 'บัญชีคนอื่น มั่ว' } } } } } });
    const s = json(flex);
    expect(s).toContain('#fcebeb');      // red header bg
    expect(s).toContain('ไม่ตรง');
    expect(s).not.toContain('บัญชีคนอื่น มั่ว'); // D4: never expose the mistaken account
  });

  it('unreadable: gray header + resend message, no data rows', () => {
    const flex = buildSlipFlex({ success: false, error: { code: 'SLIP_NOT_FOUND', message: 'x' } });
    const s = json(flex);
    expect(s).toContain('#f1efe8');      // gray header bg
    expect(s).toMatch(/อ่านสลิป|ส่ง.*ใหม่/);
    expect(flex.type).toBe('flex');
  });

  it('null-safe: success with empty rawSlip never throws and still returns a flex', () => {
    const flex = buildSlipFlex({ success: true, data: { isDuplicate: false, isAccountMatched: true, rawSlip: {} } });
    expect(flex.type).toBe('flex');
    expect((flex.altText as string).length).toBeGreaterThan(0);
  });
});
