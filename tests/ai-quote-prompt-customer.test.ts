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

// Namecard asks no quantity (คุณนุ๊ก 2026-10-24, LINE 8:27 case): the per-box
// price is flat (calc defaults.ts namecard.pricePerBox — 1 side 150/250,
// 2 sides 300/500, never a function of box count), so "กี่ใบ" was a wasted
// turn. The customer sees both side prices at once; sides is the only ask;
// lamination is a note, never a question.
describe('customer prompt — namecard asks no quantity (2026-10-24)', () => {
  const section = p.split('## นามบัตร — กฎเฉพาะ')[1]?.split('\n## ')[0] ?? '';

  it('the generic "always ask qty" rule carves namecard out', () => {
    expect(p).toMatch(/จำนวน \(qty\) ทุกชนิดงาน[^\n]*ยกเว้นนามบัตร/);
    expect(section).toContain('ไม่ต้องถามจำนวน');
  });
  it('completeness: knowing it is a namecard is enough — no qty needed', () => {
    expect(p).toMatch(/\*\*นามบัตร\*\*: รู้ว่าเป็นนามบัตร = ครบแล้ว/);
    expect(p).not.toMatch(/\*\*นามบัตร\*\*: รู้ว่าเป็นนามบัตร \+ มี \*\*จำนวน\*\*/);
  });
  it('unknown qty → compute_quote with qty = 100 (one box), reply as a per-box price', () => {
    expect(section).toMatch(/ยังไม่บอกจำนวน[^\n]*qty = 100/);
    expect(section).toContain('กล่องละ X บาท (100 ใบ)');
  });
  it('unknown sides → two compute_quote calls in one turn, both prices shown, sides is the only question', () => {
    expect(section).toMatch(/ยังไม่บอก(หน้าเดียว\/หน้าหลัง|หน้า)[^\n]*compute_quote[^\n]*2 ครั้ง[^\n]*sides = 1[^\n]*sides = 2/);
    expect(section).toContain('แจ้งราคาทั้ง 2 แบบ');
    expect(section).toMatch(/ถามแค่ว่ารับแบบไหน/);
  });
  it('lamination is never asked: plain price + a note, no lamination number', () => {
    expect(section).toMatch(/เคลือบ[^\n]*ไม่ต้องถาม/);
    expect(section).toContain('ถ้าเคลือบเงา/ด้านบอกได้เลยค่ะ');
    expect(detectCustomerEscalation(0, 'ราคาแบบไม่เคลือบนะคะ ถ้าเคลือบเงา/ด้านบอกได้เลยค่ะ')).toBe(false);
  });
  it('defaults: plain stays the default, sides has none (both are shown)', () => {
    expect(p).not.toContain('นามบัตร: พิมพ์ 1 หน้า · ไม่เคลือบ');
    expect(p).toMatch(/- นามบัตร: ไม่เคลือบ/);
  });
  // Prices live in calc (defaults.ts) and reach the customer only through
  // compute_quote — a number in the prompt would drift silently on the next
  // price change (SPOT UV lesson 2026-10-02).
  it('namecard section carries no price number (only the 100-per-box fact)', () => {
    expect(section.length).toBeGreaterThan(0);
    expect(section).not.toMatch(/\d{2,} ?บาท/);
  });
  it('answer format: per-box line for both the no-qty and the with-qty case', () => {
    expect(p).toMatch(/นามบัตร[^\n]*ยังไม่บอกจำนวน[^\n]*กล่องละ X บาท/);
    expect(p).toMatch(/นามบัตร[^\n]*บอกจำนวน[^\n]*ราคาต่อกล่อง × จำนวนกล่อง = ราคารวม/);
  });
});

