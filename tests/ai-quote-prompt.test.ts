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
