import type { Metadata } from 'next';
import { redirect, notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { loadOrder, AppsScriptError } from '@/lib/api';
import { COOKIE_NAME, verifySession } from '@/lib/auth';

// "พิมพ์+สั่ง" pops this page open ~1-2s after addOrder completes.
// loadOrder() is Postgres-first (with Apps Script fallback) so brand-new
// orders created via Phase 2 createOrder are visible immediately — Sheet
// lags up to 5 min via heal cron, so reading Apps Script direct would
// 404. force-dynamic stops Next.js from caching the page itself across
// print actions (each click should re-read the latest spec).
export const dynamic = 'force-dynamic';
import { displayDate } from '@/lib/jobs';
import { STAFF } from '@/lib/board';
import { type PhotobookItem } from '@/lib/photobook';
import { AutoPrint, PrintButton } from './auto-print';

export const metadata: Metadata = {
  title: 'พิมพ์ใบสั่งงาน',
};

const ACCENT = '#1e3a8a';
const TRACK_BASE_URL = 'https://dashboard.penprinting.co/track';

interface OrderRaw {
  orderType?: 'photobook' | 'normal';
  name?: string;
  customer?: string;
  size?: string; sizeUnit?: string; qty?: string; qtyUnit?: string;
  paperCover?: string; paperInner?: string;
  coverColor?: string; coverColorNote?: string;
  innerColor?: string; innerColorNote?: string;
  plateOld?: boolean; plateNew?: boolean;
  copyprint?: boolean; inkjet?: boolean; digital?: boolean;
  plateSize?: string[];
  billPerSet?: string; setPerBook?: string; sheetPerBook?: string;
  billColors?: string[];
  perf?: boolean; perfPos?: string;
  runNo?: boolean; runBook?: string; runNum?: string;
  glue?: boolean; saddle?: boolean; sew?: boolean; spine?: boolean;
  glueHead?: boolean; glueSide?: boolean;
  sewHead?: boolean; sewSide?: boolean; sewCorner?: boolean;
  sewThread?: boolean; sewSideTape?: boolean;
  coatGloss?: boolean; coatMatte?: boolean; coatUV?: boolean; coatSpotUV?: boolean;
  stampColor?: boolean; emboss?: boolean; diecut?: boolean; diecutSelf?: boolean;
  stampColorNote?: string;
  assignStaff?: string; forwardPrint?: string;
  orderer?: string; notes?: string;
  pin?: string;
  photobook?: PhotobookItem[];
}

export default async function OrderPrintPage({ params }: { params: { id: string } }) {
  const cookieStore = cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect(`/login?next=/orders/${params.id}/print`);

  const id = Number(params.id);
  if (!id || !Number.isFinite(id)) notFound();

  let order;
  let errorMessage: string | null = null;
  try {
    const result = await loadOrder(id, { orderOnly: true });
    order = result.order;
  } catch (err) {
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
  }
  if (errorMessage) {
    return <ErrorPage message={errorMessage} />;
  }
  if (!order) notFound();

  const raw = (order.rawData && typeof order.rawData === 'object'
    ? order.rawData
    : (order.details || {})) as OrderRaw;
  const isPhotobook = raw.orderType === 'photobook';
  const pin = raw.pin || '';

  const graphicName = raw.assignStaff
    ? STAFF.graphic.find((s) => s.id === raw.assignStaff)?.name || raw.assignStaff
    : '';
  const printName = raw.forwardPrint
    ? STAFF.print.find((s) => s.id === raw.forwardPrint)?.name || raw.forwardPrint
    : '';

  // QR linking to /track?id=<orderId> — let customers self-serve status
  // by scanning from the printed A4 invoice.
  const trackUrl = `${TRACK_BASE_URL}?id=${id}`;
  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(trackUrl, {
      width: 240,
      margin: 0,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    });
  } catch {
    // QR generation failed — header just won't show the code.
  }

  return (
    <div
      className="print-page"
      style={{
        fontFamily: 'Anuphan, system-ui, sans-serif',
        background: '#f5f5f4',
        minHeight: '100vh',
        padding: '12mm 0',
      }}
    >
      <AutoPrint />
        {/* Toolbar — hidden in print */}
        <div
          className="no-print"
          style={{
            maxWidth: 794, // A4 width @ 96dpi
            margin: '0 auto 8mm',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '6px 12px',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <span style={{ color: '#6b7280' }}>
            ใบสั่งงาน <b style={{ color: '#111' }}>#{id}</b>
            {pin && <> · PIN <b style={{ letterSpacing: '2px', color: '#111' }}>{pin}</b></>}
          </span>
          <span>
            <PrintButton />
            <a
              href="/orders"
              style={{
                marginLeft: 8, padding: '4px 12px', borderRadius: 4,
                border: '1px solid #d6d3d1', color: '#44403c', textDecoration: 'none',
              }}
            >
              ปิด
            </a>
          </span>
        </div>

        <main
          className="print-paper"
          style={{
            maxWidth: 794,
            margin: '0 auto',
            background: '#fff',
            padding: '10mm',
            border: '1px solid #d6d3d1',
            color: '#111',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              border: `2px solid ${ACCENT}`,
              borderRadius: 6,
              marginBottom: 6,
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '8px 10px', background: '#fff' }}>
              <div style={{ marginBottom: 6 }}>
                {/* Real Penprinting wordmark + pen-in-circle. SVG already
                    contains "PENPRINTING" so the placeholder PP block + the
                    PENPRINTING text row that sat next to it are gone. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/penprinting-logo.svg"
                  alt="Penprinting"
                  style={{ height: 44, width: 'auto', display: 'block' }}
                />
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                  โรงพิมพ์เพ็ญพรินติ้ง
                </div>
              </div>
              <div
                style={{
                  display: 'flex', gap: 16, fontSize: 12, paddingTop: 4,
                  borderTop: '1px dashed #cbd5e0',
                }}
              >
                <div>
                  <span style={{ color: '#6b7280' }}>วันที่รับ:</span>{' '}
                  <b>{displayDate(order.dateIn) || '-'}</b>
                </div>
                <div>
                  <span style={{ color: '#6b7280' }}>กำหนดส่ง:</span>{' '}
                  <b style={{ color: ACCENT }}>{displayDate(order.dateDue) || '-'}</b>
                </div>
              </div>
            </div>
            <div
              style={{
                padding: '8px 12px', background: ACCENT, color: '#fff',
                display: 'flex', alignItems: 'center', gap: 10, minWidth: 200,
              }}
            >
              <div style={{ textAlign: 'right', flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.9, lineHeight: 1 }}>
                  ใบสั่งงาน
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2, lineHeight: 1 }}>
                  #{id}
                </div>
                {pin && (
                  <div style={{ fontSize: 11, opacity: 0.9, marginTop: 5 }}>
                    PIN:{' '}
                    <b style={{ fontSize: 14, letterSpacing: '2px' }}>{pin}</b>
                  </div>
                )}
                <div style={{ fontSize: 9, opacity: 0.75, marginTop: 5, lineHeight: 1.2 }}>
                  สแกนเพื่อตรวจสถานะ
                </div>
              </div>
              {qrDataUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={qrDataUrl}
                  alt={`QR ตรวจสถานะ ${id}`}
                  style={{
                    width: 60, height: 60,
                    background: '#fff',
                    padding: 3,
                    borderRadius: 4,
                    flexShrink: 0,
                  }}
                />
              )}
            </div>
          </div>

          {/* Customer + size */}
          <Section title="ข้อมูลลูกค้า">
            <Grid cols={4}>
              <FG label="ชื่องาน">{raw.name || order.name || '-'}</FG>
              <FG label="ชื่อลูกค้า">{raw.customer || order.customer || '-'}</FG>
              <FG label="ขนาด">
                {(raw.size || '') + (raw.size && raw.sizeUnit ? ` ${raw.sizeUnit}` : '')}
              </FG>
              <FG label="จำนวน">
                {(raw.qty || '') + (raw.qty && raw.qtyUnit ? ` ${raw.qtyUnit}` : '')}
              </FG>
            </Grid>
          </Section>

          {isPhotobook ? (
            <PhotobookBlock items={raw.photobook || []} />
          ) : (
            <NormalSpec raw={raw} />
          )}

          {/* Assign */}
          <Section title="มอบหมายงาน">
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', padding: '2px 0', fontSize: 12.5 }}>
              <PL label="ผู้สั่งงาน">{raw.orderer || order.orderer || '-'}</PL>
              <PL label="กราฟฟิก">{graphicName || '-'}</PL>
              <PL label="ส่งต่อพิมพ์">{printName || '-'}</PL>
            </div>
          </Section>

          {/* Notes */}
          {raw.notes && (
            <Section title="หมายเหตุเพิ่มเติม">
              <div
                style={{
                  fontSize: 12.5, padding: '4px 6px', border: '1px solid #cbd5e0',
                  borderRadius: 3, minHeight: 24, background: '#fff', whiteSpace: 'pre-wrap',
                }}
              >
                {raw.notes}
              </div>
            </Section>
          )}

          {/* Footer */}
          <div
            style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 10, paddingTop: 4, borderTop: '1px solid #e5e7eb',
              fontSize: 9, color: '#9ca3af',
            }}
          >
            <div>Penprinting Production System</div>
            <div>พิมพ์เมื่อ: {new Date().toLocaleDateString('th-TH')}</div>
          </div>
        </main>

      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-page { background: #fff !important; padding: 0 !important; }
          .print-paper { border: none !important; box-shadow: none !important; padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Atoms ────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: `1.5px solid ${ACCENT}`, borderRadius: 5, margin: '5px 0', overflow: 'hidden' }}>
      <div
        style={{
          background: ACCENT, color: '#fff', padding: '3px 8px',
          fontSize: 12.5, fontWeight: 700, letterSpacing: '0.3px',
        }}
      >
        {title}
      </div>
      <div style={{ padding: '6px 8px', background: '#fff' }}>{children}</div>
    </div>
  );
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '4px 10px' }}>
      {children}
    </div>
  );
}

