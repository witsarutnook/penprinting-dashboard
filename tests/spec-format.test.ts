import { describe, it, expect } from 'vitest';
import { buildSpecSections, specLabel } from '@/lib/spec-format';

/** Find the "อื่นๆ" section's resolved entries. */
function otherEntries(raw: Record<string, unknown>) {
  const sections = buildSpecSections(raw, false);
  return sections.find((s) => s.title === 'อื่นๆ')?.entries ?? [];
}

describe('buildSpecSections — อื่นๆ staff fields', () => {
  it('renders กราฟฟิก (assignStaff) resolved to the graphic staff name', () => {
    const entries = otherEntries({ orderer: 'นุ๊ก', assignStaff: 'pook', forwardPrint: 'sm74' });
    const graphic = entries.find((e) => e.key === 'assignStaff');
    expect(graphic).toBeDefined();
    expect(graphic!.label).toBe('กราฟฟิก');
    expect(graphic!.display).toBe('ปุ๊ก'); // pook → ปุ๊ก (not the raw romanized id)
  });

  it('renders ส่งต่อพิมพ์ (forwardPrint) resolved to the print staff name', () => {
    const entries = otherEntries({ orderer: 'นุ๊ก', forwardPrint: 'sm74' });
    const fwd = entries.find((e) => e.key === 'forwardPrint');
    expect(fwd).toBeDefined();
    expect(fwd!.label).toBe('ส่งต่อพิมพ์');
    expect(fwd!.display).toBe('SM74 (ต้อม)'); // sm74 → full press name (was raw "sm74")
  });

  it('orders the อื่นๆ rows as ผู้สั่งงาน → กราฟฟิก → ส่งต่อพิมพ์', () => {
    const entries = otherEntries({ orderer: 'นุ๊ก', assignStaff: 'pook', forwardPrint: 'sm74' });
    expect(entries.map((e) => e.key)).toEqual(['orderer', 'assignStaff', 'forwardPrint']);
  });

  it('omits the กราฟฟิก row when no graphic assigned (straight to print)', () => {
    const entries = otherEntries({ orderer: 'นุ๊ก', assignStaff: '', forwardPrint: 'sm74' });
    expect(entries.find((e) => e.key === 'assignStaff')).toBeUndefined();
    expect(entries.find((e) => e.key === 'forwardPrint')).toBeDefined();
  });

  it('falls back to the raw id for an unknown staff id', () => {
    const entries = otherEntries({ assignStaff: 'ghost', forwardPrint: 'sm74' });
    expect(entries.find((e) => e.key === 'assignStaff')!.display).toBe('ghost');
  });
});

describe('binding labels match the order form and the printed A4', () => {
  it('box 4 (spine) is กระดูกงู; sew is เย็บกี่', () => {
    const binding = buildSpecSections({ spine: true, sew: true }, false).find((s) => s.title === 'เข้าเล่ม');
    expect(binding?.entries.map((e) => [e.key, e.label])).toEqual([['sew', 'เย็บกี่'], ['spine', 'กระดูกงู']]);
    expect(specLabel('spine')).toBe('กระดูกงู');
  });
});

// Audit 2026-11-27 (M5-notes-newlines-collapsed). An order opened by /order keeps the quotation
// text in its notes, one spec per line. The value reaches the two spec views (board card detail,
// /orders modal) with its line breaks — they must be shown (`whitespace-pre-line` on the value),
// not folded into one run-on paragraph.
describe('buildSpecSections — multi-line notes', () => {
  const NOTES = 'กระดาษคาร์บอน 2 ชั้น (ขาวบน, ขาวล่าง)\nพิมพ์ สีเดียว (ฟ้า)\nกล่องละ 1,000 ชุด\n\nอ้างอิง Peak: QO-20261100157';

  it('the notes value keeps every line break, the blank line before the Peak reference too', () => {
    const sections = buildSpecSections({ name: 'ใบเสร็จรับเงิน', notes: NOTES }, false);
    const notes = sections.flatMap((x) => x.entries).find((e) => e.key === 'notes');
    expect(notes?.display).toBe(NOTES);
    expect(notes?.display.split('\n')).toHaveLength(5);
  });
});

