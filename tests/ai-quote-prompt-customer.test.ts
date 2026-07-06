// tests/ai-quote-prompt-customer.test.ts
import { describe, it, expect } from 'vitest';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { VALID_PAPER_NAMES } from '@/lib/ai-quote/prompt';

const p = buildCustomerSystemPrompt();

describe('buildCustomerSystemPrompt (1b-B §3)', () => {
  it('addresses the customer, not staff', () => {
    expect(p).toContain('ลูกค้า');
    expect(p).not.toContain('พนักงานจะวาง');   // staff-prompt framing must not leak
  });
  it('keeps the full known-paper list', () => {
    for (const name of VALID_PAPER_NAMES) expect(p).toContain(name);
  });
  it('pins the hand-off phrase used by detectCustomerEscalation', () => {
    expect(p).toContain('ส่งต่อทีมงาน');
  });
  it('requires the D4 price disclaimer on every quote', () => {
    expect(p).toContain('ราคาประเมินเบื้องต้น');
    expect(p).toContain('VAT 7%');
  });
  it('keeps the assume-and-disclose brochure rule (qty เพียงพอ)', () => {
    expect(p).toContain('จำนวน (qty)');
    expect(p).toContain('Art 120');
  });
  it('forbids self-negotiated discounts (escalate instead)', () => {
    expect(p).toMatch(/ต่อราคา|ส่วนลด/);
  });
});