function FG({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: '#6b7280', marginBottom: 2, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          fontSize: 12.5, padding: '3px 6px', border: '1px solid #cbd5e0',
          borderRadius: 3, minHeight: 20, background: '#fff',
        }}
      >
        {children || ''}
      </div>
    </div>
  );
}

function CB({ checked, label, radio }: { checked: boolean; label: string; radio?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 12, whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 12, height: 12, border: '1px solid #9ca3af',
          borderRadius: radio ? '50%' : 2,
          background: checked ? ACCENT : 'transparent',
          color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, fontWeight: 700,
        }}
      >
        {checked ? '✓' : ''}
      </span>
      {label}
    </span>
  );
}

function CBG({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', gap: '4px 10px', flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
    </span>
  );
}

function PL({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 12.5 }}>
      <span style={{ color: '#6b7280' }}>{label}:</span>{' '}
      <b style={{ color: '#111' }}>{children}</b>
    </span>
  );
}

// ─── Spec blocks ──────────────────────────────────────────

function NormalSpec({ raw }: { raw: OrderRaw }) {
  const cVal = (raw.coverColor || '').replace(/[^0-9]/g, '');
  const iVal = (raw.innerColor || '').replace(/[^0-9]/g, '');
  const ps = Array.isArray(raw.plateSize) ? raw.plateSize : [];
  const psNorm = (key: string) => ps.includes(key);
  const bc = raw.billColors || [];

  return (
    <>
      <Section title="รายละเอียดงาน">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', margin: '2px 0' }}>
          <div style={{ flex: '0 0 160px' }}><FG label="กระดาษปก">{raw.paperCover || ''}</FG></div>
          <div>
            <Subtitle>สีปก</Subtitle>
            <CBG>
              <CB checked={cVal === '1'} label="1 สี" radio />
              <CB checked={cVal === '2'} label="2 สี" radio />
              <CB checked={cVal === '3'} label="3 สี" radio />
              <CB checked={cVal === '4'} label="4 สี" radio />
            </CBG>
          </div>
          <div style={{ flex: '0 0 160px' }}><FG label="หมายเหตุสีปก">{raw.coverColorNote || ''}</FG></div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', margin: '6px 0 2px' }}>
          <div style={{ flex: '0 0 160px' }}><FG label="กระดาษเนื้อใน">{raw.paperInner || ''}</FG></div>
          <div>
            <Subtitle>สีเนื้อใน</Subtitle>
            <CBG>
              <CB checked={iVal === '1'} label="1 สี" radio />
              <CB checked={iVal === '2'} label="2 สี" radio />
              <CB checked={iVal === '3'} label="3 สี" radio />
              <CB checked={iVal === '4'} label="4 สี" radio />
            </CBG>
          </div>
          <div style={{ flex: '0 0 160px' }}><FG label="หมายเหตุสีเนื้อใน">{raw.innerColorNote || ''}</FG></div>
        </div>
      </Section>

      <Section title="PLATE / การพิมพ์">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap', margin: '2px 0' }}>
          <div>
            <Subtitle inline>ประเภท:</Subtitle>
            <CBG>
              <CB checked={!!raw.plateOld} label="เก่า" />
              <CB checked={!!raw.plateNew} label="ใหม่" />
              <CB checked={!!raw.copyprint} label="Copyprint" />
              <CB checked={!!raw.inkjet} label="Inkjet" />
              <CB checked={!!raw.digital} label="Print Digital" />
            </CBG>
          </div>
          <div>
            <Subtitle inline>ขนาด:</Subtitle>
            <CBG>
              <CB checked={psNorm('ตัด 5')} label="ตัด 5" />
              <CB checked={psNorm('ตัด 4')} label="ตัด 4" />
              <CB checked={psNorm('ตัด 3')} label="ตัด 3" />
            </CBG>
          </div>
        </div>
      </Section>

      <Section title="งานบิล">
        <Grid cols={3}>
          <FG label="บิลต่อชุด">{raw.billPerSet || ''}</FG>
          <FG label="ชุดต่อเล่ม">{raw.setPerBook || ''}</FG>
          <FG label="แผ่นต่อเล่ม">{raw.sheetPerBook || ''}</FG>
        </Grid>
        <div style={{ marginTop: 5 }}>
          <Subtitle>สีบิล 1-6</Subtitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '3px 6px' }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <FG key={i} label={`บิล ${i + 1}`}>{bc[i] || ''}</FG>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ paddingBottom: 4 }}><CB checked={!!raw.perf} label="ปรุ" /></div>
          <div style={{ flex: '1 1 auto', maxWidth: 280 }}>
            <FG label="ตำแหน่ง">{raw.perfPos || ''}</FG>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 6 }}>
          <div style={{ paddingBottom: 4 }}><CB checked={!!raw.runNo} label="หมายเลขรัน" /></div>
          <div style={{ flex: '0 0 110px' }}><FG label="เล่มที่">{raw.runBook || ''}</FG></div>
          <div style={{ flex: '0 0 110px' }}><FG label="เลขที่">{raw.runNum || ''}</FG></div>
        </div>
      </Section>

      <Section title="เข้าเล่ม">
        <div style={{ display: 'flex', gap: '6px 12px', flexWrap: 'wrap' }}>
          <CB checked={!!raw.glue} label="ไสกาว" />
          <CB checked={!!raw.saddle} label="มุงหลังคา" />
          <CB checked={!!raw.sew} label="เย็บกี่" />
          <CB checked={!!raw.spine} label="กระดูกงู" />
          <CB checked={!!raw.glueHead} label="กาวหัว" />
          <CB checked={!!raw.glueSide} label="กาวข้าง" />
          <CB checked={!!raw.sewHead} label="เย็บหัว" />
          <CB checked={!!raw.sewSide} label="เย็บข้าง" />
          <CB checked={!!raw.sewCorner} label="เย็บมุม" />
          <CB checked={!!raw.sewThread} label="เย็บด้าย" />
          <CB checked={!!raw.sewSideTape} label="ติดเทปสัน" />
        </div>
      </Section>

      <Section title="เคลือบ / ปั๊ม">
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <Subtitle inline>เคลือบ:</Subtitle>
            <CBG>
              <CB checked={!!raw.coatGloss} label="เงา" />
              <CB checked={!!raw.coatMatte} label="ด้าน" />
              <CB checked={!!raw.coatUV} label="UV" />
              <CB checked={!!raw.coatSpotUV} label="SPOT UV" />
            </CBG>
          </div>
          <div>
            <Subtitle inline>ปั๊ม:</Subtitle>
            <CBG>
              <CB checked={!!raw.stampColor} label="ปั๊มสี" />
              <CB checked={!!raw.emboss} label="นูน" />
              <CB checked={!!raw.diecut} label="ส่งไดคัท" />
              <CB checked={!!raw.diecutSelf} label="ไดคัทเอง" />
            </CBG>
          </div>
          <div style={{ flex: '0 0 140px' }}><FG label="สีปั๊ม">{raw.stampColorNote || ''}</FG></div>
        </div>
      </Section>
    </>
  );
}

