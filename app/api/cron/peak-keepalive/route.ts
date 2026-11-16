import 'server-only';
import { NextResponse } from 'next/server';
import {
  getPeakAccessToken,
  recordPeakOk,
  recordPeakError,
  claimDailyAlert,
  releaseDailyAlert,
  PeakNotConnectedError,
} from '@/lib/peak/token-store';
import { createPeakClient } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { pushLine } from '@/lib/ai-quote/channels/line';
import { bangkokTodayISO } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALERT_TEXT =
  'การเชื่อมต่อ Peak ขัดข้อง ระบบอ่านใบเสนอราคาไม่ได้ กรุณาเชื่อมต่อใหม่ที่ https://dashboard.penprinting.co/peak';

function sevenDaysAgo(): string {
  const [y, m, d] = bangkokTodayISO().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10);
}

function firstGroupId(): string | null {
  const ids = (process.env.PEAK_ORDER_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ids[0] ?? null;
}

/** Vercel Cron — daily 07:30 Bangkok. Forces a token refresh (keeps the rotating
 *  refresh token alive), does one cheap read, records health, and sends at most
 *  one LINE alert per day (20 h slot) when the connection is broken. The slot is
 *  claimed only once a group id is known, and given back if the push fails.
 *
 *  Cron-only auth: `Authorization: Bearer ${CRON_SECRET}`; unset secret never authorises.
 *  After auth the route always answers 200: bookkeeping failures (DB down) are
 *  swallowed + logged by class label, since a 500 would only make Vercel show a
 *  failed cron without helping anyone. `ok:false` means the Peak check failed. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (process.env.PEAK_ORDER_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'disabled' });
  }

  try {
    await getPeakAccessToken({ forceRefresh: true });
    await createPeakReader(createPeakClient()).listQuotations({ dateStart: sevenDaysAgo(), page: 1 });
  } catch (err) {
    if (err instanceof PeakNotConnectedError) {
      return NextResponse.json({ ok: true, skipped: 'not-connected' });
    }
    const label = peakErrorLabel(err);
    console.error('[peak-keepalive] check failed:', label);
    try {
      await recordPeakError(label);
    } catch {
      console.error('[peak-keepalive] recordPeakError failed');
    }
    let alerted = false;
    const to = firstGroupId();
    if (!to) {
      console.error('[peak-keepalive] no alert: PEAK_ORDER_GROUP_IDS has no group id');
      return NextResponse.json({ ok: false, alerted });
    }
    let claimed = false;
    try {
      claimed = await claimDailyAlert();
    } catch (e) {
      console.error('[peak-keepalive] alert claim failed:', peakErrorLabel(e));
    }
    if (claimed) {
      try {
        await pushLine(to, ALERT_TEXT);
        alerted = true;
      } catch (e) {
        console.error('[peak-keepalive] alert push failed:', peakErrorLabel(e));
        try {
          await releaseDailyAlert();
        } catch (e2) {
          console.error('[peak-keepalive] alert release failed:', peakErrorLabel(e2));
        }
      }
    }
    return NextResponse.json({ ok: false, alerted });
  }

  try {
    await recordPeakOk();
  } catch {
    console.error('[peak-keepalive] recordPeakOk failed');
  }
  return NextResponse.json({ ok: true });
}
