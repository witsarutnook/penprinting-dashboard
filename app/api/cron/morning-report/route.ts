import { NextResponse } from 'next/server';

export const maxDuration = 60;

/** Vercel Cron — daily Morning Report at 8 AM Bangkok (1 AM UTC).
 *
 *  Replaces the Apps Script time trigger that calls `morningReport()` inside
 *  the separate Morning Report V2 Apps Script project (not the Dashboard one).
 *  The Apps Script side runs `runReport()` → fetches loadAll from Dashboard
 *  Apps Script → builds LINE Flex carousel → POSTs to LINE Messaging API.
 *
 *  Scheduled in [vercel.json](vercel.json) — `"0 1 * * *"`.
 *
 *  Env vars required:
 *  - `CRON_SECRET` — Vercel-injected on cron requests (Bearer token)
 *  - `MORNING_REPORT_APPS_SCRIPT_URL` — `/exec` URL of Morning Report V2 web app
 *  - `MORNING_REPORT_TOKEN` — shared secret matching the Apps Script's
 *    `CRON_TOKEN` Script Property (verified by its `doPost` handler)
 *
 *  Once verified working, user must delete the corresponding Apps Script
 *  time trigger (Apps Script editor → Triggers → delete row for
 *  `morningReport`) to avoid double-firing the LINE message.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = process.env.MORNING_REPORT_APPS_SCRIPT_URL;
  const token = process.env.MORNING_REPORT_TOKEN;
  if (!url || !token) {
    return NextResponse.json(
      { error: 'MORNING_REPORT_APPS_SCRIPT_URL or MORNING_REPORT_TOKEN env var missing' },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ token }),
      headers: { 'Content-Type': 'text/plain' },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Apps Script HTTP ${res.status}` }, { status: 502 });
    }
    const data = (await res.json()) as { ok?: boolean; error?: string; ranAt?: string };
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, ranAt: data.ranAt || new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