function PhotobookBlock({ items }: { items: PhotobookItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Section title="รายการ Photobook">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f5f5f4' }}>
            <th style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #d6d3d1', width: 30 }}>#</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #d6d3d1' }}>ขนาด</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #d6d3d1' }}>เข้าเล่ม</th>
            <th style={{ padding: '4px 6px', textAlign: 'right', border: '1px solid #d6d3d1', width: 80 }}>จำนวน</th>
            <th style={{ padding: '4px 6px', textAlign: 'left', border: '1px solid #d6d3d1' }}>คำสั่งพิเศษ</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i}>
              <td style={{ padding: '4px 6px', border: '1px solid #d6d3d1' }}>{i + 1}</td>
              <td style={{ padding: '4px 6px', border: '1px solid #d6d3d1' }}>{it.size || ''}</td>
              <td style={{ padding: '4px 6px', border: '1px solid #d6d3d1' }}>{it.binding || ''}</td>
              <td style={{ padding: '4px 6px', border: '1px solid #d6d3d1', textAlign: 'right' }}>
                {it.qty || ''}
              </td>
              <td style={{ padding: '4px 6px', border: '1px solid #d6d3d1' }}>{it.special || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Subtitle({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11.5, fontWeight: 600, color: '#374151',
        display: inline ? 'inline-block' : 'block',
        marginRight: inline ? 6 : 0,
        marginBottom: inline ? 0 : 3,
      }}
    >
      {children}
    </span>
  );
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{ fontFamily: 'system-ui', padding: 24 }}>
      <h1 style={{ color: '#b91c1c' }}>โหลดใบสั่งไม่สำเร็จ</h1>
      <pre style={{ background: '#fef2f2', padding: 12, borderRadius: 6 }}>{message}</pre>
    </div>
  );
}
