// lib/track-status.ts
// Shared status core for order tracking. Extracted so the /track lookup,
// LINE track-flex, and the customer job list all agree on "which step is
// this order at + how many days left". Presentation (labels/colors) stays
// per-surface; this returns only the semantic decision.
import { parseDateDMY } from '@/lib/analytics';

export type TrackStatusKind = 'cancelled' | 'shipped' | 'in_progress' | 'received';

export interface TrackStatus {
  kind: TrackStatusKind;
  currentDept: 'graphic' | 'print' | 'post' | null;
  awaitingShipment: boolean; // dept=post & staff=ship (shipping queue)
  daysLeft: number | null;   // from job.date vs today; null when no date / not in_progress
}

export function deriveTrackStatus(
  job: Record<string, unknown> | null,
  shipped: Record<string, unknown> | null,
  cancelled: Record<string, unknown> | null,
  today: Date,
): TrackStatus {
  if (cancelled) return { kind: 'cancelled', currentDept: null, awaitingShipment: false, daysLeft: null };
  if (shipped) return { kind: 'shipped', currentDept: null, awaitingShipment: false, daysLeft: null };

  if (job) {
    const dept = String(job.dept ?? '');
    if (dept === 'graphic' || dept === 'print' || dept === 'post') {
      const awaitingShipment = dept === 'post' && String(job.staff ?? '') === 'ship';
      const due = parseDateDMY(String(job.date ?? ''));
      const daysLeft = due ? Math.floor((due.getTime() - today.getTime()) / 86400000) : null;
      return { kind: 'in_progress', currentDept: dept, awaitingShipment, daysLeft };
    }
    // job present but dept empty/unknown (archive oddity / manual edit) →
    // benign "received" so badge + timeline stay consistent (auditor M4 2026-05-08).
    return { kind: 'received', currentDept: null, awaitingShipment: false, daysLeft: null };
  }
  return { kind: 'received', currentDept: null, awaitingShipment: false, daysLeft: null };
}
