import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily slip-verify metrics — admin only.
 *
 * GET /api/admin/slip-metrics → per-day rollup of inbound LINE images:
 *   images        = รูปที่ลูกค้าส่งเข้ามาทั้งหมด
 *   thunder_calls = ผ่านด่าน Haiku → ยิง Thunder (== Thunder quota ที่ใช้จริง)
 *   filtered_out  = Haiku คัดทิ้ง (ไม่กิน Thunder quota)
 *   slip_ok       = Thunder อ่านสลิปได้
 *   duplicates / mismatches / unreadable = แยกผล
 *
 * Days are bucketed by the Bangkok calendar. Last 30 days, newest first.
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }

  const { rows } = await sql`
    SELECT
      (created_at AT TIME ZONE 'Asia/Bangkok')::date              AS day,
      COUNT(*)::int                                                AS images,
      COUNT(*) FILTER (WHERE thunder_called)::int                  AS thunder_calls,
      COUNT(*) FILTER (WHERE NOT looks_like_slip)::int             AS filtered_out,
      COUNT(*) FILTER (WHERE thunder_success)::int                 AS slip_ok,
      COUNT(*) FILTER (WHERE is_duplicate)::int                    AS duplicates,
      COUNT(*) FILTER (WHERE is_account_matched = false)::int      AS mismatches,
      COUNT(*) FILTER (WHERE thunder_called AND thunder_success IS NOT TRUE
                             AND is_duplicate IS NOT TRUE)::int    AS unreadable
    FROM slip_checks
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1 DESC`;

  const totals = rows.reduce(
    (a, r) => ({
      images: a.images + Number(r.images),
      thunder_calls: a.thunder_calls + Number(r.thunder_calls),
      filtered_out: a.filtered_out + Number(r.filtered_out),
      slip_ok: a.slip_ok + Number(r.slip_ok),
    }),
    { images: 0, thunder_calls: 0, filtered_out: 0, slip_ok: 0 },
  );

  return NextResponse.json({ ok: true, windowDays: 30, totals, days: rows });
}
