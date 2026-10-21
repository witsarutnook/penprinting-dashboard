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
  it('shows the shipped date on the final step, matching the web /track', () => {
    // L6: web /track prints "จัดส่งเรียบร้อยแล้ว (DD/MM/YYYY)" on step 6; the LINE
    // card used to print the bare label even when shippedDate was known.
    const flex = buildOrderFlex('202606112', {
      order: { name: 'งานส่งแล้วมีวันที่', customer: 'ลูกค้า', dateIn: '01/06/2026', dateDue: '10/06/2026' },
      job: { dept: 'post', date: '10/06/2026' },
      shipped: { shippedDate: '15/6/2026' },
      cancelled: null,
    });
    expect(JSON.stringify(flex)).toContain('จัดส่งเรียบร้อยแล้ว (15/06/2026)');
  });
  it('omits the date when the shipped row has none', () => {
    const flex = buildOrderFlex('202606113', {
      order: { name: 'งานส่งแล้วไม่มีวันที่', customer: 'ลูกค้า', dateIn: '01/06/2026', dateDue: '10/06/2026' },
      job: { dept: 'post', date: '10/06/2026' },
      shipped: {},
      cancelled: null,
    });
    const s = JSON.stringify(flex);
    expect(s).toContain('จัดส่งเรียบร้อยแล้ว');
    // No "(—)" / "()" suffix when there is no date to show.
    expect(s).not.toContain('จัดส่งเรียบร้อยแล้ว (');
  });
  it('renders the shipping queue (dept=post, staff=ship) as "สินค้าพร้อมรับ"', () => {
    // Regression: the card used to stop at "ขั้นตอนหลังพิมพ์" while /track
    // already showed "สินค้าพร้อมรับ" for the same order (2026-09-17).
    const flex = buildOrderFlex('202609034', {
      order: { name: 'กล่องกาแฟ AA', customer: 'บริษัท เอบีซี', dateIn: '05/09/2026', dateDue: '12/09/2026' },
      job: { dept: 'post', staff: 'ship', date: '12/09/2026' },
      shipped: null, cancelled: null,
    });
    const s = JSON.stringify(flex);
    expect(flex.altText).toContain('สินค้าพร้อมรับ');
    // Post-press step is done (green check), pickup step is the current one.
    expect(s).toContain('"text":"✓","color":"#059669"');
    expect(s).toContain('"text":"●","color":"#1d4ed8"');
  });
  it('keeps "ขั้นตอนหลังพิมพ์" while post-press staff is not the ship queue', () => {
    const flex = buildOrderFlex('202609035', {
      order: { name: 'กล่องกาแฟ BB', customer: 'บริษัท เอบีซี', dateIn: '05/09/2026', dateDue: '12/09/2026' },
      job: { dept: 'post', staff: 'post1', date: '12/09/2026' },
      shipped: null, cancelled: null,
    });
    expect(flex.altText).toContain('ขั้นตอนหลังพิมพ์');
  });
  it('shows an overdue day-hint for a past due date', () => {
    const flex = buildOrderFlex('202601020', {
      order: { name: 'งานเลยกำหนด', customer: 'ลูกค้า', dateIn: '01/01/2020', dateDue: '05/01/2020' },
      job: { dept: 'print', date: '05/01/2020' },
      shipped: null, cancelled: null,
    });
    expect(JSON.stringify(flex)).toContain('เลยกำหนด');
  });
  it('renders legacy Sheet-era dates through the shared displayDatePadded parser', () => {
    // L4: the card used to print the quote-wrapped ISO string raw and could pick a
    // different day from the web /track. Both now go through displayDatePadded.
    const flex = buildOrderFlex('202605070', {
      order: { name: 'งานเก่า', customer: 'ลูกค้า', dateIn: '"2026-05-07T17:00:00.000Z"', dateDue: '21/4/2026 10:00' },
      job: { dept: 'print', date: '21/4/2026 10:00' },
      shipped: null, cancelled: null,
    });
    const s = JSON.stringify(flex);
    expect(s).toContain('08/05/2026');
    expect(s).toContain('21/04/2026');
    expect(s).not.toContain('"2026-05-07');
    expect(s).not.toContain('2026-05-07T17');
  });
  it('empty dates render as — (same as web /track)', () => {
    const flex = buildOrderFlex('202605071', {
      order: { name: 'งานไม่มีวันที่', customer: 'ลูกค้า', dateIn: '', dateDue: undefined },
      job: { dept: 'print' },
      shipped: null, cancelled: null,
    });
    const s = JSON.stringify(flex);
    // Assert on the two date value nodes (size "sm"), not a bare '—': altText
    // already contains an em dash, which would make this pass vacuously.
    expect(s.match(/"text":"—","size":"sm"/g) ?? []).toHaveLength(2);
    expect(s).not.toContain('"text":"-","size":"sm"');
  });
});
