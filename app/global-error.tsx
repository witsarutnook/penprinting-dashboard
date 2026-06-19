'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Top-level error boundary — catches React render errors that bubble all
 * the way past every nested layout/page error boundary. Sentry recommends
 * wiring this so render-time crashes get captured (otherwise they're
 * silently swallowed by Next.js's default fallback).
 *
 * Must be a client component, must render its own <html> + <body> shell
 * because the root layout has already failed at this point.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, sans-serif',
          background: '#f5f5f4',
          minHeight: '100vh',
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
            border: '1px solid #fecaca',
            borderRadius: 12,
            padding: 24,
            color: '#7f1d1d',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            เกิดข้อผิดพลาดร้ายแรง
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: '#991b1b' }}>
            ระบบทำงานต่อไม่ได้ในขณะนี้ — รายงานถูกส่งไปยังทีมพัฒนาแล้ว
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
          {/* Must stay <a>: global-error renders its own <html>/<body> outside
              the app router tree (root layout has failed) — next/link is unusable here. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 8,
              background: '#1e3a8a',
              color: '#fff',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            กลับหน้าแรก
          </a>
        </div>
      </body>
    </html>
  );
}
