import 'server-only';
import { NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { appendAuditToPostgres } from '@/lib/postgres-write';
import { bustLoadAllCache } from '@/lib/revalidate';
import { issuePins, scanPinlessOrders } from '@/lib/order-pin-reissue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * One-shot repair (2026-11-27): orders in production whose PIN was wiped by an edit from a board
 * card get a new PIN (see lib/order-pin-reissue.ts). Admin only.
 *
 *   GET  → dry run: the orders without a PIN — which would get one (`eligible`: sent, not shipped,
 *          not cancelled, with a live job) and which would not, and why
 *   POST → body { "ids": [...] }: the eligible ids the admin reviewed. Only those ids can get a
 *          PIN, and only while still eligible (one gated statement). One audit row per order,
 *          cache bust. No PIN is returned — read it from the order's tracking card.
 *
 * POST, not GET?apply=1: a GET with a SameSite=Lax cookie can be triggered by a link (PATTERNS §2.5).
 * Idempotent — a second POST issues nothing. Retire after it has run on production.
 */
const MAX_IDS = 50;

function refuse(): NextResponse | null {
  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }
  return null;
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const no = refuse();
  if (no) return no;

  try {
    const rows = await scanPinlessOrders();
    const eligible = rows.filter((r) => r.eligible);
    const rest = rows.filter((r) => !r.eligible);
    const ids = (pick: (r: (typeof rows)[number]) => boolean) => rest.filter(pick).map((r) => r.orderId);
    const shipped = ids((r) => r.shipped);
    const cancelled = ids((r) => !r.shipped && r.cancelled);
    const draft = ids((r) => !r.shipped && !r.cancelled && r.status === 'draft');
    const named = new Set([...shipped, ...cancelled, ...draft]);
    return NextResponse.json({
      mode: 'dryRun',
      hint: 'POST { "ids": [...] } with the eligible ids you reviewed to give those orders a new PIN',
      eligible: eligible.map((r) => ({
        orderId: r.orderId, name: r.name, customer: r.customer, dateDue: r.dateDue, liveJobs: r.liveJobs,
      })),
      eligibleIds: eligible.map((r) => r.orderId),
      // Not touched by POST. `other` = sent, neither shipped nor cancelled, but no live job / odd shape.
      notEligible: { shipped, cancelled, draft, other: rest.map((r) => r.orderId).filter((id) => !named.has(id)) },
      nothingLeft: eligible.length === 0,
    });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}

/** The ids of the request body, or null when it does not name 1–50 orders. */
function requestedIds(body: unknown): number[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) return null;
  if (!ids.every((v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0)) return null;
  return [...new Set(ids as number[])];
}

export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const no = refuse();
  if (no) return no;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const ids = requestedIds(body);
  if (!ids) {
    return NextResponse.json(
      { error: `body must be { "ids": [order ids] } — 1 to ${MAX_IDS} ids from the dry run (GET this URL)` },
      { status: 400 },
    );
  }

  try {
    const issuedIds = await issuePins(ids);
    for (const orderId of issuedIds) {
      await appendAuditToPostgres({
        role: session.role,
        user: session.user,
        action: 'reissueOrderPin',
        targetId: orderId,
        summary: `ออก PIN ใหม่ให้ใบสั่งงาน #${orderId} — PIN เดิมหายตอนแก้ไขใบจากการ์ดบนบอร์ด`,
      });
    }
    if (issuedIds.length > 0) bustLoadAllCache();
    const issued = new Set(issuedIds);
    return NextResponse.json({
      mode: 'apply',
      issuedCount: issuedIds.length,
      issuedIds,
      // Named in the request but not eligible when the statement ran (already has a PIN, shipped, …).
      notIssuedIds: ids.filter((id) => !issued.has(id)).sort((a, b) => a - b),
      note: 'The new PIN is on each order\'s tracking card (/orders/<id>/tracking-card). GET this URL again — eligibleIds should be empty.',
    });
  } catch (err) {
    return NextResponse.json({ error: reason(err) }, { status: 500 });
  }
}
