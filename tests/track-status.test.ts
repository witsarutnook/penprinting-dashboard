import { describe, it, expect } from 'vitest';
import { deriveTrackStatus } from '@/lib/track-status';

const today = new Date(2026, 6, 1); // 1 Jul 2026 (month 0-indexed)

describe('deriveTrackStatus', () => {
  it('cancelled wins over everything', () => {
    expect(deriveTrackStatus({ dept: 'print' }, null, { reason: 'x' }, today))
      .toEqual({ kind: 'cancelled', currentDept: null, awaitingShipment: false, daysLeft: null });
  });
  it('shipped when not cancelled', () => {
    expect(deriveTrackStatus({ dept: 'print' }, { shippedDate: 'x' }, null, today))
      .toEqual({ kind: 'shipped', currentDept: null, awaitingShipment: false, daysLeft: null });
  });
  it('in_progress with known dept computes daysLeft', () => {
    expect(deriveTrackStatus({ dept: 'print', date: '10/07/2026' }, null, null, today))
      .toEqual({ kind: 'in_progress', currentDept: 'print', awaitingShipment: false, daysLeft: 9 });
  });
  it('awaitingShipment when dept=post + staff=ship', () => {
    expect(deriveTrackStatus({ dept: 'post', staff: 'ship', date: '01/07/2026' }, null, null, today))
      .toEqual({ kind: 'in_progress', currentDept: 'post', awaitingShipment: true, daysLeft: 0 });
  });
  it('received (benign) when job present but dept empty', () => {
    expect(deriveTrackStatus({ dept: '' }, null, null, today))
      .toEqual({ kind: 'received', currentDept: null, awaitingShipment: false, daysLeft: null });
  });
  it('received when no job at all', () => {
    expect(deriveTrackStatus(null, null, null, today))
      .toEqual({ kind: 'received', currentDept: null, awaitingShipment: false, daysLeft: null });
  });
  it('daysLeft null when in_progress but date unparseable', () => {
    expect(deriveTrackStatus({ dept: 'graphic', date: '' }, null, null, today).daysLeft).toBeNull();
  });
});
