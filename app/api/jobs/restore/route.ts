import { NextResponse } from 'next/server';
import { loadOrder } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';
import { sql } from '@/lib/postgres';
import { restoreJobInPostgres, appendAuditToPostgres, PostgresWriteError } from '@/lib/postgres-write';
import {
  PeakLineTakenError,
  claimPeakLinesForRestore,
  peakLineTakenMessage,
  settlePeakRestore,
  type PeakRestoreClaim,
} from '@/lib/peak-order/restore-guard';

export const maxDuration = 30;

interface SrcCancelled {
  name?: string;
  dept?: string;
  staff?: string;
  orderId?: number | string | null;
}

/**
 * Restore a cancelled job back into the Kanban — admin only.
 *
 * Reads the cancelled row from Postgres (ground truth), reattaches to parent
 * order if any (for due/in dates), then atomically deletes from `cancelled`
 * and inserts into `jobs` via restoreJobInPostgres.
 *
 * Peak guard: when the parent order was opened from a Peak quotation
 * (`/order`), its quotation line may have been reopened as a NEW work order
 * while this job sat in `cancelled`. The restore first takes the line back
 * (lib/peak-order/restore-guard.ts) and answers 409 if it cannot — one Peak
 * line never has two live work orders.
 *
 * Request body: { id, srcCancelled?: { name, dept, staff, orderId } }
 * srcCancelled is used for the client-snapshot sanity check; ground truth
 * always comes from the Postgres row.
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number | string; srcCancelled?: SrcCancelled };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

  // Read the cancelled row from Postgres — ground truth (auditor H3).
  let cj: Record<string, unknown> | null = null;
  try {
    const r = await sql<{ raw: Record<string, unknown> | null }>`
      SELECT raw FROM cancelled WHERE id = ${id}::bigint LIMIT 1
    `;
    cj = r.rows[0]?.raw ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `อ่านข้อมูลไม่ได้ — ${msg}` }, { status: 502 });
  }
  if (!cj) {
    return NextResponse.json({ error: `ไม่พบรายการยกเลิก id=${id}` }, { status: 404 });
  }

  // Optional client-snapshot sanity check — if name supplied, must match.
  const src = body.srcCancelled;
  if (src && src.name && String(src.name).trim() !== String(cj.name || '').trim()) {
    return NextResponse.json(
      { error: `ข้อมูลที่ส่งมาไม่ตรงกับ row id=${id} ใน Sheet — refresh หน้า /cancelled แล้วลองใหม่` },
      { status: 409 },
    );
  }

  const cjName = String(cj.name || '');
  const cjDept = String(cj.dept || '');
  const cjStaff = String(cj.staff || '');
  const cjOrderId = cj.orderId ? Number(cj.orderId) : null;

  // Reattach to parent order (if any) to recover due/in dates.
  // Note (auditor L7): cowork list is lost through the cancel→restore cycle.
  let orderDateDue = '';
  let orderDateIn = '';
  if (cjOrderId) {
    try {
      const orderResult = await loadOrder(cjOrderId, { orderOnly: true });
      if (orderResult.order) {
        // Block restoring a job whose parent order has been cancelled.
        if (String(orderResult.order.status || '').toLowerCase() === 'cancelled') {
          return NextResponse.json(
            { error: `ใบสั่งงาน #${cjOrderId} ถูกยกเลิกแล้ว — กรุณา restore ใบสั่งงานก่อน หรือ recover ผ่าน data-audit modal` },
            { status: 409 },
          );
        }
        orderDateDue = String(orderResult.order.dateDue || '');
        orderDateIn = String(orderResult.order.dateIn || '');
      }
    } catch {
      // Non-fatal — restore with empty dates if parent lookup fails.
    }
  }

  const restored = {
    id,
    name: cjName,
    dept: cjDept,
    staff: cjStaff,
    status: 'pending',
    orderId: cjOrderId || '',
    date: toISODate(orderDateDue),
    dateIn: toISODate(orderDateIn),
  };

  // Peak guard — before the write. No-op (null) for orders without a Peak marker.
  let peakClaim: PeakRestoreClaim | null = null;
  if (cjOrderId) {
    try {
      peakClaim = await claimPeakLinesForRestore(cjOrderId, id, session.user);
    } catch (err) {
      if (err instanceof PeakLineTakenError) {
        return NextResponse.json({ error: peakLineTakenMessage(err) }, { status: 409 });
      }
      // The check could not run — do not restore on a guess.
      console.error('[jobs/restore] peak guard failed:', err instanceof Error ? err.name : 'unknown');
      return NextResponse.json(
        { error: 'ตรวจสอบใบเสนอราคา Peak ของงานนี้ไม่ได้ — ยังไม่ได้กู้คืน กรุณาลองใหม่อีกครั้ง' },
        { status: 502 },
      );
    }
  }

  try {
    await restoreJobInPostgres(restored);
  } catch (err) {
    if (peakClaim) {
      // Give the line back; if this fails too the claim lapses by itself after 2 minutes.
      await settlePeakRestore(peakClaim, false).catch(() => {});
    }
    const msg = err instanceof PostgresWriteError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  if (peakClaim) {
    try {
      await settlePeakRestore(peakClaim, true);
    } catch (err) {
      // The job IS restored. The claim lapses after 2 minutes and the next
      // /order on this line adopts the restored order through its marker.
      console.error('[jobs/restore] peak link finalize failed:', err instanceof Error ? err.name : 'unknown');
    }
  }

  await appendAuditToPostgres({
    action: 'restoreJob',
    role: session.role,
    user: session.user,
    targetId: id,
    data: { name: cjName, dept: cjDept, staff: cjStaff },
  });

  try {
    const { revalidatePath, revalidateTag } = await import('next/cache');
    revalidateTag('load-all'); // bust loadAll() snapshot cache
    revalidatePath('/board');
    revalidatePath('/cancelled');
    revalidatePath('/orders');
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true, id });
}
