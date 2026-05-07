import { NextResponse } from 'next/server';
import { loadAll, loadAllFresh, AppsScriptError } from '@/lib/api';
import { displayDate } from '@/lib/jobs';
import { DEPT_LABELS, STAFF, type Dept } from '@/lib/board';
import { computeUrgency, getBangkokToday, URGENCY_LABELS, type Urgency } from '@/lib/calendar';
import { parseDateDMY } from '@/lib/analytics';

/**
 * Public order lookup (no auth) — mirrors WP page-track-order.php.
 *
 * Body: { id, pin }
 * Returns redacted order data + status + step. Hides price, spec, full
 * staff names, internal flags. Rate-limit 15/hr per browser via signed
 * cookie (auditor H1 — in-memory Map didn't survive Vercel serverless
 * cold starts; cookie state is stable across instances). */

const RATE_COOKIE = 'pp_track_rl';
const WINDOW_MS = 60 * 60 * 1000; // 1h
const MAX_HITS = 15;

interface RateState {
  hits: number;
  resetAt: number;
}

function readRate(req: Request): RateState {
  const cookieHeader = req.headers.get('cookie') || '';
  const m = cookieHeader.match(new RegExp(`(?:^|; )${RATE_COOKIE}=([^;]+)`));
  if (!m) return { hits: 0, resetAt: Date.now() + WINDOW_MS };
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1])) as RateState;
    if (typeof parsed.hits !== 'number' || typeof parsed.resetAt !== 'number') {
      return { hits: 0, resetAt: Date.now() + WINDOW_MS };
    }
    if (Date.now() > parsed.resetAt) {
      return { hits: 0, resetAt: Date.now() + WINDOW_MS };
    }
    return parsed;
  } catch {
    return { hits: 0, resetAt: Date.now() + WINDOW_MS };
  }
}

function attachRateCookie(res: NextResponse, state: RateState) {
  res.cookies.set(RATE_COOKIE, JSON.stringify(state), {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    expires: new Date(state.resetAt),
    path: '/api/track',
  });
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
  const rate = readRate(req);
  if (rate.hits >= MAX_HITS) {
    const minutesLeft = Math.ceil((rate.resetAt - Date.now()) / 60000);
    const res = NextResponse.json(
      { error: `พยายามตรวจสอบบ่อยเกินไป — รออีก ${minutesLeft} นาทีแล้วลองใหม่` },
      { status: 429 },
    );
    attachRateCookie(res, rate);
    return res;
  }
  // Increment for THIS request — written to the response cookie before return.
  const nextRate: RateState = { hits: rate.hits + 1, resetAt: rate.resetAt };

  // Helper to wrap the response and attach the updated rate cookie.
  const respond = (json: Record<string, unknown>, status = 200) => {
    const res = NextResponse.json(json, { status });
    attachRateCookie(res, nextRate);
    return res;
  };

  let body: { id?: string | number; pin?: string };
  try {
    body = await req.json();
  } catch {
    return respond({ error: 'Invalid JSON' }, 400);
  }

  const id = String(body.id || '').replace(/[^0-9]/g, '');
  const pin = String(body.pin || '').replace(/[^0-9]/g, '');
  // Allow legacy short ids (≥3 digits) — Penprinting orders pre-2020 had
  // 4-digit ids. Format validation is already strict via numeric-only regex.
  if (id.length < 3 || pin.length !== 4) {
    return respond({ error: 'เลขที่ใบสั่งงานหรือ PIN ไม่ถูกต้อง' }, 400);
  }

  // Try the cached snapshot first (60s ISR — fast for already-known orders).
  // If not found, the order might be brand-new — created seconds ago via
  // "พิมพ์+สั่ง" then customer scans the QR before the cache rotates.
  // Bypass the cache once before giving up. Mirrors the print page pattern.
  let snap;
  try {
    snap = await loadAll();
    if (!snap.orders.some((o) => String(o.id) === id)) {
      snap = await loadAllFresh();
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return respond({ error: `ระบบเชื่อมต่อไม่ได้ — ${msg}` }, 502);
  }

  const order = snap.orders.find((o) => String(o.id) === id);
  if (!order) {
    return respond({ error: 'ไม่พบใบสั่งงานนี้' }, 404);
  }

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;
  const storedPin = String(raw.pin || '');
  if (!storedPin || storedPin !== pin) {
    return respond({ error: 'PIN ไม่ถูกต้อง' }, 401);
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

  return respond({ ok: true, result });
}

// Allow Dept import to satisfy ts; suppress unused complaints
void (null as Dept | null);
