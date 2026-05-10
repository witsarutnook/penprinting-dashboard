import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { BenchClient } from './client';

/**
 * PoC bench page — Sheet (`/api/audit`) vs Postgres (`/api/audit/postgres`).
 *
 * Admin-only. Server component checks Postgres readiness + fetches a
 * suggested target_id (an order with the most audit rows — gives the bench
 * a meaningful working set instead of an empty-result no-op). Client
 * component does the actual N-run timing loop.
 *
 * Goal: a single number to inform the migration go/no-go decision.
 * Headline metric is "Postgres p50 vs Sheet p50" — if Postgres < Sheet/5,
 * proceed with hybrid read-mirror migration (Phase 1+2). Otherwise defer.
 */
export default async function BenchAuditPage() {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/admin/bench-audit');
  if (session.role !== 'admin') redirect('/board');

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white">
        <div className="px-4 sm:px-6 py-4">
          <h1 className="text-xl font-bold text-stone-900">PoC: Sheet vs Postgres bench</h1>
          <p className="text-sm text-stone-500 mt-1">
            วัด latency ของ /api/audit (Apps Script + Sheet) เทียบ /api/audit/postgres (Vercel Postgres)
          </p>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-6 max-w-3xl mx-auto space-y-4">
        <Suspense fallback={<div className="text-sm text-stone-500">กำลังตรวจ Postgres + หา target_id ที่เหมาะ…</div>}>
          <BenchData />
        </Suspense>
      </div>
    </DashboardShell>
  );
}

async function BenchData() {
  if (!isPostgresConfigured()) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-amber-900 font-semibold">Vercel Postgres ยังไม่ได้ connect</h2>
        <ol className="text-sm text-amber-800 mt-3 space-y-1 list-decimal list-inside">
          <li>Vercel project → Storage tab → Create Database → Postgres (Powered by Neon) → Free tier</li>
          <li>Connect to <code className="bg-amber-100 px-1">penprinting-dashboard</code> project</li>
          <li>Vercel จะ redeploy อัตโนมัติ — รอ ~1-2 นาที</li>
          <li>กลับมา refresh หน้านี้</li>
        </ol>
      </div>
    );
  }

  // Probe: count rows + suggest a target_id with the most entries (gives
  // bench a non-empty working set without the user having to guess one).
  let totalRows = 0;
  let suggestedTargetId: string | null = null;
  let suggestedRowCount = 0;
  let probeError: string | null = null;
  try {
    const total = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM audit_log`;
    totalRows = total.rows[0]?.count ?? 0;
    if (totalRows > 0) {
      const top = await sql<{ target_id: string; cnt: number }>`
        SELECT target_id::text AS target_id, COUNT(*)::int AS cnt
        FROM audit_log
        WHERE target_id IS NOT NULL
        GROUP BY target_id
        ORDER BY cnt DESC
        LIMIT 1
      `;
      if (top.rows[0]) {
        suggestedTargetId = top.rows[0].target_id;
        suggestedRowCount = top.rows[0].cnt;
      }
    }
  } catch (err) {
    probeError = err instanceof Error ? err.message : String(err);
  }

  if (probeError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-red-900 font-semibold">Postgres probe failed</h2>
        <p className="text-sm text-red-800 mt-2 font-mono">{probeError}</p>
        <p className="text-sm text-red-800 mt-3">
          น่าจะเพราะ schema ยังไม่ migrate. ลองเปิด <code className="bg-red-100 px-1">/api/admin/db-migrate</code> ก่อน
        </p>
      </div>
    );
  }

  if (totalRows === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-amber-900 font-semibold">Postgres ว่าง — ยังไม่ import</h2>
        <p className="text-sm text-amber-800 mt-2">
          เปิด <code className="bg-amber-100 px-1">/api/admin/import-audit-log</code> เพื่อ seed 500 rows ล่าสุดจาก Apps Script
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-2">
        <div className="text-xs font-medium text-stone-500 uppercase tracking-wide">สถานะ Postgres</div>
        <div className="text-sm text-stone-900">
          <span className="font-bold tabular-nums">{totalRows.toLocaleString('en-US')}</span>{' '}
          <span className="text-stone-500">rows ใน audit_log</span>
        </div>
        {suggestedTargetId && (
          <div className="text-sm text-stone-700">
            target_id ที่มีข้อมูลเยอะสุด:{' '}
            <code className="bg-stone-100 px-1.5 py-0.5 rounded font-mono">{suggestedTargetId}</code>{' '}
            <span className="text-stone-500">({suggestedRowCount} rows)</span>
          </div>
        )}
      </div>

      <BenchClient defaultTargetId={suggestedTargetId || ''} />
    </>
  );
}
