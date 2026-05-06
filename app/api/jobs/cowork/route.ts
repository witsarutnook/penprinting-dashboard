import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF } from '@/lib/board';

/**
 * Set the co-work list (collaborators) for a job — all roles, mirrors WP
 * `setCowork`. Co-work is a workflow attachment (designer asks another for
 * help, multi-station job), not data edit, so it stays open like reassign.
 *
 * Apps Script overwrites the `cowork` column of the job row — pass empty
 * array (or null) to clear all collaborators.
 *
 * Request body: { id, cowork: Array<{ dept, staff }> }
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  let body: {
    id?: number | string;
    cowork?: Array<string | { dept?: string; staff?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

  // Accept both shapes: WP-format string[] of print staff ids, or legacy
  // {dept,staff}[]. Output: string[] of print staff ids only — matches WP
  // storage convention so cowork data round-trips between v2 and WP.
  const list = Array.isArray(body.cowork) ? body.cowork : [];
  const validPrint = new Set(STAFF.print.map((s) => s.id));
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    let staff = '';
    if (typeof entry === 'string') {
      staff = entry.trim();
    } else if (entry && typeof entry === 'object') {
      const dept = String(entry.dept || '').trim();
      // Reject any non-print dept entry — WP only fans out print
      if (dept && dept !== 'print') {
        return NextResponse.json({ error: `co-work รองรับเฉพาะแผนกพิมพ์ — รับ ${dept}` }, { status: 400 });
      }
      staff = String(entry.staff || '').trim();
    }
    if (!staff) continue;
    if (!validPrint.has(staff)) {
      return NextResponse.json({ error: `เครื่อง "${staff}" ไม่ใช่ผู้รับงานในแผนกพิมพ์` }, { status: 400 });
    }
    if (seen.has(staff)) continue;
    seen.add(staff);
    cleaned.push(staff);
  }
  try {
    const result = await post<{ ok?: boolean; error?: string }>('setCowork', {
      id,
      cowork: cleaned,
    });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true, count: cleaned.length });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
