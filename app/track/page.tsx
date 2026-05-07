import type { Metadata } from 'next';
import { TrackClient } from './client';

export const metadata: Metadata = {
  title: 'ตรวจสอบสถานะงาน — Penprinting',
  description: 'ตรวจสอบสถานะใบสั่งงานพิมพ์ — กรอกเลขที่ใบสั่งงานและ PIN ที่ได้รับจากร้าน',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** Public order tracking — customer enters orderId + PIN, sees status.
 *  No auth required. Mirrors WP page-track-order.php look + feel:
 *  cream `#f5f5f0` background, text-only "PENPRINTING" wordmark,
 *  rounded-20px white card with the form OR the 6-step progress view. */
export default function TrackPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f5f5f0',
        color: '#2d3748',
        padding: '20px',
        fontFamily: 'Anuphan, "Noto Sans Thai", system-ui, sans-serif',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', padding: '24px 0 20px' }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#1a202c',
              letterSpacing: 1,
            }}
          >
            PENPRINTING
          </div>
          <div style={{ fontSize: 13, color: '#718096', marginTop: 4 }}>
            โรงพิมพ์เพ็ญพรินติ้ง — ตรวจสอบสถานะงาน
          </div>
        </header>
        <TrackClient initialId={searchParams.id || ''} />
      </div>
    </div>
  );
}
