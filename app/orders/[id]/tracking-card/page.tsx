import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { TrackingCardClient } from './client';

export const metadata: Metadata = {
  title: 'การ์ด Tracking',
};

/** Public tracking URL on the v2 dashboard.
 *  Aligned with the footer text in client.tsx after auditor C2. */
const TRACK_BASE_URL = 'https://dashboard.penprinting.co/track';

/** Server page reads the order, generates a QR data-URL pointing at the
 *  public tracking URL, and hands everything to the client wrapper which
 *  handles the visual layout + "Download PNG" via html-to-image. */
export default async function TrackingCardPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/${params.id}/tracking-card`);

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) notFound();

  let order;
  let errorMessage: string | null = null;
  try {
    const result = await loadOrder(id);
    order = result.order;
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
  const trackUrl = `${TRACK_BASE_URL}?id=${id}`;

  // Generate QR as PNG data URL (server-side, small dependency)
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(trackUrl, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    // Fall through — client renders a placeholder with just the URL text.
  }

  return (
    <TrackingCardClient
      orderId={id}
      name={String(order.name || '-')}
      customer={String(order.customer || '-')}
      pin={pin}
      qrDataUrl={qrDataUrl}
      trackUrl={trackUrl}
    />
  );
}
