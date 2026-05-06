import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { loadAll, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { displayDate } from '@/lib/jobs';
import { AutoPrint, PrintButton } from '../print/auto-print';

export const metadata: Metadata = {
  title: 'การ์ด Tracking',
};

const ACCENT = '#1e3a8a';

/** Small printable label with order id, name, customer, due date, and PIN.
 *  Designed for ~95×60mm sticker / "ใบส่งของ" attached to the work folder.
 *  WP equivalent: downloadTrackingCard() (canvas → PNG). For v2 we render
 *  HTML and rely on the browser print dialog. */
export default async function TrackingCardPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/${params.id}/tracking-card`);

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) notFound();

  let order;
  let errorMessage: string | null = null;
  try {
    const data = await loadAll();
    order = data.orders.find((o) => Number(o.id) === id);
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }
  if (errorMessage) {
    return (
      <div style={{ fontFamily: 'system-ui', padding: 24 }}>
        <h1 style={{ color: '#b91c1c' }}>โหลดไม่สำเร็จ</h1>
        <pre style={{ background: '#fef2f2', padding: 12, borderRadius: 6 }}>{errorMessage}</pre>
      </div>
    );
  }
  if (!order) notFound();

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as Record<string, unknown>;
  const pin = String(raw.pin || '');
  const trackUrl = `https://app.penprinting.co/track-order/?id=${id}`;

  return (
    <div
      className="tc-page"
      style={{
        fontFamily: 'Anuphan, system-ui, sans-serif',
        background: '#f5f5f4',
        minHeight: '100vh',
        padding: '12mm 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <AutoPrint />
      {/* Toolbar — hidden in print */}
      <div
        className="no-print"
        style={{
          display: 'flex', gap: 8, alignItems: 'center',
          padding: '6px 12px', background: '#fff',
          border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13,
        }}
      >
        <span style={{ color: '#6b7280' }}>การ์ด Tracking #{id}</span>
        <PrintButton />
        <a
          href="/orders"
          style={{
            padding: '4px 12px', borderRadius: 4,
            border: '1px solid #d6d3d1', color: '#44403c', textDecoration: 'none',
          }}
        >
          ปิด
        </a>
      </div>

      {/* Card itself — sized for label printing (~95×60mm) */}
      <div
        className="tc-card"
        style={{
          width: '95mm',
          minHeight: '60mm',
          background: '#fff',
          border: `2px solid ${ACCENT}`,
          borderRadius: 6,
          padding: '5mm 6mm',
          color: '#111',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {/* Brand strip */}
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, paddingBottom: 4, borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#111', lineHeight: 1 }}>
              PENPRINTING
            </div>
            <div style={{ fontSize: 9, color: '#6b7280', marginTop: 1 }}>
              โรงพิมพ์เพ็ญพรินติ้ง
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: '#6b7280' }}>เลขที่ใบสั่ง</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: ACCENT, lineHeight: 1 }}>
              #{id}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 4 }}>
          <Row label="ชื่องาน" value={String(order.name || '-')} bold />
          <Row label="ลูกค้า" value={String(order.customer || '-')} />
          <Row label="วันที่รับ" value={displayDate(order.dateIn)} />
          <Row label="กำหนดส่ง" value={displayDate(order.dateDue)} accent />
        </div>

        {/* PIN block */}
        <div
          style={{
            background: ACCENT, color: '#fff',
            borderRadius: 4, padding: '4px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 4,
          }}
        >
          <div>
            <div style={{ fontSize: 8, opacity: 0.85, lineHeight: 1 }}>PIN tracking</div>
            <div
              style={{
                fontSize: 18, fontWeight: 800,
                letterSpacing: '4px', lineHeight: 1, marginTop: 1,
                fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              }}
            >
              {pin || '----'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 8, opacity: 0.85, lineHeight: 1.3 }}>
              เช็คสถานะที่<br />app.penprinting.co/track-order
            </div>
          </div>
        </div>

        {/* Tracking URL hint (small, monospace) */}
        <div
          style={{
            fontSize: 7, color: '#9ca3af', textAlign: 'center',
            wordBreak: 'break-all', marginTop: 2,
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
          }}
        >
          {trackUrl}
        </div>
      </div>

      {!pin && (
        <div
          className="no-print"
          style={{
            padding: '8px 14px', background: '#fef3c7',
            border: '1px solid #fbbf24', borderRadius: 6,
            fontSize: 13, color: '#92400e', maxWidth: 360,
          }}
        >
          ⚠ ใบสั่งงานนี้ไม่มี PIN (อาจถูกสร้างก่อนระบบรองรับ tracking)
        </div>
      )}

      <style>{`
        @page { size: 100mm 70mm; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body, .tc-page { background: #fff !important; padding: 0 !important; min-height: auto !important; }
          .tc-card { border-width: 1px !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function Row({
  label, value, bold, accent,
}: {
  label: string; value: string; bold?: boolean; accent?: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'baseline' }}>
      <span style={{ color: '#6b7280', flexShrink: 0, minWidth: '14mm' }}>{label}:</span>
      <span
        style={{
          flex: 1,
          fontWeight: bold ? 700 : 500,
          color: accent ? ACCENT : '#111',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  );
}