describe('customer prompt — round-2 policy: sizes, binding, lead-time, format (2026-11-04)', () => {
  const sizes = p.split('## ขนาดนอกรายการ')[1]?.split('\n## ')[0] ?? '';
  const binding = p.split('## การเข้าเล่ม')[1]?.split('\n## ')[0] ?? '';
  const handoff = p.split('## เมื่องานเกินขอบเขต')[1]?.split('\n## ')[0] ?? '';
  const namecard = p.split('## นามบัตร — กฎเฉพาะ')[1]?.split('\n## ')[0] ?? '';
  const LEAD = 'ระยะเวลาผลิตและค่าส่งขึ้นกับงานค่ะ ทีมงานแจ้งให้ตอนยืนยันราคานะคะ';

  it('A6 maps to A5 with the quantity halved, total only, source disclosed', () => {
    expect(sizes).toMatch(/A6[^\n]*A5[^\n]*(÷ 2|หาร 2)/);
    expect(sizes).toContain('A6 คิดจาก A5');
    expect(sizes).toMatch(/ราคารวม[^\n]*(ไม่แสดง|ห้ามแสดง)[^\n]*(ต่อใบ|ต่อเล่ม)/);
    expect(sizes).toMatch(/ไม่ถาม[^\n]*ไม่ส่งต่อ|ไม่ส่งต่อ[^\n]*ไม่ถาม/);
  });
  it('A6 rule rounds odd quantities up and covers books/notebooks too', () => {
    expect(sizes).toContain('ปัดขึ้น');
    expect(sizes).toMatch(/15 เล่ม[^\n]*8 เล่ม/);
  });
  it('B5 maps to A4 at the same quantity; per-unit price allowed', () => {
    expect(sizes).toMatch(/B5[^\n]*A4[^\n]*จำนวนเท่าเดิม/);
    expect(sizes).toContain('B5 คิดราคาเท่า A4');
  });
  it('size aliases (a6 / เอ6 / บี5) map the same way; other sizes still hand off', () => {
    expect(sizes).toMatch(/เอ6|เอ 6/);
    expect(sizes).toMatch(/บี5|บี 5/);
    expect(sizes).toMatch(/A7[^\n]*ส่งต่อทีมงาน/);
  });
  it('halving the quantity is tool-parameter prep, not price arithmetic', () => {
    expect(sizes).toMatch(/จำนวน[^\n]*ไม่ใช่[^\n]*ราคา|เตรียม[^\n]*เครื่องมือ/);
  });
  it('binding: glue/saddle are standard and never asked; ring adds a fixed line the model must not sum', () => {
    expect(binding).toMatch(/ไสกาว[^\n]*มุงหลังคา[^\n]*ไม่ต้องถาม/);
    expect(binding).toContain('ขอบกาว');
    expect(binding).toContain('เข้าเล่มสันห่วงเพิ่มเล่มละ 15 บาท (ยังไม่รวมในราคาด้านบน)');
    expect(binding).toMatch(/สันห่วง[^\n]*ห้ามบวก/);
  });
  it('hard cover and thread sewing are named in the hand-off list and win over the nearest-paper rule', () => {
    expect(handoff).toContain('ปกแข็ง');
    expect(handoff).toContain('เย็บกี่');
    expect(p).toMatch(/ปกแข็ง[^\n]*ส่งต่อก่อน[^\n]*ไม่ถามกระดาษ/);
  });
  it('gram-only paper (e.g. 75 gram) offers the in-list neighbours instead of handing off', () => {
    expect(p).toMatch(/บอกแค่แกรม[^\n]*Bond 70[^\n]*Bond 80[^\n]*Green Read 75/);
  });
  it('lead-time / shipping: fixed no-number sentence that does not close AI mode', () => {
    expect(p).toContain(LEAD);
    expect(p).toMatch(/เวลาผลิต[^\n]*ค่าส่ง[^\n]*ไม่มีตัวเลข|ไม่มีตัวเลข[^\n]*เวลาผลิต/);
    expect(detectCustomerEscalation(0, LEAD)).toBe(false);
    expect(detectCustomerEscalation(0, `💰 ใบปลิว A4 500 ใบ → ใบละ 1.20 บาท (ยังไม่รวม VAT 7%)\n${LEAD}`)).toBe(false);
  });
  it('no thinking aloud, no preamble, no spec echo', () => {
    expect(p).toMatch(/ห้าม[^\n]*ย่อหน้าวิเคราะห์/);
    expect(p).toContain('ตอนนี้ลูกค้าไม่ได้บอกว่า');   // the ❌ example from s33-t0
    expect(p).toMatch(/ห้ามเกริ่น[^\n]*รับทราบค่ะ/);
  });
  it('namecard: both prices stay on one 💰 line even with a quantity; box-count soft-ask is an ask', () => {
    expect(p).toContain('กล่องละ X × 2 = Y บาท');
    expect(p).toContain('ห้ามแยกบรรทัดต่อแบบ');
    expect(namecard).toContain('บอกจำนวนกล่องได้เลย');
    expect(namecard).toMatch(/ถือเป็นการถามจำนวน/);
    expect(namecard).not.toMatch(/\d{2,} ?บาท/);
  });
  it('brochure with type + qty known never asks gram/colour/sides (worked example from s69)', () => {
    expect(p).toContain('อาร์ตมัน');
    expect(p).toMatch(/อาร์ตมัน[^\n]*Art 120/);
  });
  it('"ระบบ" joins the internal-vocabulary ban; dash bullets are markdown', () => {
    expect(p).toContain('คำว่า "ระบบ"');
    expect(p).toContain('ขีด "-" ต้นบรรทัด');
  });
  it('prompt grew by at most ~30 lines', () => {
    expect(p.split('\n').length).toBeLessThanOrEqual(185);
  });
});

