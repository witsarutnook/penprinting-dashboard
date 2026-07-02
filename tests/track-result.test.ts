import { describe, it, expect } from 'vitest';
import { buildTrackResult } from '@/lib/track-result';
import type { Order, Job, Shipped, Cancelled } from '@/lib/types';

// Characterization tests for the /track lookup result-shaping. These pin the
// EXACT output the public route produced before it delegated its status core
// to deriveTrackStatus (Issue #1 refactor — zero behaviour change). Public
// route had no test coverage, which is why the refactor was deferred.

const today = new Date(2026, 6, 1); // 1 Jul 2026 (month 0-indexed)

function mkOrder(over: Partial<Order> = {}): Order {
  return {
    id: 12345,
    name: 'ใบงานทดสอบ',
    customer: 'ABCDE',
    dateIn: '01/06/2026',
    dateDue: '10/07/2026',
    price: 0,
    assignDept: '',
    assignStaff: '',
    orderer: '',
    status: '',
    ...over,
  } as Order;
}

const job = (o: Record<string, unknown>) => o as unknown as Job;

describe('buildTrackResult', () => {
  it('cancelled wins over everything', () => {
    const r = buildTrackResult(
      mkOrder(),
      job({ dept: 'print' }),
      null,
      { reason: 'ลูกค้ายกเลิก' } as unknown as Cancelled,
      today,
    );
    expect(r).toMatchObject({
      status: 'cancelled',
      statusLabel: 'ยกเลิก',
      step: 'ยกเลิก',
      urgencyKey: 'cancelled',
      currentDept: null,
      awaitingShipment: false,
      daysHint: '',
      cancelReason: 'ลูกค้ายกเลิก',
    });
    expect(r.shippedDate).toBeUndefined();
  });

  it('shipped when not cancelled', () => {
    const r = buildTrackResult(
      mkOrder(),
      null,
      { shippedDate: '05/07/2026' } as unknown as Shipped,
      null,
      today,
    );
    expect(r).toMatchObject({
      status: 'shipped',
      statusLabel: 'จัดส่งเรียบร้อยแล้ว',
      step: 'จัดส่งแล้ว',
      urgencyKey: 'shipped',
      currentDept: null,
      awaitingShipment: false,
      daysHint: '',
    });
    expect(r.shippedDate).toBe('5/7/2026');
    expect(r.cancelReason).toBeUndefined();
  });

  it('in_progress known dept (print) with a future due date — full shape', () => {
    const r = buildTrackResult(
      mkOrder(),
      job({ dept: 'print', staff: 'zzz', date: '10/07/2026' }),
      null,
      null,
      today,
    );
    expect(r).toEqual({
      orderId: 12345,
      name: 'ใบงานทดสอบ',
      customerMasked: 'AB•••',
      dateIn: '1/6/2026',
      dateDue: '10/7/2026',
      status: 'in_progress',
      statusLabel: 'อยู่ระหว่างพิมพ์',
      step: 'พิมพ์ (zz•)',
      currentDept: 'print',
      awaitingShipment: false,
      daysHint: 'เหลืออีก 9 วัน',
      urgencyKey: 'normal',
      shippedDate: undefined,
      cancelReason: undefined,
    });
  });

  it('awaitingShipment when dept=post + staff=ship (due today)', () => {
    const r = buildTrackResult(
      mkOrder(),
      job({ dept: 'post', staff: 'ship', date: '01/07/2026' }),
      null,
      null,
      today,
    );
    expect(r).toMatchObject({
      status: 'in_progress',
      statusLabel: 'สินค้าพร้อมรับ',
      currentDept: 'post',
      awaitingShipment: true,
      daysHint: 'กำหนดส่งวันนี้',
      urgencyKey: 'dday',
    });
    expect(r.step.startsWith('หลังพิมพ์/จัดส่ง (')).toBe(true);
  });

  it('overdue in_progress (graphic) surfaces เลยกำหนด + overdue urgency', () => {
    const r = buildTrackResult(
      mkOrder(),
      job({ dept: 'graphic', staff: 'zzz', date: '28/06/2026' }),
      null,
      null,
      today,
    );
    expect(r).toMatchObject({
      status: 'in_progress',
      statusLabel: 'กราฟิกกำลังดำเนินการ',
      step: 'กราฟิก (zz•)',
      currentDept: 'graphic',
      daysHint: 'เลยกำหนด 3 วัน',
      urgencyKey: 'overdue',
    });
  });

  it('job present but dept empty → keeps in_progress with received label (quirk preserved)', () => {
    const r = buildTrackResult(mkOrder(), job({ dept: '' }), null, null, today);
    expect(r).toMatchObject({
      status: 'in_progress', // deriveTrackStatus would say 'received'; /track keeps in_progress
      statusLabel: 'รับใบสั่งงานแล้ว',
      step: 'รับใบสั่งงาน',
      currentDept: null,
      awaitingShipment: false,
      daysHint: '',
      urgencyKey: 'received',
    });
  });

  it('received when no job at all', () => {
    const r = buildTrackResult(mkOrder(), null, null, null, today);
    expect(r).toMatchObject({
      status: 'received',
      statusLabel: 'รับใบสั่งงานแล้ว',
      step: 'รับใบสั่งงาน',
      currentDept: null,
      awaitingShipment: false,
      daysHint: '',
      urgencyKey: 'received',
    });
  });
});
