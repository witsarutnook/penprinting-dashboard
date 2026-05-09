import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { toISODate } from '@/lib/jobs';

export const maxDuration = 30;

/**
 * Reverse a recent forward — admin only, 10-second window enforced client-side
 * via the undo toast (server doesn't gate by time, only by role).
 *
 * Atomically: deletes the new (forwarded) job + appends the original snapshot
 * back as a fresh row. Uses Apps Script `bulkForward(items=1)` so it happens
 * inside one LockService — no orphan-job race.
 *
 * Cowork is restored from the snapshot so attached collaborators come back.
 *
 * Request body: { currentJobId, snapshot: { name, dept, staff, date, dateIn,
 *                  status, orderId, cowork? } }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: {
    currentJobId?: number | string;
    snapshot?: {
      name?: string;
      dept?: string;
      staff?: string;
      date?: string;
      dateIn?: string;
      status?: string;
      orderId?: number | string | null;
      cowork?: unknown;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const currentJobId = Number(body.currentJobId);
  const snap = body.snapshot;
  if (!currentJobId || !Number.isFinite(currentJobId) || !snap || !snap.dept || !snap.staff) {
    return NextResponse.json({ error: 'Missing currentJobId or snapshot' }, { status: 400 });
  }

  // Apps Script `bulkForward` (v5.10.2+) auto-allocates the new row's id
  // when `newJob.id` is missing/0/undefined — under the same LockService
  // scope as the delete+append, so atomicity is preserved. We pass
  // `id: 0` explicitly to opt in. Saves a `getNextId` round-trip
  // (~300ms) on every undo.
  const newJob: Record<string, unknown> = {
    id: 0,
    name: String(snap.name || ''),
    date: toISODate(String(snap.date || '')),
    dateIn: toISODate(String(snap.dateIn || '')),
    staff: String(snap.staff),
    dept: String(snap.dept),
    status: String(snap.status || 'pending'),
    orderId: snap.orderId ? Number(snap.orderId) : '',
  };
  if (snap.cowork !== undefined) newJob.cowork = snap.cowork;

  try {
    const result = await post<{
      ok?: boolean;
      processed?: number;
      succeeded?: Array<{ oldId: number | string; newId: number | string; name: string }>;
      failed?: Array<{ oldId?: number; error?: string }>;
      error?: string;
    }>('bulkForward', { data: { items: [{ oldId: currentJobId, newJob }] } });

    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    if (result.failed && result.failed.length > 0) {
      return NextResponse.json(
        { error: result.failed[0].error || 'undo failed' },
        { status: 502 },
      );
    }
    if (!result.processed) {
      return NextResponse.json({ error: 'undo failed — processed=0' }, { status: 502 });
    }
    // Surface the server-allocated id back to the client (used for the
    // toast + audit signing on the undo toast itself).
    const restoredId = result.succeeded?.[0]?.newId;
    return NextResponse.json({ ok: true, restoredId: restoredId ? Number(restoredId) : undefined });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
