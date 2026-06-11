import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';
import { toISODate, bangkokTodayISO } from '@/lib/jobs';
import { validatePhotobook, type OrderFormData, type PhotobookItem } from '@/lib/photobook';
import { mintOrderId, mintJobId } from '@/lib/id-allocation';
import {
  createOrderInPostgres,
  findDuplicateOrdersInPostgres,
  appendAuditToPostgres,
  PostgresWriteError,
} from '@/lib/postgres-write';

export const maxDuration = 30;

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

  // ── Build payloads up-front so both fast and fallback paths reuse them ──
  const pin = String(Math.floor(1000 + Math.random() * 9000));
  // Full form snapshot stored under both `details` and `rawData` (matches WP).
  // Photobook items: store under SINGLE field name `photobook` (auditor M14
  // — was being saved twice, both as `photobook` AND `photobookItems` from
  // the body spread, risking divergence on edit). Print template reads
  // `raw.photobook`; orderFormFromRaw already accepts both shapes.
  const formSnapshot: Record<string, unknown> = { ...body, pin, orderType };
  if (isPB) formSnapshot.photobook = photobookItems;
  delete formSnapshot.photobookItems;
  delete formSnapshot.force;
  delete formSnapshot.status;

  // Order payload — `id` is filled in by Apps Script createOrder (or by
  // the fallback path's getNextOrderId). Keeping it absent here makes the
  // shape unambiguous: server allocates.
  const orderPayloadBase = {
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

  // Initial job payload — only for non-draft. `id` and `orderId` are filled
  // in by Apps Script createOrder.
  const jobPayloadBase = isDraft ? null : {
    name,
    date: dateDue,
    dateIn,
    staff: assignStaff,
    dept: assignDept,
    status: 'pending',
  };

  return createOrder({
    orderPayloadBase,
    jobPayloadBase,
    isDraft,
    force: !!body.force,
    pin,
    orderType,
    session,
  });
}

// ─── createOrder (Postgres-only) ──────────────────────────────────

interface CreateOrderArgs {
  orderPayloadBase: {
    name: string;
    customer: string;
    dateIn: string;
    dateDue: string;
    price: string | number;
    assignDept: string;
    assignStaff: string;
    orderer: string;
    status: string;
    details: Record<string, unknown>;
    rawData: Record<string, unknown>;
  };
  jobPayloadBase: {
    name: string;
    date: string;
    dateIn: string;
    staff: string;
    dept: string;
    status: string;
  } | null;
  isDraft: boolean;
  force: boolean;
  pin: string;
  orderType: string;
  session: { role: string; user: string };
}

async function createOrder(args: CreateOrderArgs): Promise<NextResponse> {
  const { orderPayloadBase, jobPayloadBase, isDraft, force, pin, orderType, session } = args;

  // ── Dedupe scan — Postgres (sole source of truth post §12) ──────
  // Only still-open orders count (active job / draft) — shipped or
  // cancelled ones don't warn; repeat orders are routine.
  if (!isDraft && !force) {
    try {
      const dups = await findDuplicateOrdersInPostgres(
        orderPayloadBase.name,
        orderPayloadBase.customer,
      );
      if (dups.length > 0) {
        return NextResponse.json(
          {
            error: 'duplicate',
            duplicates: dups,
            message: `พบใบสั่งงานที่ยังทำอยู่ ${dups.length} รายการ — ส่ง force=true เพื่อยืนยันสร้างใบใหม่`,
          },
          { status: 409 },
        );
      }
    } catch (err) {
      // Dedupe failure is non-fatal — surface a warning but proceed.
      // Postgres outage shouldn't block order creation; worst case
      // duplicate orders accumulate that admin can clean up via data-audit.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[phase2-createOrder] dedupe scan failed: ${msg}`);
    }
  }

  // ── Allocate ids — Postgres counter (atomic UPDATE...RETURNING) ─
  let orderId: number;
  let jobId: number | null = null;
  const needJobId = !isDraft && !!jobPayloadBase;
  try {
    const [oid, jid] = await Promise.all([
      mintOrderId(),
      needJobId ? mintJobId() : Promise.resolve(null),
    ]);
    orderId = oid;
    jobId = jid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `id allocation failed — ${msg}` }, { status: 502 });
  }

  // ── Postgres INSERT (atomic-ish: order then job, both ON CONFLICT DO NOTHING) ──
  try {
    await createOrderInPostgres({
      orderId,
      order: orderPayloadBase,
      jobId,
      job: jobPayloadBase,
    });
  } catch (err) {
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `createOrder failed — ${msg}` }, { status: 500 });
  }

  // ── Audit log (Postgres-direct — immediate /board history visibility) ──
  await appendAuditToPostgres({
    action: 'createOrder',
    role: session.role,
    user: session.user,
    targetId: orderId,
    data: {
      order: {
        id: orderId,
        name: orderPayloadBase.name,
        customer: orderPayloadBase.customer,
      },
      job: jobId ? { id: jobId, name: jobPayloadBase?.name || '' } : undefined,
    },
  });

  // ── Cache bust — /board + /orders reads see the new rows immediately ──
  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({
    ok: true,
    orderId,
    jobId,
    pin,
    orderType,
    draft: isDraft || undefined,
  });
}
