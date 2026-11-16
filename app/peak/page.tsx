// app/peak/page.tsx — Peak connection status (admin only).
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { isPostgresConfigured } from '@/lib/postgres';
import { getPeakConnectionStatus, type PeakConnectionStatus } from '@/lib/peak/token-store';
import { peakOrderDb } from '@/lib/peak-order/db';
import { peakOrderConfig } from '@/lib/peak-order/deps';
import { PeakClient, StaffList } from './peak-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'เชื่อมต่อ Peak' };

const ERROR_TEXT: Record<string, string> = {
  state: 'การยืนยันตัวตนไม่ตรงกันหรือหมดอายุ กรุณากดเชื่อมต่อใหม่',
  denied: 'Peak ไม่อนุญาตการเชื่อมต่อ',
  exchange: 'แลกโทเค็นกับ Peak ไม่สำเร็จ กรุณาลองใหม่',
  config: 'ยังไม่ได้ตั้งค่า PEAK_TOKEN_ENC_KEY หรือค่าไม่ถูกต้อง',
};

function fmtBkk(iso: string | null): string {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export default async function PeakPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/peak');
  if (session.role !== 'admin') redirect('/board');

  const sp = await searchParams;
  const keyMissing = !process.env.PEAK_TOKEN_ENC_KEY;
  const dbReady = isPostgresConfigured();

  let status: PeakConnectionStatus | null = null;
  let dbFailed = false;
  if (dbReady) {
    try {
      status = await getPeakConnectionStatus();
    } catch {
      dbFailed = true;
    }
  }

  const cfg = peakOrderConfig();
  const tail4 = (id: string) => `…${id.slice(-4)}`;

  let staff: Awaited<ReturnType<typeof peakOrderDb.listStaff>> = [];
  let staffFailed = false;
  if (dbReady) {
    try {
      staff = await peakOrderDb.listStaff();
    } catch {
      staffFailed = true;
    }
  }

  // Own keys only: `?error=__proto__` must not read Object.prototype.
  const errorText = typeof sp.error === 'string' && Object.hasOwn(ERROR_TEXT, sp.error) ? ERROR_TEXT[sp.error] : undefined;

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="pl-4 pr-12 sm:pl-6 sm:pr-6 py-3 flex items-center gap-3">
          <h1 className="text-xl font-bold text-stone-900">เชื่อมต่อ Peak</h1>
          <span className="text-xs text-stone-400">อ่านใบเสนอราคาเพื่อสร้างใบสั่งงานจาก LINE</span>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-3xl mx-auto space-y-4">
        {sp.connected === '1' && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            เชื่อมต่อ Peak สำเร็จ
          </div>
        )}
        {errorText && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorText}
          </div>
        )}
        {keyMissing && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            ยังไม่ได้ตั้งค่า PEAK_TOKEN_ENC_KEY — ยังเชื่อมต่อ Peak ไม่ได้
          </div>
        )}
        {!dbReady || dbFailed ? (
          <div className="rounded-md border border-stone-200 bg-white px-3 py-4 text-sm text-stone-600">
            {dbReady ? 'อ่านสถานะจากฐานข้อมูลไม่ได้ในขณะนี้' : 'ยังไม่ได้ตั้งค่าฐานข้อมูล'}
          </div>
        ) : (
          <dl className="rounded-md border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
            <Row label="สถานะ" value={status?.connected ? 'เชื่อมต่อแล้ว' : 'ยังไม่ได้เชื่อมต่อ'} />
            <Row label="สิทธิ์ (scope)" value={status?.scope ?? '–'} />
            <Row label="ใช้งานได้ล่าสุด" value={fmtBkk(status?.lastOkAt ?? null)} />
            <Row
              label="ข้อผิดพลาดล่าสุด"
              value={status?.lastError ? `${status.lastError} (${fmtBkk(status.lastErrorAt)})` : '–'}
            />
          </dl>
        )}
        <PeakClient connected={Boolean(status?.connected)} />
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-900">คำสั่ง /order ใน LINE</h2>
          <dl className="rounded-md border border-stone-200 bg-white divide-y divide-stone-100 text-sm">
            <Row label="สถานะ" value={cfg.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่'} />
            <Row label="จำนวนกลุ่มที่อนุญาต" value={String(cfg.groupIds.length)} />
            <Row
              label="กลุ่ม (4 ตัวท้าย)"
              value={cfg.groupIds.length ? cfg.groupIds.map(tail4).join(', ') : '–'}
            />
          </dl>
        </section>
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-stone-900">ผู้สั่งงานที่ผูกกับ LINE</h2>
          {!dbReady ? (
            <p className="text-sm text-stone-600">ยังไม่ได้ตั้งค่าฐานข้อมูล</p>
          ) : staffFailed ? (
            <p className="text-sm text-stone-600">อ่านรายชื่อจากฐานข้อมูลไม่ได้ในขณะนี้</p>
          ) : (
            <StaffList
              rows={staff.map((r) => ({
                lineUserId: r.lineUserId,
                orderer: r.orderer,
                displayName: r.displayName,
                date: fmtBkk(r.createdAt),
              }))}
            />
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 px-3 py-2">
      <dt className="w-40 shrink-0 text-stone-500">{label}</dt>
      <dd className="text-stone-900 break-words min-w-0">{value}</dd>
    </div>
  );
}
