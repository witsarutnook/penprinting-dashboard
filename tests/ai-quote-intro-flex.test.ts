// tests/ai-quote-intro-flex.test.ts
import { describe, it, expect } from 'vitest';
import {
  INTRO_PRODUCTS, INTRO_TEXT_SHORT, INTRO_QUICK_REPLIES, buildIntroFlex,
  CALENDAR_KINDS, CALENDAR_KIND_QUICK_REPLIES, buildCalendarKindFlex,
  isCalendarKindAsk, isCalendarButtonText,
} from '@/lib/ai-quote/intro-flex';
import { CALENDAR_KIND_ASK } from '@/lib/ai-quote/customer-triggers';

type FlexNode = { type: string; contents?: FlexNode[]; action?: { type: string; label: string; text: string }; [k: string]: unknown };

/** Depth-first collect of every `button` node in a flex message (header/body/footer). */
function buttonsOf(flex: Record<string, unknown>): FlexNode[] {
  const out: FlexNode[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    const node = n as FlexNode;
    if (node.type === 'button') out.push(node);
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(flex.contents);
  return out;
}

const cp = (s: string) => Array.from(s).length;

describe('INTRO_PRODUCTS', () => {
  it('lists the 6 products in order, emoji only in the label', () => {
    expect(INTRO_PRODUCTS).toEqual([
      { label: '📄 ใบปลิว/โบรชัวร์', text: 'ใบปลิว/โบรชัวร์' },
      { label: '📚 หนังสือ', text: 'หนังสือ' },
      { label: '📓 สมุด', text: 'สมุด' },
      { label: '🪪 นามบัตร', text: 'นามบัตร' },
      { label: '📅 ปฏิทิน', text: 'ปฏิทิน' },
      { label: '💳 บัตร PVC', text: 'บัตร PVC' },
    ]);
  });
});

describe('INTRO_QUICK_REPLIES (Messenger chips)', () => {
  it('mirrors INTRO_PRODUCTS, every label fits 20 code points', () => {
    expect(INTRO_QUICK_REPLIES).toEqual(INTRO_PRODUCTS.map((p) => ({ label: p.label, text: p.text })));
    for (const q of INTRO_QUICK_REPLIES) expect(cp(q.label)).toBeLessThanOrEqual(20);
  });
});

describe('INTRO_TEXT_SHORT', () => {
  it('is the exact short intro (persona + how to leave + estimate disclaimer)', () => {
    expect(INTRO_TEXT_SHORT).toBe(
      'สวัสดีค่ะ 🤖 น้อง PP ผู้ช่วยประเมินราคาของ Penprinting ค่ะ\n' +
      'เลือกชนิดงานด้านล่าง หรือพิมพ์สเปกมาเลย เช่น "ใบปลิว A4 1,000 ใบ"\n' +
      'พิมพ์ "ออก" เมื่อต้องการกลับไปคุยกับทีมงาน · ราคาประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ',
    );
  });
});

describe('buildIntroFlex', () => {
  const flex = buildIntroFlex();

  it('is a LINE flex message whose altText is the short intro', () => {
    expect(flex.type).toBe('flex');
    expect(flex.altText).toBe(INTRO_TEXT_SHORT);
    expect(flex.contents).toMatchObject({ type: 'bubble', size: 'mega' });
  });

  it('has 6 primary message-action buttons in INTRO_PRODUCTS order', () => {
    const btns = buttonsOf(flex);
    expect(btns).toHaveLength(6);
    btns.forEach((b, i) => {
      expect(b).toMatchObject({ type: 'button', style: 'primary', color: '#c8553d', height: 'sm' });
      expect(b.action).toEqual({ type: 'message', label: INTRO_PRODUCTS[i].label, text: INTRO_PRODUCTS[i].text });
    });
  });

  it('lays the buttons out as 3 horizontal rows of 2', () => {
    const body = (flex.contents as { body: FlexNode }).body;
    const rows = (body.contents ?? []).filter((n) => n.type === 'box' && n.layout === 'horizontal');
    expect(rows).toHaveLength(3);
    for (const r of rows) expect((r.contents ?? []).filter((n) => n.type === 'button')).toHaveLength(2);
  });

  it('carries the brand header and the 3-line muted footer', () => {
    const json = JSON.stringify(flex);
    expect(json).toContain('น้อง PP');
    expect(json).toContain('ผู้ช่วยประเมินราคา Penprinting');
    expect(json).toContain('สวัสดีค่ะ เลือกชนิดงานที่ต้องการขอราคาได้เลยค่ะ');
    const footer = (flex.contents as { footer: FlexNode }).footer;
    const lines = (footer.contents ?? []).filter((n) => n.type === 'text');
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toMatchObject({ size: 'xxs', color: '#888780' });
  });

  it('is a pure builder (fresh object each call, same shape)', () => {
    const again = buildIntroFlex();
    expect(again).toEqual(flex);
    expect(again).not.toBe(flex);
  });
});

describe('CALENDAR_KINDS', () => {
  it('has the 3 popular kinds; button label is short, sent text names the product', () => {
    expect(CALENDAR_KINDS).toEqual([
      { label: 'ปฏิทินจีน', text: 'ปฏิทินจีน' },
      { label: 'ตั้งโต๊ะ 6x8 นิ้ว', text: 'ปฏิทินตั้งโต๊ะ 6x8 นิ้ว' },
      { label: 'แขวน', text: 'ปฏิทินแขวน' },
    ]);
  });
  it('quick replies mirror the kinds and fit 20 code points', () => {
    expect(CALENDAR_KIND_QUICK_REPLIES).toEqual(CALENDAR_KINDS.map((k) => ({ label: k.label, text: k.text })));
    for (const q of CALENDAR_KIND_QUICK_REPLIES) expect(cp(q.label)).toBeLessThanOrEqual(20);
  });
});

describe('buildCalendarKindFlex', () => {
  it('is a small bubble with exactly 3 primary buttons sending the kind texts', () => {
    const flex = buildCalendarKindFlex('x');
    expect(flex.type).toBe('flex');
    expect(flex.contents).toMatchObject({ type: 'bubble', size: 'kilo' });
    const btns = buttonsOf(flex);
    expect(btns.map((b) => b.action?.text)).toEqual(['ปฏิทินจีน', 'ปฏิทินตั้งโต๊ะ 6x8 นิ้ว', 'ปฏิทินแขวน']);
    for (const b of btns) expect(b).toMatchObject({ style: 'primary', color: '#c8553d', action: { type: 'message' } });
  });
  it('shows the given text wrapped in the body and uses it as altText', () => {
    const flex = buildCalendarKindFlex(CALENDAR_KIND_ASK);
    expect(flex.altText).toBe(CALENDAR_KIND_ASK);
    const body = (flex.contents as { body: FlexNode }).body;
    const text = (body.contents ?? []).find((n) => n.type === 'text');
    expect(text).toMatchObject({ text: CALENDAR_KIND_ASK, wrap: true });
  });
});

describe('isCalendarKindAsk', () => {
  it('matches the pinned popular-3 sentence, with or without the seeded exit hint', () => {
    expect(isCalendarKindAsk(CALENDAR_KIND_ASK)).toBe(true);
    expect(isCalendarKindAsk(`${CALENDAR_KIND_ASK}\n\n(พิมพ์ 'ออก' เมื่อต้องการกลับไปคุยกับทีมงานค่ะ)`)).toBe(true);
  });
  it('does not match a price reply or an unrelated question', () => {
    expect(isCalendarKindAsk('ปฏิทินแขวน 500 ชุด ราคา ~45.00 บ./ชุด ทีมงานยืนยันราคาอีกครั้งค่ะ')).toBe(false);
    expect(isCalendarKindAsk('ขอทราบจำนวนที่ต้องการพิมพ์ค่ะ')).toBe(false);
  });
});

describe('isCalendarButtonText', () => {
  it.each(['ปฏิทิน', '📅 ปฏิทิน', ' ปฏิทิน ', '📅ปฏิทิน'])('%j → true', (t) => {
    expect(isCalendarButtonText(t)).toBe(true);
  });
  it.each(['ปฏิทินแขวน', 'ทำปฏิทินไหม', 'ปฏิทิน 500 ชุด', 'ปฏิทินจีน'])('%j → false', (t) => {
    expect(isCalendarButtonText(t)).toBe(false);
  });
});
