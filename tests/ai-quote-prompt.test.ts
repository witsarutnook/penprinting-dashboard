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
});
