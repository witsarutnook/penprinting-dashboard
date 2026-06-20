'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Per-route error boundary — catches render-time errors inside any
 * layout/page tree. After §12 Postgres is the sole data source, so a
 * Neon outage surfaces here. The UI explains the situation in Thai and
 * offers a retry; Sentry receives the original error for alerting.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const msg = error.message || '';
    const isPostgres =
      /postgres|neon|connection refused|ECONNREFUSED|relation .* does not exist/i.test(msg);
    Sentry.captureException(error, {
      tags: isPostgres ? { 'postgres-error': 'true' } : undefined,
    });
  }, [error]);

  const msg = error.message || '';
  const isPostgres =
    /postgres|neon|connection refused|ECONNREFUSED|relation .* does not exist/i.test(msg);

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          background: '#fff',
          border: '1px solid #fed7aa',
          borderRadius: 12,
          padding: 24,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#7c2d12' }}>
          {isPostgres ? '⚠️ ระบบขัดข้องชั่วคราว' : 'เกิดข้อผิดพลาด'}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: '#9a3412', lineHeight: 1.6 }}>
          {isPostgres
            ? 'กำลังตรวจสอบ — กรุณารอ 30 วินาทีแล้วลองใหม่. รายงานถูกส่งไปยังทีมพัฒนาแล้ว.'
            : 'รายงานถูกส่งไปยังทีมพัฒนาแล้ว — ลองรีเฟรชอีกครั้ง.'}
        </p>
        {error.digest && (
          <p
            style={{
              marginTop: 12,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 11,
              color: '#9ca3af',
            }}
          >
            digest: {error.digest}
          </p>
        )}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: '#c8553d',
              color: '#fff',
              border: 0,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            ลองใหม่
          </button>
          {/* Full reload intentional: error boundary recovery — client router
              state may be corrupted, so a hard navigation home is safer. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              background: '#f3f4f6',
              color: '#1f2937',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              border: '1px solid #e5e7eb',
            }}
          >
            หน้าแรก
          </a>
        </div>
      </div>
    </div>
  );
}
