// lib/track-result.ts
// Result-shaping for the public /track lookup (app/api/track/lookup/route.ts).
// Delegates the semantic core — which dept, awaiting shipment, days left — to
// the shared deriveTrackStatus so /track, the LINE Flex card, and the customer
// job list all agree on status; the per-surface labels/step wording + redaction
// live here. Extracted so the (auth-less) public route can be unit-tested.
// Edge-runtime safe: all deps are pure (no server-only / Node built-ins).
import { deriveTrackStatus } from '@/lib/track-status';
import { displayDate } from '@/lib/jobs';
import { DEPT_LABELS, STAFF } from '@/lib/board';
import { computeUrgency, type Urgency } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';
import type { Order, Job, Shipped, Cancelled } from '@/lib/types';

export interface TrackResult {
  orderId: number;
  name: string;
  customerMasked: string;
  dateIn: string;
  dateDue: string;
  status: 'cancelled' | 'shipped' | 'in_progress' | 'received';
  /** Status pill label — e.g. "อยู่ระหว่างพิมพ์", "จัดส่งเรียบร้อยแล้ว". */
  statusLabel: string;
  step: string; // "กราฟิก", "พิมพ์", "หลังพิมพ์/จัดส่ง", "ยกเลิก", "จัดส่งแล้ว"
  /** Current dept of the active job — drives the 6-step progress UI on the
   *  client. null when received-but-no-job-yet, shipped, or cancelled. */
  currentDept: 'graphic' | 'print' | 'post' | null;
  /** True when job is in the shipping queue (dept='post' AND staff='ship').
   *  Client uses this to highlight step 5 ("สินค้าพร้อมรับ") as the active
   *  step instead of step 4 (post-press). */
  awaitingShipment: boolean;
  daysHint: string; // "เหลืออีก Xว", "กำหนดส่งวันนี้", "เลยกำหนด Xว"
  urgencyKey: Urgency | 'shipped' | 'cancelled' | 'received';
  shippedDate?: string;
  cancelReason?: string;
}

function maskName(name: string): string {
  const s = (name || '').trim();
  if (!s) return '-';
  if (s.length <= 2) return s;
  return s.slice(0, 2) + '•'.repeat(Math.max(1, s.length - 2));
}

function deptStepLabel(dept: string, staff: string): string {
  const d = (DEPT_LABELS as Record<string, string>)[dept] || dept;
  // Mask staff to first 2 chars to keep names somewhat private
  const def = (STAFF as Record<string, Array<{ id: string; name: string }>>)[dept]?.find(
    (s) => s.id === staff,
  );
  const staffName = def ? def.name : staff;
  return `${d} (${maskName(staffName)})`;
}

// Status label = current step name, matching WP wording exactly so the
// 6-step progress bar on the client is consistent with the badge.
const STATUS_BY_DEPT: Record<string, string> = {
  graphic: 'กราฟิกกำลังดำเนินการ',
  print: 'อยู่ระหว่างพิมพ์',
  post: 'ขั้นตอนหลังพิมพ์',
};

/** Build the redacted /track lookup payload. `order` is the (non-null) matched
 *  order; job/shipped/cancelled are the single most-recent matching rows per
 *  state (may be null). `today` is injected (getBangkokToday in the route). */
export function buildTrackResult(
  order: Order,
  job: Job | null,
  shipped: Shipped | null,
  cancelled: Cancelled | null,
  today: Date,
): TrackResult {
  const core = deriveTrackStatus(
    job as unknown as Record<string, unknown> | null,
    shipped as unknown as Record<string, unknown> | null,
    cancelled as unknown as Record<string, unknown> | null,
    today,
  );

  let status: TrackResult['status'];
  let statusLabel = '';
  let step = '';
  let daysHint = '';
  let urgencyKey: TrackResult['urgencyKey'] = 'received';

  if (core.kind === 'cancelled') {
    status = 'cancelled';
    statusLabel = 'ยกเลิก';
    step = 'ยกเลิก';
    urgencyKey = 'cancelled';
  } else if (core.kind === 'shipped') {
    status = 'shipped';
    statusLabel = 'จัดส่งเรียบร้อยแล้ว';
    step = 'จัดส่งแล้ว';
    urgencyKey = 'shipped';
  } else if (core.currentDept) {
    // Standard happy path — known dept drives both badge + 6-step UI.
    status = 'in_progress';
    step = deptStepLabel(job!.dept, job!.staff);
    statusLabel = STATUS_BY_DEPT[core.currentDept];
    // staff='ship' is a sub-state of dept='post' (the shipping queue). Surface
    // it so the timeline advances past post-press and the badge matches step 5.
    if (core.awaitingShipment) statusLabel = 'สินค้าพร้อมรับ';
    urgencyKey = computeUrgency(parseDateDMY(job!.date), today);
    if (core.daysLeft != null) {
      if (core.daysLeft < 0) daysHint = `เลยกำหนด ${Math.abs(core.daysLeft)} วัน`;
      else if (core.daysLeft === 0) daysHint = 'กำหนดส่งวันนี้';
      else daysHint = `เหลืออีก ${core.daysLeft} วัน`;
    }
  } else if (job) {
    // Auditor M4 (2026-05-08): job present but dept empty/unknown (archive
    // ingestion oddity, manual Sheet edit). deriveTrackStatus calls this
    // 'received', but /track keeps status 'in_progress' (a job DOES exist) with
    // a benign received label so the badge colour + empty 6-step timeline stay
    // internally consistent — the customer never sees "overdue" next to
    // nothing-in-progress.
    status = 'in_progress';
    step = 'รับใบสั่งงาน';
    statusLabel = 'รับใบสั่งงานแล้ว';
    urgencyKey = 'received';
  } else {
    status = 'received';
    statusLabel = 'รับใบสั่งงานแล้ว';
    step = 'รับใบสั่งงาน';
    urgencyKey = 'received';
  }

  return {
    orderId: Number(order.id),
    name: String(order.name || '-'),
    customerMasked: maskName(String(order.customer || '')),
    dateIn: displayDate(order.dateIn),
    dateDue: displayDate(order.dateDue),
    status,
    statusLabel,
    step,
    currentDept: core.currentDept,
    awaitingShipment: core.awaitingShipment,
    daysHint,
    urgencyKey,
    shippedDate: shipped ? displayDate(shipped.shippedDate) : undefined,
    cancelReason: cancelled ? String(cancelled.reason || '') : undefined,
  };
}
