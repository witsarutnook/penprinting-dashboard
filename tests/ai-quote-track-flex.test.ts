// tests/ai-quote-track-flex.test.ts
import { describe, it, expect } from 'vitest';
import { isTrackCommand, extractOrderId, buildOrderFlex } from '@/lib/ai-quote/track-flex';

describe('track command detection', () => {
  it('matches /track and track with 6+ digits', () => {
    expect(isTrackCommand('/track 202606110')).toBe(true);
    expect(isTrackCommand('track 202606110')).toBe(true);
    expect(isTrackCommand('  /TRACK   202606110 ')).toBe(true);
    expect(extractOrderId('/track 202606110')).toBe('202606110');
  });
  it('rejects non-track text and short numbers', () => {
    expect(isTrackCommand('ขอราคาใบปลิว')).toBe(false);
    expect(isTrackCommand('track 123')).toBe(false);
    expect(extractOrderId('track 123')).toBe(null);
  });
});

describe('buildOrderFlex', () => {
  it('returns a text bubble when order not found (state=null)', () => {
    const flex = buildOrderFlex('999999', null);
    expect(JSON.stringify(flex)).toContain('ไม่พบใบสั่งงาน');
  });
  it('returns a flex bubble with the order name + masked customer when found', () => {
    const flex = buildOrderFlex('202606110', {
      order: { name: 'นามบัตรคุณเอ', customer: 'บริษัท เอบีซี', dateIn: '01/06/2026', dateDue: '10/06/2026' },
      job: { dept: 'print', date: '10/06/2026' },
      shipped: null, cancelled: null,
    });
    const s = JSON.stringify(flex);
    expect(flex.type).toBe('flex');
    expect(s).toContain('นามบัตรคุณเอ');
    expect(s).toContain('202606110');
    expect(s).not.toContain('บริษัท เอบีซี'); // masked
  });
  it('renders the cancellation reason box for a cancelled order', () => {
    const flex = buildOrderFlex('202601010', {
      order: { name: 'งานยกเลิก', customer: 'ลูกค้า', dateIn: '01/01/2026', dateDue: '05/01/2026' },
      job: { dept: 'graphic', date: '05/01/2026' },
      shipped: null, cancelled: { reason: 'ลูกค้ายกเลิก' },
    });
    expect(JSON.stringify(flex)).toContain('ลูกค้ายกเลิก');
  });
  it('renders a shipped order as delivered', () => {
    const flex = buildOrderFlex('202606111', {
      order: { name: 'งานส่งแล้ว', customer: 'ลูกค้า', dateIn: '01/06/2026', dateDue: '10/06/2026' },
      job: { dept: 'post', date: '10/06/2026' },
      shipped: {}, cancelled: null,
    });
    expect(JSON.stringify(flex)).toContain('จัดส่งเรียบร้อยแล้ว');
  });
  it('shows an overdue day-hint for a past due date', () => {
    const flex = buildOrderFlex('202601020', {
      order: { name: 'งานเลยกำหนด', customer: 'ลูกค้า', dateIn: '01/01/2020', dateDue: '05/01/2020' },
      job: { dept: 'print', date: '05/01/2020' },
      shipped: null, cancelled: null,
    });
    expect(JSON.stringify(flex)).toContain('เลยกำหนด');
  });
});
