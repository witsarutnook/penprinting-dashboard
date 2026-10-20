// tests/ai-quote-customer-triggers.test.ts
import { describe, it, expect } from 'vitest';
import {
  detectHumanRequest, detectOrderIntent, detectCustomerEscalation,
  ROUNDS_NO_QUOTE_LIMIT, CUSTOMER_REPLY, TRIGGER_LABEL, CALENDAR_KIND_ASK, HINT_TEXT, HINT_QUICK_REPLY,
  detectPriceTableTopic, hintQuickReply, SEEDED_EXIT_HINT,
} from '@/lib/ai-quote/customer-triggers';
import { INTRO_PRODUCTS, INTRO_TEXT_SHORT } from '@/lib/ai-quote/intro-flex';

describe('detectHumanRequest (trigger ① — checked before the engine call)', () => {
  it.each(['ขอคุยกับพนักงานค่ะ', 'คุยกับคนได้มั้ย', 'ติดต่อทีมงานหน่อย', 'ขอสายแอดมิน'])('fires on %s', (t) => {
    expect(detectHumanRequest(t)).toBe(true);
  });
  it('does not fire on a normal spec message', () => {
    expect(detectHumanRequest('โบรชัวร์ A4 1000 ใบ')).toBe(false);
  });
});

describe('detectOrderIntent (trigger ④ — Type B, needs an existing quote)', () => {
  it.each(['สั่งเลยค่ะ', 'ตกลงสั่งตามนี้', 'ยืนยันสั่งทำ', 'เอาตามนี้เลย'])('fires on %s', (t) => {
    expect(detectOrderIntent(t)).toBe(true);
  });
  it('does not fire on a price question', () => {
    expect(detectOrderIntent('ราคาเท่าไหร่คะ')).toBe(false);
  });
  it('does not fire on a spec sentence that merely mentions ordering', () => {
    // "สั่งพิมพ์/จะสั่ง" โผล่ในประโยคบอกสเปกงานปกติ — ห้ามนับเป็นการยืนยันสั่ง
    expect(detectOrderIntent('อยากสั่งพิมพ์โบรชัวร์ 1000 ใบ')).toBe(false);
    expect(detectOrderIntent('ถ้าจะสั่งเพิ่มอีกแบบ ราคาเท่าไหร่คะ')).toBe(false);
  });
});

describe('detectCustomerEscalation (trigger ② — pinned hand-off phrase)', () => {
  it('fires when no quote + the reply contains ส่งต่อทีมงาน', () => {
    expect(detectCustomerEscalation(0, 'งานกล่องขอส่งต่อทีมงานประเมินให้นะคะ')).toBe(true);
  });
  it('does NOT fire on the price disclaimer (ทีมงานยืนยันราคา) when a quote exists', () => {
    expect(detectCustomerEscalation(1, 'ราคา 5 บาท — ราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ')).toBe(false);
  });
  it('does NOT fire on a clarify question without the pinned phrase', () => {
    expect(detectCustomerEscalation(0, 'ขอทราบจำนวนที่ต้องการพิมพ์ค่ะ')).toBe(false);
  });
});

describe('canned copy', () => {
  it('rounds limit is 4 (spec D3)', () => {
    expect(ROUNDS_NO_QUOTE_LIMIT).toBe(4);
  });
  it('every canned reply is polite customer Thai (ค่ะ/นะคะ)', () => {
    for (const text of Object.values(CUSTOMER_REPLY)) expect(text).toMatch(/ค่ะ|นะคะ/);
  });
  it('trigger labels cover all four triggers', () => {
    expect(Object.keys(TRIGGER_LABEL).sort()).toEqual(['human', 'order_intent', 'out_of_scope', 'rounds']);
  });
  it('intro explains scope + how to exit', () => {
    expect(INTRO_PRODUCTS.map((p) => p.text)).toContain('ใบปลิว/โบรชัวร์');
    expect(INTRO_TEXT_SHORT).toContain('ออก');
  });
  it('intro + hint scope lists include นามบัตร (added 2026-07-13)', () => {
    expect(INTRO_PRODUCTS.map((p) => p.text)).toContain('นามบัตร');
    expect(HINT_TEXT).toContain('นามบัตร');
  });
  it('intro + hint introduce the AI as น้อง PP (persona 2026-07-13)', () => {
    expect(INTRO_TEXT_SHORT).toContain('น้อง PP');
    expect(HINT_TEXT).toContain('น้อง PP');
  });
  it('CALENDAR_KIND_ASK is the pinned popular-3 question (prompt + bubble share it) and is not a hand-off', () => {
    expect(CALENDAR_KIND_ASK).toContain('แบบที่นิยมมี 3 แบบ');
    expect(CALENDAR_KIND_ASK).toBe('ทำได้ค่ะ 😊 แบบที่นิยมมี 3 แบบ: ปฏิทินจีน · ตั้งโต๊ะ 6x8 นิ้ว · แขวน รับแบบไหนดีคะ (ขนาดอื่นนอกจากนี้ ทีมงานคุยรายละเอียดให้ค่ะ)');
    expect(detectCustomerEscalation(0, CALENDAR_KIND_ASK)).toBe(false);
  });
  it('hint quick-reply sends an enter keyword (bare — gate "/" reverted 2026-07-17)', () => {
    expect(HINT_QUICK_REPLY.text).toBe('ขอราคา AI');
    expect(HINT_TEXT).toContain('ทีมงาน');
  });
});

describe('price-table topics (calendar / PVC)', () => {
  it.each([['บัตร PVC ราคาเท่าไหร่', 'pvc'], ['ทำบัตรพีวีซีไหม', 'pvc'], ['ปฏิทินแขวน 500 ชุด', 'calendar'], ['อยากได้ปฏิทินกับบัตร pvc', 'pvc'], ['โบรชัวร์ A4', 'null']])('detectPriceTableTopic(%s) → %s', (t, want) => {
    expect(String(detectPriceTableTopic(t))).toBe(want);
  });
  it('hintQuickReply labels fit the LINE 20-char limit and carry the AI token', () => {
    for (const topic of ['pvc', 'calendar', null] as const) {
      const q = hintQuickReply(topic);
      expect(Array.from(q.label).length).toBeLessThanOrEqual(20);
      expect(q.text).toMatch(/^ขอราคา AI/);
    }
    expect(hintQuickReply(null)).toEqual(HINT_QUICK_REPLY);
  });
  it('intro + hint list the two new products', () => {
    const intro = INTRO_PRODUCTS.map((p) => p.text);
    expect(intro).toContain('ปฏิทิน');
    expect(intro).toContain('บัตร PVC');
    expect(HINT_TEXT).toContain('ปฏิทิน');
    expect(HINT_TEXT).toContain('บัตร PVC');
  });
  it('SEEDED_EXIT_HINT tells the customer how to leave', () => {
    expect(SEEDED_EXIT_HINT).toBe("(พิมพ์ 'ออก' เมื่อต้องการกลับไปคุยกับทีมงานค่ะ)");
  });
});
