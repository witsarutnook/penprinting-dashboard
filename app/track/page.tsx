import type { Metadata } from 'next';
import { TrackClient } from './client';

export const metadata: Metadata = {
  title: 'ตรวจสอบสถานะงาน — Penprinting',
  description: 'ตรวจสอบสถานะใบสั่งงานพิมพ์ — กรอกเลขที่ใบสั่งงานและ PIN ที่ได้รับจากร้าน',
};

export const dynamic = 'force-dynamic';

/** Public order tracking — customer enters orderId + PIN, sees status.
 *  No auth required. Mirrors WP page-track-order.php. */
export default function TrackPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f5f5f4 0%, #fafaf9 100%)',
        padding: '24px 16px',
        fontFamily: 'Anuphan, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <div
            style={{
              display: 'inline-block', padding: '12px 20px',
              background: '#1e3a8a', color: '#fff',
              borderRadius: 12, fontWeight: 800, fontSize: 18, letterSpacing: 0.5,
            }}
          >
            PENPRINTING
          </div>
          <h1 style={{ fontSize: 22, color: '#111', marginTop: 14, marginBottom: 4 }}>
            ตรวจสอบสถานะงาน
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
            กรอกเลขที่ใบสั่งงานและ PIN 4 หลัก ที่ได้รับจากทางร้าน
          </p>
        </header>
        <TrackClient initialId={searchParams.id || ''} />
        <footer
          style={{
            textAlign: 'center', marginTop: 32,
            fontSize: 11, color: '#9ca3af',
          }}
        >
          โรงพิมพ์เพ็ญพรินติ้ง · penprinting.co
        </footer>
      </div>
    </div>
  );
}
