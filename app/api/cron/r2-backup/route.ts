import { NextResponse } from 'next/server';
import { post, AppsScriptError } from '@/lib/api';

export const maxDuration = 300; // backup can take a while; Pro ceiling is 300s for crons

/** Vercel Cron — weekly Sheet backup, Sunday 3 AM Bangkok (Saturday 20:00 UTC).
 *
 *  Replaces the Apps Script time trigger that calls `backupSheet()` weekly.
 *  Apps Script `runBackup` action wraps `backupSheet()` (creates Drive copy +
 *  R2 fallback upload, returns BackupResult with row counts + sizes).
 *
 *  Scheduled in [vercel.json](vercel.json) — `"0 20 * * 6"`.
 *
 *  Auth: Vercel injects `Authorization: Bearer ${CRON_SECRET}` automatically.
 *
 *  Once verified working, user must delete the Apps Script time trigger for
 *  `backupSheet` to avoid duplicate weekly backups (storage waste + R2 cost).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await post<{
      ok?: boolean;
      driveBackupId?: string;
      r2Key?: string;
      rowCounts?: Record<string, number>;
      sizeKb?: number;
      error?: string;
    }>('runBackup', {});
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
