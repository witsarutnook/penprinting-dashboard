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
  // Case 2026-07-15 (Messenger, real customer): Art 130 → model escalated AND
  // promised "แจ้งได้เลย น้อง PP ประเมินทันที" — but escalation exits the AI
  // mode (webhook-router escalate → exitMode), so the customer's "120" reply
  // hit silence. Two rules pin the fix:
  it('offers a close in-list paper before escalating (stays in mode)', () => {
    expect(p).toContain('กระดาษนอกรายการ');
    expect(p).toContain('Art 130');   // the worked example from the real case
    expect(p).toContain('ห้ามใช้วลี "ส่งต่อทีมงาน" ในคำถามนี้');
  });
  it('requires hand-off replies to end the conversation (mode is closed)', () => {
    expect(p).toContain('ห้ามชวนให้ลูกค้า');
    expect(p).toContain('ปิดโหมด');
  });
  // คุณนุ๊ก 2026-07-15: prices are pre-rounded in code (roundOutcomeForCustomer,
  // ceil to 0.05) before the model sees them — the old "แนบเลขเต็ม" instruction
  // must be gone, and price replies capped at 3 main lines.
  it('no longer asks the model to attach the full-precision price', () => {
    expect(p).not.toContain('แนบเลขเต็ม');
    expect(p).toContain('ปัดราคาให้แล้ว');
  });
  it('pins the concise price-reply format', () => {
    expect(p).toContain('ไม่เกิน 3 บรรทัดหลัก');
    expect(p).toContain('ไม่ต้องทวนสเปกที่ลูกค้าระบุมาแล้ว');
  });
  // คุณนุ๊ก 2026-07-18 (real LINE case "ขอราคาหน่อย"): a vague price ask with no
  // product type must get the exact pinned ask-for-details template (verbatim),
  // not a model-improvised paraphrase.
  it('pins the verbatim ask-for-details template for vague price asks', () => {
    expect(p).toContain('น้อง PP รบกวนขอรายละเอียดงานหน่อยนะคะ');
    expect(p).toContain('เดี๋ยวน้อง PP คำนวณราคาให้เลย 😊');
    expect(p).toContain('📄 ใบปลิว/โบรชัวร์\n📚 หนังสือ\n📓 สมุด\n🪪 นามบัตร');
    expect(p).toContain('ตรงตัวทุกตัวอักษร');
  });
  // Prod smoke 2026-07-15 11:12 (LINE): repeat of an already-quoted spec in the
  // same session → the model skipped the tool and copied the stale total
  // (4,776.25) from its own earlier text turn. Prices must come from THIS
  // turn's compute_quote — never reused from conversation history.
  it('forbids reusing price numbers from earlier turns (must re-call the tool)', () => {
    expect(p).toContain('เทิร์นปัจจุบัน');
    expect(p).toContain('ห้ามนำตัวเลขราคาจากข้อความก่อนหน้า');
  });
});
