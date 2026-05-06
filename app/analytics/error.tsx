'use client';

import { useEffect } from 'react';

/** Next.js error boundary for /analytics — converts a server-render
 *  exception into a visible message + stack so we can debug instead of
 *  seeing only "Digest: <number>". */
export default function AnalyticsError({
  error, reset,
}: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface to the browser console for quick inspection.
    // eslint-disable-next-line no-console
    console.error('[/analytics] render error', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-8">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
        <header className="px-5 py-4 bg-red-50 border-b border-red-100">
          <h1 className="text-lg font-bold text-red-800">/analytics เกิดข้อผิดพลาด</h1>
          {error.digest && (
            <p className="text-xs text-red-600 font-mono mt-1">
              Digest: {error.digest}
            </p>
          )}
        </header>
        <div className="p-5 space-y-3 text-sm">
          <div>
            <span className="text-stone-500 text-xs uppercase tracking-wide">Message</span>
            <pre className="mt-1 p-3 bg-stone-100 rounded font-mono text-xs whitespace-pre-wrap break-all">
              {error.message || '(empty)'}
            </pre>
          </div>
          {error.stack && (
            <div>
              <span className="text-stone-500 text-xs uppercase tracking-wide">Stack</span>
              <pre className="mt-1 p-3 bg-stone-100 rounded font-mono text-[11px] whitespace-pre-wrap break-all max-h-80 overflow-y-auto">
                {error.stack}
              </pre>
            </div>
          )}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700"
            >
              ลองอีกครั้ง
            </button>
            <a
              href="/board"
              className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
            >
              กลับ Kanban
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
