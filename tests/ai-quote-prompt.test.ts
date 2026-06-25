// tests/ai-quote-prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, VALID_PAPER_NAMES } from '@/lib/ai-quote/prompt';

describe('buildSystemPrompt', () => {
  const p = buildSystemPrompt();
  it('lists every valid paper name', () => {
    for (const name of VALID_PAPER_NAMES) expect(p).toContain(name);
  });
  it('states the D4 price rule (per-piece, before VAT, no rounding)', () => {
    expect(p).toContain('ต่อชิ้น');
    expect(p).toContain('ยังไม่รวม VAT');
  });
  it('forbids guessing prices and mandates the tool', () => {
    expect(p).toContain('compute_quote');
    expect(p).toMatch(/ห้ามเดาราคา|ห้ามบอกราคาเอง/);
  });
  it('instructs escalation for out-of-scope work', () => {
    expect(p).toContain('กล่อง');
    expect(p).toMatch(/escalate|ทีมงาน/);
  });
});

describe('buildSystemPrompt — clarify defaults (assume-and-disclose)', () => {
  const p = buildSystemPrompt();

  it('documents a default-values section', () => {
    expect(p).toContain('ค่ามาตรฐาน');
  });

  it('defaults brochure size/color/sides/paper (A4 · 4 สี · 2 หน้า · Art 120)', () => {
    expect(p).toContain('A4');
    expect(p).toContain('4 สี');
    expect(p).toContain('2 หน้า');
    expect(p).toContain('Art 120');
  });

  it('defaults book/notebook size to A5 with a single inner set (innerB=0)', () => {
    expect(p).toContain('A5');
    expect(p).toMatch(/innerB[^\n]*0|เนื้อในชุดเดียว/);
  });

  it('always asks for un-guessable fields (qty + book/notebook page count)', () => {
    expect(p).toMatch(/จำนวน|กี่/);   // qty always asked
    expect(p).toContain('จำนวนหน้า');  // book/notebook pages never defaulted
  });

  it('batches missing-field questions instead of one-at-a-time drip', () => {
    expect(p).toMatch(/ถามรวม|ครั้งเดียว/);
  });

  it('mandates stating assumptions when defaults are applied', () => {
    expect(p).toMatch(/สมมติฐาน|ประเมินจาก/);
  });

  it('still escalates a named-but-unknown paper rather than defaulting it', () => {
    expect(p).toMatch(/กระดาษพิเศษ|นอกรายการ/);
  });

  it('hard-rules that a brochure with qty is "enough to quote" (do not ask)', () => {
    expect(p).toContain('ครบพอตีราคา');
    expect(p).toMatch(/ห้ามถาม[^]*โบรชัวร์|โบรชัวร์[^]*ห้ามถาม/);
  });

  it('includes a worked brochure example that quotes instead of asking', () => {
    expect(p).toContain('ใบปลิว 1000');
    expect(p).toContain('✅');
    expect(p).toContain('❌');
  });
});

describe('buildSystemPrompt — book cover color default + "ทั้งเล่ม" rule', () => {
  const p = buildSystemPrompt();

  it('defaults book/notebook cover color to 4 สี', () => {
    expect(p).toContain('สีปก = 4 สี');
  });

  it('no longer lists cover color in the always-ask section', () => {
    // old combined token "สีปก/สีเนื้อใน" is gone — cover is now defaulted
    expect(p).not.toContain('สีปก/สีเนื้อใน');
  });

  it('still always-asks inner color (the variable price-mover)', () => {
    expect(p).toMatch(/ถามเพิ่ม:[^]*สีเนื้อใน/);
  });

  it('documents the "X สีทั้งเล่ม" rule (sets both cover + inner)', () => {
    expect(p).toContain('ทั้งเล่ม');
  });

  it('includes a worked book example that does NOT re-ask cover color', () => {
    expect(p).toContain('4 สีทั้งเล่ม');
    expect(p).toContain('✅');
    expect(p).toContain('❌');
  });

  it('book "enough to quote" criteria requires inner color, not bare color', () => {
    // line 42 must read "...กระดาษเนื้อใน + สีเนื้อใน" — cover color is defaulted,
    // so it must NOT be part of the completeness gate (else Haiku re-asks it)
    expect(p).toContain('กระดาษเนื้อใน + สีเนื้อใน');
  });
});

describe('buildSystemPrompt — book cover paper default (Art 230)', () => {
  const p = buildSystemPrompt();

  it('defaults book/notebook cover paper to Art 230', () => {
    expect(p).toContain('กระดาษปก = Art 230');
  });

  it('drops cover paper from the always-ask "ถามเพิ่ม" line', () => {
    expect(p).not.toMatch(/ถามเพิ่ม:[^\n]*กระดาษปก/);
  });

  it('cover paper no longer gates "ครบพอตีราคา"', () => {
    expect(p).toContain('qty + จำนวนหน้า + กระดาษเนื้อใน + สีเนื้อใน');
  });
});

describe('buildSystemPrompt — cover color hard-rule (Haiku hardening)', () => {
  const p = buildSystemPrompt();

  it('hard-rules that cover color is never asked', () => {
    expect(p).toContain('ห้ามถามสีปกเด็ดขาด');
  });

  it('has a worked example where inner is B&W but cover stays defaulted', () => {
    // Haiku regresses here: inner ขาวดำ → it asks about cover. The example must
    // show NOT asking cover (default 4 สี) even when inner color differs.
    expect(p).toContain('เนื้อในขาวดำ');
  });
});

describe('buildSystemPrompt — colloquial paper-name alias (อาร์ทการ์ด)', () => {
  const p = buildSystemPrompt();

  it('maps อาร์ทการ์ด 210/230 to the Art paper line (no Art Card at those weights)', () => {
    expect(p).toContain('230 → Art 230');
    expect(p).toContain('210 → Art 210');
  });

  it('keeps อาร์ทการ์ด 300/350 on the distinct Art Card stock', () => {
    expect(p).toContain('300 → Art Card 300');
    expect(p).toContain('350 → Art Card 350');
  });

  it('uses a customer-specified in-list paper directly, even when it differs from the default', () => {
    // Haiku regression: it treated Art 210 (a valid list paper) as "พิเศษ"
    // just because the cover default is Art 230. A specified in-list paper is
    // NOT special — "กระดาษพิเศษ" means not-in-list, not not-the-default.
    expect(p).toContain('แต่ลูกค้าขอ Art 210');
    expect(p).toContain('ไม่ใช่ "ไม่ตรง default"');
  });
});
