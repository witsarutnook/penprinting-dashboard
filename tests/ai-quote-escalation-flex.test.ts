// tests/ai-quote-escalation-flex.test.ts
import { describe, it, expect } from 'vitest';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';

const base = {
  trigger: 'human' as const,
  customerName: 'คุณเอ',
  lineUserId: 'U123',
  lastUserText: 'ขอคุยกับพนักงานค่ะ',
  lastQuote: null,
  sessionId: 42,
};

describe('buildEscalationFlex (1b-B §4)', () => {
  it('is a complete flex message with customer name in altText', () => {
    const f = buildEscalationFlex(base);
    expect(f.type).toBe('flex');
    expect(String(f.altText)).toContain('คุณเอ');
  });
  it('falls back to the LINE userId when no display name', () => {
    const f = buildEscalationFlex({ ...base, customerName: null });
    expect(String(f.altText)).toContain('U123');
  });
  it('order_intent uses the Type B (พร้อมสั่ง) header', () => {
    const f = buildEscalationFlex({ ...base, trigger: 'order_intent' });
    expect(JSON.stringify(f)).toContain('พร้อมสั่ง');
  });
  it('includes the last quote line when present', () => {
    const f = buildEscalationFlex({ ...base, lastQuote: { productType: 'brochure', unitPrice: 4.78 } });
    const s = JSON.stringify(f);
    expect(s).toContain('4.78');
    expect(s).toContain('โบรชัวร์');
  });
  it('links to /quote-leads and truncates long messages', () => {
    const f = buildEscalationFlex({ ...base, lastUserText: 'ก'.repeat(300) });
    const s = JSON.stringify(f);
    expect(s).toContain('dashboard.penprinting.co/quote-leads');
    expect(s).toContain('…');
  });
});
