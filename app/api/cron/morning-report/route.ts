import { NextResponse } from 'next/server';
import { sendMorningReport } from '@/lib/morning-report';

export const maxDuration = 60;

/** Vercel Cron — daily Morning Report at 8 AM Bangkok (1 AM UTC).
 *
 *  Self-contained: reads jobs+orders via `loadAll()` (Postgres-first mirror,
 *  Apps Script fallback), builds the LINE Flex carousel, and pushes it to the
 *  group. Replaces the standalone "Morning Report V2" Apps Script project,
 *  which is now retired (single scheduler = no more double-fire).
 *
 *  Scheduled in [vercel.json](vercel.json) — `"0 1 * * *"`.
 *
 *  Auth — either:
 *  - Vercel cron: `Authorization: Bearer ${CRON_SECRET}` (injected by Vercel)
 *  - Manual test: `?token=${MORNING_REPORT_TOKEN}` — add `&dry=1` to build the
 *    report without pushing to LINE.
 *
 *  Env vars required:
 *  - `CRON_SECRET` — Vercel-injected on cron requests
 *  - `LINE_CHANNEL_TOKEN` — LINE Messaging API channel access token
 *  - `LINE_GROUP_ID` — target LINE group id
 *  - `MORNING_REPORT_TOKEN` — shared secret for manual `?token=` triggering
 *  - `APPS_SCRIPT_URL` / `APPS_SCRIPT_TOKEN` — used only by the `loadAll()`
 *    Apps Script fallback when the Postgres mirror is stale
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`;

  const manualToken = process.env.MORNING_REPORT_TOKEN;
  const isManual = !!manualToken && searchParams.get('token') === manualToken;

  if (!isCron && !isManual) {
    return new Response('Unauthorized', { status: 401 });
  }

  const dryRun = isManual && searchParams.get('dry') === '1';

  try {
    const result = await sendMorningReport({ dryRun });
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
