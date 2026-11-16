import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { peakOrderDb } from '@/lib/peak-order/db';

export const dynamic = 'force-dynamic';

/** Admin: remove a LINE user → orderer mapping (they re-pick the orderer on next /order). */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const id = (body as { lineUserId?: unknown } | null)?.lineUserId;
  if (typeof id !== 'string' || id.trim() === '') {
    return NextResponse.json({ ok: false, error: 'lineUserId_required' }, { status: 400 });
  }

  try {
    await peakOrderDb.deleteStaff(id.trim());
  } catch {
    console.error('[peak-staff] delete failed');
    return NextResponse.json({ ok: false, error: 'delete_failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
