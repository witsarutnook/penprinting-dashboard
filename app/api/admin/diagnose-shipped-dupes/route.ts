import { NextResponse } from 'next/server';
import { loadAllWithAudit, AppsScriptError } from '@/lib/api';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Diagnostic — surface Sheet rows whose `id` appears more than once in a
 * mirror table (same id = PRIMARY KEY violation when we tried to bulk
 * INSERT to Postgres). Sync deduplication takes care of these silently
 * (last-wins) but the Sheet itself still has duplicate rows that an admin
 * should clean up to prevent confusion.
 *
 * Reads loadAllWithAudit() ONCE, scans all 4 tables locally, returns the
 * duplicate ids per table with the matching rows. Caller (admin) opens
 * Sheet in the browser, finds the older of each pair, deletes it.
 *
 * Why not just rely on dedupeById in sync? Because Sheet remains the
 * source of truth and a phantom row in Sheet can confuse manual edits,
 * appear in WP-era reports, or break LINE webhook lookups that don't
 * route through our v2 wrapper.
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  let snap;
  try {
    snap = await loadAllWithAudit();
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Apps Script fetch failed: ${msg}` }, { status: 502 });
  }

  type RowRef = { id: number | string; raw: Record<string, unknown> };
  const tables: Record<string, RowRef[]> = {
    jobs: snap.jobs.map(j => ({ id: j.id, raw: j as unknown as Record<string, unknown> })),
    orders: snap.orders.map(o => ({ id: o.id, raw: o as unknown as Record<string, unknown> })),
    shipped: snap.shipped.map(s => ({ id: s.id, raw: s as unknown as Record<string, unknown> })),
    cancelled: snap.cancelled.map(c => ({ id: c.id, raw: c as unknown as Record<string, unknown> })),
    templates: snap.templates.map(t => ({ id: t.id, raw: t as unknown as Record<string, unknown> })),
  };

  const duplicates: Record<string, { id: string; count: number; rows: Record<string, unknown>[] }[]> = {};
  let totalDupes = 0;

  for (const [tableName, rows] of Object.entries(tables)) {
    const buckets = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const id = String(r.id ?? '');
      if (!id) continue;
      const list = buckets.get(id) || [];
      list.push(r.raw);
      buckets.set(id, list);
    }
    const dupes: { id: string; count: number; rows: Record<string, unknown>[] }[] = [];
    buckets.forEach((list, id) => {
      if (list.length > 1) {
        dupes.push({ id, count: list.length, rows: list });
        totalDupes += list.length - 1; // count of "extra" rows
      }
    });
    if (dupes.length > 0) {
      duplicates[tableName] = dupes;
    }
  }

  return NextResponse.json({
    ok: true,
    totalDuplicateGroups: Object.values(duplicates).reduce((sum, arr) => sum + arr.length, 0),
    totalExtraRows: totalDupes,
    duplicates,
    hint: totalDupes === 0
      ? 'Sheet ไม่มี duplicate ids — sync_meta.dedup ควรเป็น 0 ทุก table'
      : `เปิด Sheet → tab ที่ระบุ → หา rows ตาม id แล้วลบ row ที่เก่ากว่า. หลังจากนั้น run /api/admin/sync-all → confirm dedup กลับเป็น 0`,
  });
}
