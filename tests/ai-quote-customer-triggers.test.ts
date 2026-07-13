// tests/ai-quote-customer-triggers.test.ts
import { describe, it, expect } from 'vitest';
import {
  detectHumanRequest, detectOrderIntent, detectCustomerEscalation,
  ROUNDS_NO_QUOTE_LIMIT, CUSTOMER_REPLY, TRIGGER_LABEL, INTRO_TEXT, HINT_TEXT, HINT_QUICK_REPLY,
} from '@/lib/ai-quote/customer-triggers';

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
    expect(INTRO_TEXT).toContain('โบรชัวร์');
    expect(INTRO_TEXT).toContain('ออก');
  });
  it('intro + hint scope lists include นามบัตร (added 2026-07-13)', () => {
    expect(INTRO_TEXT).toContain('นามบัตร');
    expect(HINT_TEXT).toContain('นามบัตร');
  });
  it('intro + hint introduce the AI as น้อง PP (persona 2026-07-13)', () => {
    expect(INTRO_TEXT).toContain('น้อง PP');
    expect(HINT_TEXT).toContain('น้อง PP');
  });
  it('hint quick-reply sends an enter keyword', () => {
    expect(HINT_QUICK_REPLY.text).toBe('/ขอราคา AI');
    expect(HINT_TEXT).toContain('ทีมงาน');
  });
});
