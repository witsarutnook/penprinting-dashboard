import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loadAll, AppsScriptError } from '@/lib/api';
import { computeAnalytics } from '@/lib/analytics';
import { COOKIE_NAME, verifySession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Diagnostic page — shows the raw data + computeAnalytics result.
 *  No charts, no client components, no DashboardShell. If this page
 *  works but /analytics doesn't, the problem is in charts/shell.
 *  If this page also crashes, we get the actual error message inline. */
export default async function AnalyticsDebugPage() {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/analytics/debug');

  const checks: Array<{ step: string; ok: boolean; detail?: string }> = [];
  let snapshot: unknown = null;
  let computeResult: unknown = null;

  try {
    const data = await loadAll();
    snapshot = {
      ordersCount: data.orders.length,
      jobsCount: data.jobs.length,
      shippedCount: data.shipped.length,
      cancelledCount: data.cancelled.length,
      auditCount: data.audit.length,
      templatesCount: data.templates.length,
      nextId: data.nextId,
      orderSample: data.orders[0] ? Object.keys(data.orders[0]) : 'no orders',
      jobSample: data.jobs[0] ? Object.keys(data.jobs[0]) : 'no jobs',
    };
    checks.push({ step: 'loadAll()', ok: true });
  } catch (err) {
    const msg = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? `${err.name}: ${err.message}\n\n${err.stack}`
        : String(err);
    checks.push({ step: 'loadAll()', ok: false, detail: msg });
  }

  if (snapshot) {
    try {
      const data = await loadAll();
      computeResult = computeAnalytics(data, 12);
      checks.push({ step: 'computeAnalytics(data, 12)', ok: true });
    } catch (err) {
      const msg = err instanceof Error
        ? `${err.name}: ${err.message}\n\n${err.stack}`
        : String(err);
      checks.push({ step: 'computeAnalytics(data, 12)', ok: false, detail: msg });
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>/analytics/debug</h1>
      <p style={{ color: '#6b7280', marginBottom: 24, fontSize: 14 }}>
        Session: <b>{session.user}</b> ({session.role})
      </p>

      <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>Checks</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {checks.map((c, i) => (
          <li key={i} style={{ marginBottom: 12, padding: 12, background: c.ok ? '#ecfdf5' : '#fef2f2', borderRadius: 8, border: `1px solid ${c.ok ? '#86efac' : '#fca5a5'}` }}>
            <div style={{ fontWeight: 600 }}>
              {c.ok ? '✅' : '❌'} {c.step}
            </div>
            {c.detail && (
              <pre style={{ marginTop: 8, fontSize: 11, fontFamily: 'ui-monospace, Menlo', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#7f1d1d', maxHeight: 320, overflow: 'auto' }}>
                {c.detail}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {snapshot != null && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>loadAll() snapshot summary</h2>
          <pre style={{ background: '#f5f5f4', padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, Menlo' }}>
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </>
      )}

      {computeResult != null && (
        <>
          <h2 style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>computeAnalytics(data, 12) result</h2>
          <pre style={{ background: '#f5f5f4', padding: 12, borderRadius: 8, fontSize: 12, fontFamily: 'ui-monospace, Menlo' }}>
            {JSON.stringify(computeResult, null, 2)}
          </pre>
        </>
      )}

      <p style={{ marginTop: 24, fontSize: 12, color: '#9ca3af' }}>
        Generated at {new Date().toISOString()}
      </p>
    </div>
  );
}
