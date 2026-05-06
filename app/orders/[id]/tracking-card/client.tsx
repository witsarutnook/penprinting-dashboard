'use client';

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { IconDownload, IconArrowLeft, IconAlertCircle } from '@/lib/icons';

const ACCENT = '#1e3a8a';
const CONTACT_PHONE = '043-220-582';

interface Props {
  orderId: number;
  name: string;
  customer: string;
  pin: string;
  qrDataUrl: string;
  trackUrl: string;
}

/** Client wrapper for the tracking card.
 *  - Renders the visual card matching WP downloadTrackingCard layout
 *    (brand strip, big QR, spaced PIN digits, footer info block).
 *  - "ดาวน์โหลด PNG" button uses html-to-image to capture the card div
 *    at 2× resolution so it looks crisp on retina + when printed. */
export function TrackingCardClient({
  orderId, name, customer, pin, qrDataUrl, trackUrl,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadPng() {
    const node = cardRef.current;
    if (!node) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        // Skip web fonts (rasterizes them via the browser instead) — Anuphan
        // is loaded via next/font and is available locally so this is safe.
      });
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `tracking-${orderId}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ดาวน์โหลดไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f5f4',
        padding: '24px 16px',
        fontFamily: 'Anuphan, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex', gap: 8, alignItems: 'center',
          padding: '6px 12px', background: '#fff',
          border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13,
          width: '100%', maxWidth: 460, justifyContent: 'space-between',
        }}
      >
        <a
          href="/orders"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', borderRadius: 4,
            color: '#44403c', textDecoration: 'none',
          }}
        >
          <IconArrowLeft size={14} /> กลับ
        </a>
        <span style={{ color: '#6b7280', fontWeight: 500 }}>การ์ด Tracking #{orderId}</span>
        <button
          type="button"
          onClick={downloadPng}
          disabled={busy}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 14px', borderRadius: 6,
            background: ACCENT, color: '#fff', border: 'none',
            fontWeight: 600, fontSize: 13,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
          }}
        >
          <IconDownload size={14} />
          {busy ? 'กำลังเตรียม...' : 'ดาวน์โหลด PNG'}
        </button>
      </div>

      {error && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 6,
            fontSize: 13, color: '#b91c1c', maxWidth: 460,
          }}
        >
          <IconAlertCircle size={14} />
          {error}
        </div>
      )}

      {/* The card itself — captured to PNG */}
      <div
        ref={cardRef}
        style={{
          width: 600,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 16,
          padding: '32px 36px',
          color: '#111',
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
          fontFamily: '"Anuphan", "Noto Sans Thai", sans-serif',
        }}
      >
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div
            style={{
              fontSize: 32,
              fontWeight: 800,
              letterSpacing: 1,
              color: '#111',
              lineHeight: 1.1,
            }}
          >
            PENPRINTING
          </div>
          <div style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>
            โรงพิมพ์เพ็ญพรินติ้ง
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', margin: '0 0 22px' }} />

        {/* QR */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`QR — ${trackUrl}`}
              style={{ width: 280, height: 280, display: 'block' }}
            />
          ) : (
            <div
              style={{
                width: 280, height: 280,
                background: '#f3f4f6', color: '#9ca3af',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, textAlign: 'center', padding: 20,
              }}
            >
              สร้าง QR ไม่ได้ — เข้า {trackUrl}
            </div>
          )}
        </div>

        {/* PIN */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            PIN ตรวจสอบสถานะ
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 28,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
              fontWeight: 800,
              fontSize: 36,
              color: '#111',
              letterSpacing: 0,
            }}
          >
            {(pin || '----').split('').map((c, i) => (
              <span key={i}>{c}</span>
            ))}
          </div>
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', margin: '0 0 18px' }} />

        {/* Info block — 2 columns: labels left, values right */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '6px 24px',
            fontSize: 14,
            color: '#374151',
            marginBottom: 18,
          }}
        >
          <span style={{ fontWeight: 700 }}>ชื่องาน</span>
          <span style={{ textAlign: 'right' }}>{name}</span>
          <span style={{ fontWeight: 700 }}>ลูกค้า</span>
          <span style={{ textAlign: 'right' }}>{customer}</span>
          <span style={{ fontWeight: 700 }}>เลขที่</span>
          <span style={{ textAlign: 'right' }}>#{orderId}</span>
        </div>

        <div style={{ borderTop: '1px solid #e5e7eb', margin: '0 0 14px' }} />

        {/* Footer */}
        <div
          style={{
            textAlign: 'center', fontSize: 13, color: '#6b7280', lineHeight: 1.6,
          }}
        >
          <div>
            สแกน QR หรือเข้า{' '}
            <span style={{ color: '#111', fontWeight: 500 }}>app.penprinting.co/track</span>
          </div>
          <div>
            ติดต่อสอบถาม:{' '}
            <span style={{ color: '#111', fontWeight: 500 }}>{CONTACT_PHONE}</span>
          </div>
        </div>
      </div>

      {!pin && (
        <div
          style={{
            padding: '8px 14px', background: '#fef3c7',
            border: '1px solid #fbbf24', borderRadius: 6,
            fontSize: 13, color: '#92400e', maxWidth: 460, textAlign: 'center',
          }}
        >
          ⚠ ใบสั่งงานนี้ไม่มี PIN (อาจถูกสร้างก่อนระบบรองรับ tracking)
        </div>
      )}
    </div>
  );
}