describe('customer prompt — round-2 v3 fixes (2026-11-05)', () => {
  const ready = p.split('## ⭐ เกณฑ์ "ครบพอตีราคา"')[1]?.split('\n## ')[0] ?? '';
  const lead = p.split('## ลูกค้าถามเวลาผลิต / ค่าส่ง')[1]?.split('\n## ')[0] ?? '';
  const namecard = p.split('## นามบัตร — กฎเฉพาะ')[1]?.split('\n## ')[0] ?? '';

  it('art-paper-without-gram default is scoped to single-sheet brochures only', () => {
    expect(ready).toMatch(/ใบปลิว[^\n]*อาร์ตมัน[^\n]*Art 120|อาร์ตมัน[^\n]*Art 120[^\n]*ใบปลิว/);
    expect(ready).toMatch(/Art 120[^\n]*(ไม่ใช้กับ|ยกเว้น)[^\n]*(งานเล่ม|หนังสือ)/);
  });
  it('a bound job described as "แบบเล่ม … เคลือบมัน" still asks the inner gram (worked example from s75-t0)', () => {
    expect(ready).toMatch(/แบบเล่ม[^\n]*เคลือบมัน[^\n]*ถาม[^\n]*แกรม/);
    expect(ready).toContain('โบรชัวร์แบบเล่ม');
    expect(ready).toMatch(/แบบเล่ม[^\n]*(= |คือ)?หนังสือ/);
  });
  it('lead-time sentence is used only when the customer asks', () => {
    expect(lead).toMatch(/เฉพาะเมื่อลูกค้าถาม/);
    expect(lead).toMatch(/ไม่ได้ถาม[^\n]*ห้ามใส่/);
  });
  it('namecard replies never mention box counts, even as an explanation', () => {
    expect(namecard).toMatch(/ห้ามพูดถึง[^\n]*จำนวนกล่อง/);
    expect(namecard).toContain('คิดตามจำนวนกล่องของแต่ละแบบ');
    expect(namecard).not.toMatch(/\d{2,} ?บาท/);
  });
  it('prompt stays within the cap', () => {
    expect(p.split('\n').length).toBeLessThanOrEqual(185);
  });
});

describe('customer prompt — final-review pins (2026-11-05)', () => {
  it('binding hand-off exception list keeps ขอบกาว', () => {
    expect(p).toMatch(/นอกจาก[^\n]*ขอบกาว/);
  });
});
