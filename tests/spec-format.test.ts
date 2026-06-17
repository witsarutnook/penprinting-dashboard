import { describe, it, expect } from 'vitest';
import { buildSpecSections } from '@/lib/spec-format';

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
