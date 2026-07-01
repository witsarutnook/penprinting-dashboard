// lib/customer-track.ts
// Query a customer's ACTIVE jobs (not shipped, not cancelled) by matching
// orders.raw->>'customer' against a registration's name set. Powers the LINE
// /track-in-group command and the web tokenized page.
import 'server-only';
import { sql } from '@/lib/postgres';
import { displayDate } from '@/lib/jobs';
import { getBangkokToday } from '@/lib/calendar';
import { deriveTrackStatus, type TrackStatusKind } from '@/lib/track-status';

export interface CustomerJob {
  orderId: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  kind: TrackStatusKind;
  currentDept: 'graphic' | 'print' | 'post' | null;
  awaitingShipment: boolean;
  daysLeft: number | null;
}

export async function loadActiveJobsByCustomer(
  names: string[],
  opts: { keyword?: string } = {},
): Promise<CustomerJob[]> {
  const norm = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  if (norm.length === 0) return [];

  // DISTINCT ON (o.id) + ORDER BY o.id, j.id DESC = one row per order = latest
  // active job. NOT EXISTS shipped/cancelled makes "active" robust even if a
  // shipped order still carried a non-deleted job row.
  const { rows } = await sql<{
    order_id: number;
    order_raw: Record<string, unknown> | null;
    job_raw: Record<string, unknown> | null;
  }>`
    SELECT DISTINCT ON (o.id) o.id AS order_id, o.raw AS order_raw, j.raw AS job_raw
    FROM orders o
    JOIN jobs j ON j.order_id = o.id AND j.phase2_deleted_at IS NULL
    WHERE LOWER(TRIM(o.raw->>'customer')) = ANY(${norm as unknown as string})
      AND NOT EXISTS (SELECT 1 FROM shipped   s WHERE s.order_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.order_id = o.id)
    ORDER BY o.id, j.id DESC
  `;

  const today = getBangkokToday();
  let jobs: CustomerJob[] = rows.map((r) => {
    const o = r.order_raw ?? {};
    const status = deriveTrackStatus(r.job_raw, null, null, today);
    return {
      orderId: Number(r.order_id),
      name: String(o.name ?? '-'),
      customer: String(o.customer ?? ''),
      dateIn: displayDate(o.dateIn as string | null | undefined),
      dateDue: displayDate(o.dateDue as string | null | undefined),
      ...status,
    };
  });

  const kw = opts.keyword?.trim().toLowerCase();
  if (kw) {
    jobs = jobs.filter(
      (j) => j.name.toLowerCase().includes(kw) || j.customer.toLowerCase().includes(kw),
    );
  }

  // Urgent first (soonest due). null daysLeft (received / no date) sinks last.
  jobs.sort((a, b) => {
    if (a.daysLeft == null && b.daysLeft == null) return a.orderId - b.orderId;
    if (a.daysLeft == null) return 1;
    if (b.daysLeft == null) return -1;
    return a.daysLeft - b.daysLeft;
  });

  return jobs;
}
