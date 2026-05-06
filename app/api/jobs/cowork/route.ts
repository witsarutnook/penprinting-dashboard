import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';
import { STAFF, type Dept } from '@/lib/board';

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

  let body: { id?: number | string; cowork?: Array<{ dept?: string; staff?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = Number(body.id);
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing job id' }, { status: 400 });
  }

  const list = Array.isArray(body.cowork) ? body.cowork : [];
  // Validate every entry — drop empties, reject if any has invalid dept/staff.
  const cleaned: Array<{ dept: string; staff: string }> = [];
  const seen = new Set<string>();
  for (const entry of list) {
    const dept = String(entry?.dept || '').trim();
    const staff = String(entry?.staff || '').trim();
    if (!dept && !staff) continue;
    if (!dept || !staff) {
      return NextResponse.json({ error: 'รายการ co-work ต้องระบุทั้งแผนกและผู้รับงาน' }, { status: 400 });
    }
    const validInDept = STAFF[dept as Dept]?.some((s) => s.id === staff);
    if (!validInDept) {
      return NextResponse.json({ error: `${dept}/${staff} ไม่ใช่คู่แผนก-ผู้รับงานที่ถูกต้อง` }, { status: 400 });
    }
    const key = `${dept}:${staff}`;
    if (seen.has(key)) {
      return NextResponse.json({ error: `${dept}/${staff} ซ้ำในรายการ` }, { status: 400 });
    }
    seen.add(key);
    cleaned.push({ dept, staff });
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
