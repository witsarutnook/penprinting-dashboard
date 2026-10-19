// tests/ai-quote-prompt-customer.test.ts
import { describe, it, expect } from 'vitest';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { VALID_PAPER_NAMES } from '@/lib/ai-quote/prompt';
import { detectCustomerEscalation } from '@/lib/ai-quote/customer-triggers';

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

// Twin of the staff-prompt Green Read alias (2026-07-24) — customers type
// "กระดาษถนอมสายตา" or "Green Read 75 แกรม"; both must resolve to the
// system name instead of falling into the out-of-list escalation path.
describe('customer prompt — Green Read 75 alias (2026-07-24)', () => {
  it('maps ถนอมสายตา / กรีนรีด → Green Read 75', () => {
    expect(p).toMatch(/ถนอมสายตา[^\n]*Green Read 75/);
    expect(p).toContain('กรีนรีด');
  });
});

// Same settled-answers rule as the staff prompt (Sonnet 5.5 smoke 2026-10-08):
// a customer asking a second job must not get the first one re-quoted too.
describe('settled answers (Sonnet 5.5 follow-up turns)', () => {
  it('earlier quotes are done — this turn only computes what was asked this turn', () => {
    const p = buildCustomerSystemPrompt();
    expect(p).toContain('งานที่ตอบราคาไปแล้วในเทิร์นก่อนถือว่าจบ');
    expect(p).toContain('ไม่ใช่ทุกเทิร์น');
  });
});

// Calendar + PVC card (spec 2026-10-19 §6.4) — customer twin of the staff
// describe in ai-quote-prompt.test.ts.
describe('customer prompt — calendar + PVC card + price tables (2026-10-19)', () => {
  it('lists calendar + pvccard as quotable with their tool specs', () => {
    expect(p).toContain('calendar');
    expect(p).toContain('pvccard');
    expect(p).toContain('10.5x15');
    expect(p).toContain("'8'");
  });
  it('pins what each calendar/PVC price includes + the PVC design-fee rule', () => {
    expect(p).toContain('13 แผ่น');
    expect(p).toContain('สันห่วง');
    expect(p).toContain('5.4x8.6');
    expect(p).toMatch(/ค่าออกแบบ 300/);
    expect(p).toContain('ขั้นต่ำ 300');
  });
  it('tells the model to send the price table once and mark it in the reply', () => {
    expect(p).toContain('send_price_table');
    expect(p).toContain('📊 ตารางราคา');
    expect(p).toContain('1 ครั้งต่อตาราง');
  });
  it('never guesses calendar size; other sizes hand off', () => {
    expect(p).toMatch(/ขนาดห้ามเดา|ห้ามเดาขนาด/);
    expect(p).toMatch(/ขนาด\/แบบอื่น[^\n]*ส่งต่อทีมงาน|นอกตาราง[^\n]*ส่งต่อทีมงาน/);
  });
  it('counts 6 quotable types, not 4', () => {
    expect(p).toContain('6 ชนิด');
    expect(p).toContain('6 ประเภทนี้ค่ะ');
    expect(p).not.toContain('4 ชนิด');
    expect(p).not.toContain('4 ประเภท');
  });
  // Review fix round 1: the router sends TEXT ONLY on a hand-off (spec §6.3), so
  // a "📊 …อยู่ด้านบน" line there points at an image that never arrived.
  it('hand-off turn: no send_price_table call and no 📊 line (even if the tool was already called)', () => {
    expect(p).toMatch(/เทิร์นที่ส่งต่อทีมงาน[^\n]*ไม่เรียก send_price_table[^\n]*ห้ามใส่บรรทัด 📊/);
    expect(p).toContain('ตัดบรรทัด 📊 ออกจากข้อความส่งต่อ');
    expect(p).toMatch(/above_max[^\n]*ข้อความส่งต่อห้ามมีบรรทัด 📊/);
  });
  // run.ts keeps only the LAST round's text as reply + history; a 📊 line in the
  // preamble next to the tool_use is lost and the once-per-table marker breaks.
  it('📊 line must be in the final reply (after tool results), not the pre-tool preamble', () => {
    expect(p).toMatch(/📊 ต้องอยู่ในข้อความตอบสุดท้าย[^\n]*ไม่ใช่ข้อความก่อนเรียกเครื่องมือ/);
  });
  // The designed flow is two steps; the generic "ถามรวมครั้งเดียว" rule sits right
  // next to it and must not collapse kind + size + qty into one question.
  it('calendar is a two-step ask: kind only -> table -> size + qty together', () => {
    expect(p).toMatch(/ถามแค่แบบก่อน[^\n]*ส่งตาราง[^\n]*ขนาด[^\n]*รวมครั้งเดียว/);
    expect(p).toContain('ไม่ใช่ถามรวมทีเดียว');
  });
  // Review fix round 1: the generic format rule says 📋 appears ONLY when defaults
  // were filled in; calendar/PVC never get defaults but still need their 📋 line.
  it('📋 rule has an explicit calendar/PVC exception (no self-contradiction)', () => {
    expect(p).toMatch(/บรรทัด 📋 ใส่เฉพาะเมื่อเติมค่ามาตรฐาน[^\n]*ยกเว้นปฏิทิน\/บัตร PVC/);
  });
  // customer only
  it('below_min keeps the customer talking (no hand-off phrase) and asks the popular-3 question verbatim', () => {
    expect(p).toContain('แบบที่นิยมมี 3 แบบ');
    expect(p).toMatch(/below_min[^\n]*ห้ามใช้วลี/);
    expect(p).toContain('📅 ปฏิทิน');
    expect(p).toContain('💳 บัตร PVC');
  });
  // The scripted ask-for-type reply and the below_min reply both leave the
  // customer in the AI mode — neither may trip detectCustomerEscalation.
  it('pins the popular-3 sentence verbatim and it is not a hand-off', () => {
    const ask = 'ทำได้ค่ะ 😊 แบบที่นิยมมี 3 แบบ: ปฏิทินจีน · ตั้งโต๊ะ 6x8 นิ้ว · แขวน รับแบบไหนดีคะ (ขนาดอื่นนอกจากนี้ ทีมงานคุยรายละเอียดให้ค่ะ)';
    expect(p).toContain(ask);
    expect(detectCustomerEscalation(0, ask)).toBe(false);
  });
  it('below_min also bans the second detector phrase "ให้ทีมงานประเมิน"', () => {
    expect(p).toMatch(/below_min[^\n]*ให้ทีมงานประเมิน/);
  });
  it('template lists the two new types after นามบัตร, in order', () => {
    expect(p).toContain('🪪 นามบัตร\n📅 ปฏิทิน\n💳 บัตร PVC');
  });
});
