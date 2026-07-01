// app/api/registrations/[id]/route.ts
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { deleteRegistration } from '@/lib/registrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  await deleteRegistration(numId);
  console.log(`[registrations] deleted #${numId} by ${session.role}:${session.user}`);
  return NextResponse.json({ ok: true });
}
