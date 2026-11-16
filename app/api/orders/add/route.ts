import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { createOrderFromForm, type CreateOrderBody } from '@/lib/orders-create';

export const maxDuration = 30;

/**
 * Create a new order — admin + sales. Thin wrapper: auth + JSON parse here,
 * all validation / dedupe / insert logic lives in createOrderFromForm
 * (lib/orders-create.ts) so the LINE /order flow shares one code path.
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin', 'sales']);
  if (session instanceof NextResponse) return session;

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const r = await createOrderFromForm(body, session);
  if (r.ok) {
    return NextResponse.json({
      ok: true,
      orderId: r.orderId,
      jobId: r.jobId,
      pin: r.pin,
      orderType: r.orderType,
      draft: r.draft || undefined,
    });
  }
  if (r.kind === 'duplicate') {
    return NextResponse.json(
      { error: 'duplicate', duplicates: r.duplicates, message: r.message },
      { status: r.status },
    );
  }
  return NextResponse.json({ error: r.error }, { status: r.status });
}
