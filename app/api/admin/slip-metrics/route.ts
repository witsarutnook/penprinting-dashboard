import { NextRequest, NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { loadRecentSlipChecks, loadSlipMetrics, parseSlipMetricsChannel } from '@/lib/ai-quote/slip-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Daily slip-verify metrics — admin only.
 *
 * GET /api/admin/slip-metrics[?channel=line|messenger]
 *   → per-day rollup of inbound chat images (SQL อยู่ใน lib/ai-quote/slip-metrics.ts):
 *   images        = รูปที่ลูกค้าส่งเข้ามาทั้งหมด
 *   thunder_calls = ผ่านด่าน Haiku → ยิง Thunder (== Thunder quota ที่ใช้จริง)
 *   filtered_out  = Haiku คัดทิ้ง (ไม่กิน Thunder quota)
 *   slip_ok       = Thunder อ่านสลิปได้
 *   duplicates / mismatches / unreadable = แยกผล
 *
 * ไม่ส่ง ?channel= = aggregate ทุก channel (พฤติกรรมเดิม, response เพิ่ม
 * field `channel: 'all'`). ค่าอื่นนอกจาก line/messenger → 400.
 * Days are bucketed by the Bangkok calendar. Last 30 days, newest first.
 *
 * GET /api/admin/slip-metrics?recent=N[&channel=...]
 *   → last N raw slip_checks rows (newest first) incl. prefilter_answer +
 *   full Thunder response (`raw`) — browser-readable evidence for slip
 *   incidents without DB console access. N = 1..100, else 400.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }

  const parsed = parseSlipMetricsChannel(request.nextUrl.searchParams.get('channel'));
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "invalid channel — use 'line' or 'messenger'" },
      { status: 400 },
    );
  }

  const recentRaw = request.nextUrl.searchParams.get('recent');
  if (recentRaw !== null) {
    const n = Number(recentRaw);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      return NextResponse.json({ error: 'invalid recent — use an integer 1..100' }, { status: 400 });
    }
    const recent = await loadRecentSlipChecks(parsed.channel, n);
    return NextResponse.json({ ok: true, channel: parsed.channel ?? 'all', recent });
  }

  const metrics = await loadSlipMetrics(parsed.channel);
  return NextResponse.json({ ok: true, channel: parsed.channel ?? 'all', ...metrics });
}
