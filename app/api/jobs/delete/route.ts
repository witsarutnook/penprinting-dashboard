import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Delete a job — admin only on dashboard v2 (per user preference 2026-05-06).
 * Apps Script `deleteJob` is open to all roles (WP relies on it for drag-drop
 * forward = deleteJob+addJob), but the v2 modal button is locked to admin.
 *
 * Request body: { id }
 */
export async function POST(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let body: { id?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.id) return NextResponse.json({ error: 'Missing job id' }, { status: 400 });

  try {
    const result = await post<{ ok?: boolean; error?: string }>('deleteJob', { id: body.id });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
