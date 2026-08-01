import { describe, it, expect } from 'vitest';
import { computeMonthlyReport } from '@/lib/analytics';
import { photobookRowSummary } from '@/lib/photobook';
import type { LoadAllResponse, Order } from '@/lib/types';

function order(id: number, partial: Partial<Order> = {}): Order {
  return {
    id, name: `order-${id}`, customer: 'CustA', dateIn: '15/06/2026', dateDue: '',
    price: 0, assignDept: 'graphic', assignStaff: 'mo', orderer: '', status: 'sent',
    ...partial,
  };
}

function loadAll(orders: Order[]): LoadAllResponse {
  return { jobs: [], orders, shipped: [], cancelled: [], audit: [], nextId: 1, templates: [] };
}

describe('computeMonthlyReport — dept rows', () => {
  it('normal order keeps size/qty from top-level rawData', () => {
    const data = loadAll([
      order(202606001, { rawData: { size: 'A4', sizeUnit: 'ซม.', qty: '100', qtyUnit: 'แผ่น' } }),
    ]);
    const report = computeMonthlyReport(data, 2026, 6);
    const row = report.perDept.graphic.rows.find((r) => r.orderId === 202606001);
    expect(row).toBeDefined();
    expect(row!.size).toBe('A4 ซม.');
    expect(row!.qty).toBe('100 แผ่น');
  });

  it('photobook order derives size/qty from photobook items (canonical key)', () => {
    const data = loadAll([
      order(202606002, {
        rawData: {
          orderType: 'photobook',
          photobook: [
            { size: '8"x8"', binding: 'ปกแข็ง', qty: '2', special: '' },
            { size: 'A3', binding: 'ปกอ่อน', qty: '3', special: '' },
          ],
        },
      }),
    ]);
    const report = computeMonthlyReport(data, 2026, 6);
    const row = report.perDept.graphic.rows.find((r) => r.orderId === 202606002);
    expect(row).toBeDefined();
    expect(row!.size).toBe('8"x8", A3');
    expect(row!.qty).toBe('5 เล่ม');
  });

  it('photobook order reads legacy photobookItems key too', () => {
    const data = loadAll([
      order(202606003, {
        rawData: {
          orderType: 'photobook',
          photobookItems: [{ size: '5.5"x5.5"', binding: 'เข้าห่วง', qty: '10', special: '' }],
        },
      }),
    ]);
    const report = computeMonthlyReport(data, 2026, 6);
    const row = report.perDept.graphic.rows.find((r) => r.orderId === 202606003);
    expect(row!.size).toBe('5.5"x5.5"');
    expect(row!.qty).toBe('10 เล่ม');
  });

  it('photobook order with no usable items falls back to "-"', () => {
    const data = loadAll([
      order(202606004, { rawData: { orderType: 'photobook', photobook: [] } }),
    ]);
    const report = computeMonthlyReport(data, 2026, 6);
    const row = report.perDept.graphic.rows.find((r) => r.orderId === 202606004);
    expect(row!.size).toBe('-');
    expect(row!.qty).toBe('-');
  });
});

describe('photobookRowSummary', () => {
  it('returns null for non-photobook rawData', () => {
    expect(photobookRowSummary({ size: 'A4' })).toBeNull();
    expect(photobookRowSummary(null)).toBeNull();
  });

  it('dedupes repeated sizes and sums qty', () => {
    const out = photobookRowSummary({
      orderType: 'photobook',
      photobook: [
        { size: '8"x8"', binding: 'ปกแข็ง', qty: '2', special: '' },
        { size: '8"x8"', binding: 'ปกอ่อน', qty: '1', special: '' },
      ],
    });
    expect(out).toEqual({ size: '8"x8"', qty: '3 เล่ม' });
  });

  it('skips malformed items and non-numeric qty', () => {
    const out = photobookRowSummary({
      orderType: 'photobook',
      photobook: [null, 'x', { size: 'A3', binding: 'ปกแข็ง', qty: 'abc', special: '' }],
    });
    expect(out).toEqual({ size: 'A3', qty: '-' });
  });
});
