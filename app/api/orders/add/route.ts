import { NextResponse } from 'next/server';
import { post, loadAllFresh, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate, bangkokTodayISO } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';

/**
 * Create a new order — admin + sales. Accepts the full WP-shape OrderFormData
 * (mirrors gatherFormData() at production-monitoring.js:1595).
 *
 * Server flow:
 *   1. Validate required header fields + assignStaff XOR forwardPrint.
 *   2. Validate photobook items if orderType=photobook.
 *   3. (Unless force) duplicate detection by (name, customer) lowercase.
 *   4. Allocate orderId + jobId, generate PIN.
 *   5. Build order payload — `details` + `rawData` both contain the full
 *      form snapshot (matches WP buildDetails behavior).
 *   6. addOrder → addJob; surface partial-success.
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: Partial<OrderFormData> & { force?: boolean; price?: string | number; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Draft mode: status='draft' is allowed; only validates ชื่องาน + dateIn (mirrors WP saveDraft).
  const isDraft = body.status === 'draft';

  // ── Header validation ────────────────────────────────────
  const name = String(body.name || '').trim();
  const customer = String(body.customer || '').trim();
  const dateDue = toISODate(body.dateDue);
  const dateIn = toISODate(body.dateIn) || bangkokTodayISO();
  const orderer = String(body.orderer || '').trim();
  const assignStaffInput = String(body.assignStaff || '');
  const forwardPrintInput = String(body.forwardPrint || '');
  const orderType = body.orderType === 'photobook' ? 'photobook' : 'normal';
  const isPB = orderType === 'photobook';

  const errors: string[] = [];
  if (!name) errors.push('กรุณาระบุชื่องาน');
  if (!isDraft) {
    if (!customer) errors.push('กรุณาระบุชื่อลูกค้า');
    if (!dateDue) errors.push('กรุณาระบุกำหนดส่ง');
    if (!orderer) errors.push('กรุณาระบุผู้สั่งงาน');
    if (!assignStaffInput && !forwardPrintInput) {
      errors.push('กรุณาเลือก มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์ อย่างน้อย 1 อย่าง');
    }
  }
  if (errors.length) return NextResponse.json({ error: errors.join(' • ') }, { status: 400 });

  // Determine actual assignment: graphic if assignStaff set, else print.
  // Draft mode allows empty assignment.
  let assignDept: Dept | '' = '';
  let assignStaff = '';
  if (assignStaffInput) {
    assignDept = 'graphic';
    assignStaff = assignStaffInput;
    const valid = STAFF.graphic.some((s) => s.id === assignStaff);
    if (!valid) {
      return NextResponse.json({ error: `กราฟฟิก "${assignStaff}" ไม่ถูกต้อง` }, { status: 400 });
    }
  } else if (forwardPrintInput) {
    assignDept = 'print';
    assignStaff = forwardPrintInput;
    const valid = STAFF.print.some((s) => s.id === assignStaff);
    if (!valid) {
      return NextResponse.json({ error: `ส่งต่อพิมพ์ "${assignStaff}" ไม่ถูกต้อง` }, { status: 400 });
    }
  } else if (!isDraft) {
    return NextResponse.json({ error: 'กรุณาเลือก มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์ อย่างน้อย 1 อย่าง' }, { status: 400 });
  }

  // ── Photobook validation ────────────────────────────────
  let photobookItems: PhotobookItem[] = [];
  if (isPB) {
    const v = validatePhotobook(body.photobookItems);
    if (!v.ok) return NextResponse.json({ error: v.errors.join(' • ') }, { status: 400 });
    photobookItems = v.cleaned;
  }

  // ── Phase 1: parallelize the read + ID allocations ──────
  // loadAllFresh, getNextOrderId, and (for non-draft) getNextId are all
  // independent reads — the previous sequential pattern wasted ~2s per
  // request waiting on each round-trip. Promise.all collapses them into
  // the time of the slowest one (~1-3s vs ~3-5s before).
  let snap: Awaited<ReturnType<typeof loadAllFresh>>;
  let orderId: number;
  let jobId: number | null = null;
  try {
    const [snapResult, orderIdResult, jobIdResult] = await Promise.all([
      loadAllFresh(),
      post<{ id?: number; error?: string }>('getNextOrderId', {}),
      isDraft
        ? Promise.resolve({ nextId: 0 } as { nextId?: number; error?: string })
        : post<{ nextId?: number; error?: string }>('getNextId', {}),
    ]);
    snap = snapResult;
    if (orderIdResult.error || !orderIdResult.id) {
      return NextResponse.json({ error: `ขอเลขใบสั่งไม่สำเร็จ — ${orderIdResult.error || 'unknown'}` }, { status: 502 });
    }
    orderId = Number(orderIdResult.id);
    if (!isDraft) {
      if (jobIdResult.error || !jobIdResult.nextId) {
        return NextResponse.json({ error: `ขอ job id ไม่สำเร็จ — ${jobIdResult.error || 'unknown'}` }, { status: 502 });
      }
      jobId = Number(jobIdResult.nextId);
    }
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }

  // ── Duplicate detection (against pre-fetched snapshot) ──
  // Drafts skip — user is still drafting, may revisit. force=true bypasses.
  if (!body.force && !isDraft) {
    const nLower = name.toLowerCase();
    const cLower = customer.toLowerCase();
    const dups = snap.orders
      .filter((o) => {
        if (String(o.status || '').toLowerCase() === 'cancelled') return false;
        const oName = String(o.name || '').trim().toLowerCase();
        const oCust = String(o.customer || '').trim().toLowerCase();
        return oName === nLower && oCust === cLower;
      })
      .slice(0, 5)
      .map((o) => ({
        id: Number(o.id),
        name: String(o.name || ''),
        customer: String(o.customer || ''),
        dateIn: String(o.dateIn || ''),
      }));
    if (dups.length > 0) {
      return NextResponse.json(
        {
          error: 'duplicate',
          duplicates: dups,
          message: `พบใบสั่งงานคล้ายกัน ${dups.length} รายการ — ส่ง force=true เพื่อสร้างต่อ`,
        },
        { status: 409 },
      );
    }
  }

  // ── Build payloads ───────────────────────────────────────
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  // Full form snapshot stored under both `details` and `rawData` (matches WP).
  const formSnapshot: Record<string, unknown> = { ...body, pin, orderType };
  // Photobook items: store under SINGLE field name `photobook` (auditor M14
  // — was being saved twice, both as `photobook` AND `photobookItems` from
  // the body spread, risking divergence on edit). Print template reads
  // `raw.photobook`; orderFormFromRaw already accepts both shapes.
  if (isPB) formSnapshot.photobook = photobookItems;
  delete formSnapshot.photobookItems;
  // Drop non-storage fields
  delete formSnapshot.force;
  delete formSnapshot.status;

  const orderPayload = {
    id: orderId,
    name,
    customer: customer || '-',
    dateIn,
    dateDue: dateDue || '',
    price: body.price ?? '',
    assignDept,
    assignStaff,
    orderer,
    status: isDraft ? 'draft' : 'sent',
    details: formSnapshot,
    rawData: formSnapshot,
  };

  // ── Phase 3: parallel writes ─────────────────────────────
  // Drafts only write the order. Non-drafts write order + initial job in
  // parallel — both rows reference the pre-allocated IDs so neither
  // depends on the other's response. Saves ~1-2s vs the previous serial
  // addOrder → addJob. Same partial-success semantics as before: an
  // orderless job or jobless order is surfaced via `partial: true` so
  // the user can retry from the UI.
  if (isDraft) {
    try {
      const orderResp = await post<{ ok?: boolean; id?: number; error?: string }>('addOrder', { data: orderPayload });
      if (orderResp.error) return NextResponse.json({ error: orderResp.error }, { status: 400 });
    } catch (err) {
      const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `addOrder failed — ${msg}` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, orderId, jobId: null, pin, orderType, draft: true });
  }

  const jobPayload = {
    id: jobId!,
    name,
    date: dateDue,
    dateIn,
    staff: assignStaff,
    dept: assignDept,
    status: 'pending',
    orderId,
  };

  const [orderOutcome, jobOutcome] = await Promise.allSettled([
    post<{ ok?: boolean; id?: number; error?: string }>('addOrder', { data: orderPayload }),
    post<{ ok?: boolean; id?: number; error?: string }>('addJob', { data: jobPayload }),
  ]);

  const orderErr = orderOutcome.status === 'rejected'
    ? (orderOutcome.reason instanceof Error ? orderOutcome.reason.message : String(orderOutcome.reason))
    : (orderOutcome.value.error || null);
  const jobErr = jobOutcome.status === 'rejected'
    ? (jobOutcome.reason instanceof Error ? jobOutcome.reason.message : String(jobOutcome.reason))
    : (jobOutcome.value.error || null);

  if (orderErr && jobErr) {
    return NextResponse.json({ error: `addOrder + addJob failed — ${orderErr}` }, { status: 502 });
  }
  if (orderErr) {
    // Job written but order missing — still better than total failure; user
    // can retry the order entry. Surface as partial so the UI shows it.
    return NextResponse.json(
      {
        ok: true, orderId: null, jobId, pin, partial: true,
        warning: `Job #${jobId} สร้างแล้ว แต่ addOrder ล้มเหลว — ${orderErr}. โปรดบันทึกใบสั่งใหม่.`,
      },
      { status: 200 },
    );
  }
  if (jobErr) {
    return NextResponse.json(
      {
        ok: true, orderId, jobId: null, pin, partial: true,
        warning: `ใบสั่ง #${orderId} บันทึกแล้ว แต่ addJob ล้มเหลว — ${jobErr}.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ ok: true, orderId, jobId, pin, orderType });
}
