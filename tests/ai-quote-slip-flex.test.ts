// tests/ai-quote-slip-flex.test.ts
import { describe, it, expect } from 'vitest';
import { buildSlipFlex } from '@/lib/ai-quote/slip-flex';
import { formatSlipReply } from '@/lib/ai-quote/slip';
import type { ThunderVerifyResponse } from '@/lib/ai-quote/slip';

// Real Thunder v2 shape (per document.thunder.in.th): date (not transDate) + bank.name (not bank.nameTh)
const success: ThunderVerifyResponse = {
  success: true,
  data: {
    isDuplicate: false,
    isAccountMatched: true,
    rawSlip: {
      transRef: 'REF016180114150',
      date: '2026-06-29T12:05:00+07:00',
      amount: { amount: 10000 },
      sender: { account: { name: { th: 'สมิง อ.' } }, bank: { id: '004', name: 'กสิกรไทย', short: 'KBANK' } },
      receiver: { account: { name: { th: 'บจก. เพ็ญพรินติ้ง' } }, bank: { id: '004', name: 'กสิกรไทย', short: 'KBANK' } },
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
    expect(s).toContain('กสิกรไทย');     // bank (from bank.name)
    expect(s).toContain('12:05');        // transaction time (from date)
  });

  it('dual-read: also renders bank + date from the legacy Remedy shape (bank.nameTh / transDate)', () => {
    const s = json(buildSlipFlex({ success: true, data: { isDuplicate: false, isAccountMatched: true, rawSlip: {
      amount: { amount: 5 }, transDate: '2026-06-29T09:30:00+07:00',
      sender: { account: { name: { th: 'ก' } }, bank: { nameTh: 'ไทยพาณิชย์' } },
    } } }));
    expect(s).toContain('ไทยพาณิชย์'); // bank.nameTh fallback
    expect(s).toContain('09:30');      // transDate fallback
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
