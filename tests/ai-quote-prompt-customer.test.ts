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
  // Persona 2026-07-13 (คุณนุ๊ก): the customer-facing AI is named "น้อง PP" —
  // matches the rich menu "CHAT with PP BOT".
  it('carries the น้อง PP persona', () => {
    expect(p).toContain('น้อง PP');
  });
  // Namecard 2026-07-13: quotable (fix rate/box) — must be in scope and OUT of
  // the escalate list.
  it('quotes namecard and no longer escalates it', () => {
    expect(p).toContain('นามบัตร');
    expect(p).toContain('namecard');
    expect(p).not.toMatch(/ส่งต่อทีมงาน[^\n]*\n[^\n]*นามบัตร/); // not in the out-of-scope list
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
  // Polish 2026-07-10: LINE/Messenger show markdown raw — the prompt must
  // forbid it (stripChatMarkdown in run.ts is the safety net, not the fix).
  it('forbids markdown formatting in replies', () => {
    expect(p).toContain('ห้ามใช้ markdown');
  });
});
