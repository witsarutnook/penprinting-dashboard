import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { createPeakClient } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';
import { recordPeakError, recordPeakOk } from '@/lib/peak/token-store';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { bangkokTodayISO } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

function thirtyDaysAgo(): string {
  const [y, m, d] = bangkokTodayISO().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10);
}

/** Admin "ทดสอบ": read the newest quotation. Failure body carries the error class name only. */
export async function POST() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const t0 = Date.now();
  try {
    const rows = await createPeakReader(createPeakClient()).newestQuotations(
      { dateStart: thirtyDaysAgo() },
      1,
    );
    const ms = Date.now() - t0;
    try {
      await recordPeakOk();
    } catch {
      // status bookkeeping is best effort
    }
    return NextResponse.json({ ok: true, latestCode: rows[0]?.code ?? null, ms });
  } catch (err) {
    const name = peakErrorLabel(err);
    try {
      await recordPeakError(name);
    } catch {
      // best effort
    }
    return NextResponse.json({ ok: false, error: name });
  }
}
