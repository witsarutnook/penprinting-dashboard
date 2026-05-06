import { NextResponse } from 'next/server';
import { loadAll, AppsScriptError } from '@/lib/api';
import { displayDate } from '@/lib/jobs';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, URGENCY_LABELS, type Urgency } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';

/**
 * Public order lookup (no auth) — mirrors WP page-track-order.php.
 *
 * Body: { id, pin }
 * Returns redacted order data + status + step. Hides price, spec, full
 * staff names, internal flags. Rate-limit 15/hr per IP via in-memory map.
 */

interface RateLimitState {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitState>();
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_HITS = 15;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const state = rateLimitMap.get(ip);
  if (!state || now > state.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (state.count >= MAX_HITS) return false;
  state.count += 1;
  return true;
}

function maskName(name: string): string {
  const s = (name || '').trim();
  if (!s) return '-';
  if (s.length <= 2) return s;
  return s.slice(0, 2) + '•'.repeat(Math.max(1, s.length - 2));
}

interface TrackResult {
  orderId: number;
  name: string;
  customerMasked: string;
  dateIn: string;
  dateDue: string;
  status: 'cancelled' | 'shipped' | 'in_progress' | 'received';
  statusLabel: string;
  step: string;             // "กราฟิก", "พิมพ์", "หลังพิมพ์/จัดส่ง", "ยกเลิก", "จัดส่งแล้ว"
  daysHint: string;         // "เหลือ Xว", "ส่งวันนี้", "เกิน Xว"
  urgencyKey: Urgency | 'shipped' | 'cancelled' | 'received';
  shippedDate?: string;
  cancelReason?: string;
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

export async function POST(req: Request) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!checkRate(ip)) {
    return NextResponse.json(
      { error: 'พยายามตรวจสอบบ่อยเกินไป — รอ 1 ชั่วโมงแล้วลองใหม่' },
      { status: 429 },
    );
  }

  let body: { id?: string | number; pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = String(body.id || '').replace(/[^0-9]/g, '');
  const pin = String(body.pin || '').replace(/[^0-9]/g, '');
  if (id.length < 6 || pin.length !== 4) {
    return NextResponse.json({ error: 'เลขที่ใบสั่งงานหรือ PIN ไม่ถูกต้อง' }, { status: 400 });
  }

  let snap;
  try {
    snap = await loadAll();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `ระบบเชื่อมต่อไม่ได้ — ${msg}` }, { status: 502 });
  }

  const order = snap.orders.find((o) => String(o.id) === id);
  if (!order) {
    return NextResponse.json({ error: 'ไม่พบใบสั่งงานนี้' }, { status: 404 });
  }

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;
  const storedPin = String(raw.pin || '');
  if (!storedPin || storedPin !== pin) {
    return NextResponse.json({ error: 'PIN ไม่ถูกต้อง' }, { status: 401 });
  }

  // Match job / shipped / cancelled by orderId
  const jobMatch = snap.jobs.find((j) => Number(j.orderId) === Number(id));
  const shippedMatch = snap.shipped.find((s) => Number(s.orderId) === Number(id));
  const cancelledMatch = snap.cancelled.find((c) => Number(c.orderId) === Number(id));

  let status: TrackResult['status'];
  let statusLabel = '';
  let step = '';
  let daysHint = '';
  let urgencyKey: TrackResult['urgencyKey'] = 'received';

  if (cancelledMatch) {
    status = 'cancelled';
    statusLabel = 'ยกเลิก';
    step = 'ยกเลิก';
    urgencyKey = 'cancelled';
  } else if (shippedMatch) {
    status = 'shipped';
    statusLabel = 'จัดส่งเรียบร้อยแล้ว';
    step = 'จัดส่งแล้ว';
    urgencyKey = 'shipped';
  } else if (jobMatch) {
    status = 'in_progress';
    step = deptStepLabel(jobMatch.dept, jobMatch.staff);
    statusLabel = `กำลังดำเนินการ — ${(DEPT_LABELS as Record<string, string>)[jobMatch.dept] || jobMatch.dept}`;
    const due = parseDateDMY(jobMatch.date);
    const today = getBangkokToday();
    const u = computeUrgency(due, today);
    urgencyKey = u;
    if (due) {
      const days = Math.floor((due.getTime() - today.getTime()) / 86400000);
      if (days < 0) daysHint = `เกินกำหนด ${Math.abs(days)} วัน`;
      else if (days === 0) daysHint = 'กำหนดส่งวันนี้';
      else daysHint = `เหลือ ${days} วัน`;
      statusLabel += ` · ${URGENCY_LABELS[u]}`;
    }
  } else {
    status = 'received';
    statusLabel = 'รับใบสั่งงานแล้ว — รอเริ่มผลิต';
    step = 'รับใบสั่งงาน';
    urgencyKey = 'received';
  }

  const result: TrackResult = {
    orderId: Number(order.id),
    name: String(order.name || '-'),
    customerMasked: maskName(String(order.customer || '')),
    dateIn: displayDate(order.dateIn),
    dateDue: displayDate(order.dateDue),
    status,
    statusLabel,
    step,
    daysHint,
    urgencyKey,
    shippedDate: shippedMatch ? displayDate(shippedMatch.shippedDate) : undefined,
    cancelReason: cancelledMatch ? String(cancelledMatch.reason || '') : undefined,
  };

  return NextResponse.json({ ok: true, result });
}

// Allow Dept import to satisfy ts; suppress unused complaints
void (null as Dept | null);
