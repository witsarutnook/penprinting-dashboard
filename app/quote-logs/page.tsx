// app/quote-logs/page.tsx — AI conversation log viewer (admin only).
// List ทุก ai_quote_sessions + filter URL params · view=flags = worklist ปรับ prompt.
// Read-only ต่อบทสนทนา — mutation เดียวคือ flag ผ่าน /api/ai-quote/flags.
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { loadQuoteLogSessions, loadAllFlags, type QuoteLogFilters } from '@/lib/ai-quote/logs';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'AI Logs' };

const CHANNEL_LABEL: Record<string, string> = {
  line: 'LINE',
  messenger: 'Messenger',
  dashboard: 'ทีมงาน',
};

function fmtBkk(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/** สร้าง href ที่คง filter เดิม + override บาง param (ค่า undefined = ลบ param) */
function hrefWith(sp: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...sp, ...patch })) {
    if (v != null && v !== '') merged[k] = v;
  }
  delete merged.page; // เปลี่ยน filter = กลับหน้า 1 (ใส่ page กลับผ่าน patch ได้)
  if (patch.page) merged.page = patch.page;
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/quote-logs?${qs}` : '/quote-logs';
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-stone-900 text-white border-stone-900'
          : 'bg-white text-stone-600 border-stone-200 hover:border-stone-400'
      }`}
    >
      {children}
    </Link>
  );
}

export default async function QuoteLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/quote-logs');
  if (session.role !== 'admin') redirect('/board');

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const view = sp.view === 'flags' ? 'flags' : 'list';

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="pl-4 pr-12 sm:pl-6 sm:pr-6 py-3 flex items-center gap-3">
          <h1 className="text-xl font-bold text-stone-900">AI Logs</h1>
          <span className="text-xs text-stone-400">บทสนทนาลูกค้า ↔ น้อง PP ย้อนหลัง</span>
        </div>
      </header>
      <div className="px-4 sm:px-6 py-4 max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Chip href={hrefWith(sp, { view: undefined })} active={view === 'list'}>บทสนทนา</Chip>
          <Chip href={hrefWith(sp, { view: 'flags' })} active={view === 'flags'}>🚩 ที่ tag ไว้</Chip>
        </div>
        {view === 'flags'
          ? <FlagsView page={page} sp={sp} />
          : <ListView page={page} sp={sp} />}
      </div>
    </DashboardShell>
  );
}

async function ListView({ page, sp }: { page: number; sp: Record<string, string | undefined> }) {
  const filters: QuoteLogFilters = {
    channel: (['line', 'messenger', 'dashboard', 'customer'] as const).find((c) => c === sp.channel),
    q: sp.q,
    flaggedOnly: sp.flagged === '1',
    status: sp.status,
    page,
  };
  const { rows, hasMore } = await loadQuoteLogSessions(filters);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip href={hrefWith(sp, { channel: undefined })} active={!sp.channel}>ทุกช่องทาง</Chip>
        <Chip href={hrefWith(sp, { channel: 'customer' })} active={sp.channel === 'customer'}>ลูกค้า</Chip>
        <Chip href={hrefWith(sp, { channel: 'line' })} active={sp.channel === 'line'}>LINE</Chip>
        <Chip href={hrefWith(sp, { channel: 'messenger' })} active={sp.channel === 'messenger'}>Messenger</Chip>
        <Chip href={hrefWith(sp, { channel: 'dashboard' })} active={sp.channel === 'dashboard'}>ทีมงาน</Chip>
        <span className="mx-1 h-4 w-px bg-stone-200" />
        <Chip href={hrefWith(sp, { flagged: sp.flagged === '1' ? undefined : '1' })} active={sp.flagged === '1'}>🚩 เฉพาะที่ tag</Chip>
        <Chip href={hrefWith(sp, { status: sp.status === 'escalated' ? undefined : 'escalated' })} active={sp.status === 'escalated'}>ส่งต่อทีมงาน</Chip>
        <form action="/quote-logs" className="ml-auto flex items-center gap-2">
          {sp.channel && <input type="hidden" name="channel" value={sp.channel} />}
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="ค้นชื่อ/contact ลูกค้า"
            className="rounded-md border border-stone-200 px-3 py-1.5 text-xs w-48"
          />
        </form>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-xs text-stone-400">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">ช่องทาง</th>
              <th className="px-3 py-2 font-medium">ลูกค้า</th>
              <th className="px-3 py-2 font-medium">สถานะ</th>
              <th className="px-3 py-2 font-medium text-right">เทิร์น</th>
              <th className="px-3 py-2 font-medium text-right">ราคา</th>
              <th className="px-3 py-2 font-medium text-right">🚩</th>
              <th className="px-3 py-2 font-medium">ล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-stone-400 text-xs">ไม่พบบทสนทนาตาม filter</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-stone-50 hover:bg-stone-50">
                <td className="px-3 py-2 text-stone-400 text-xs">{r.id}</td>
                <td className="px-3 py-2">
                  <span className="text-xs font-medium">{CHANNEL_LABEL[r.channel] ?? r.channel}</span>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/quote-logs/${r.id}`} className="text-stone-900 font-medium hover:underline">
                    {r.customerName ?? (r.channel === 'dashboard' ? 'ทีมงาน (dashboard)' : 'ไม่ระบุชื่อ')}
                  </Link>
                  {r.customerContact && <span className="ml-2 text-xs text-stone-400">{r.customerContact}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${
                    r.leadStatus === 'escalated' ? 'bg-amber-50 text-amber-700'
                    : r.leadStatus === 'กำลังติดตาม' ? 'bg-blue-50 text-blue-700'
                    : 'bg-stone-100 text-stone-500'
                  }`}>{r.leadStatus}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.turnCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.quoteCount}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.flagCount > 0 ? <span className="text-red-600 font-semibold">{r.flagCount}</span> : <span className="text-stone-300">–</span>}</td>
                <td className="px-3 py-2 text-xs text-stone-500 whitespace-nowrap">{fmtBkk(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-stone-400">
        <span>หน้า {page}</span>
        <div className="flex gap-2">
          {page > 1 && <Link className="underline" href={hrefWith(sp, { page: String(page - 1) })}>← ก่อนหน้า</Link>}
          {hasMore && <Link className="underline" href={hrefWith(sp, { page: String(page + 1) })}>หน้าถัดไป →</Link>}
        </div>
      </div>
    </>
  );
}

async function FlagsView({ page, sp }: { page: number; sp: Record<string, string | undefined> }) {
  const { rows, hasMore } = await loadAllFlags(page);
  return (
    <>
      <p className="text-xs text-stone-400">
        Worklist สำหรับรอบปรับ prompt — ข้อความ AI ที่ถูก tag ว่าตอบผิด พร้อมโน้ต (ลิงก์กระโดดไปตำแหน่งจริงในบทสนทนา)
      </p>
      {rows.length === 0 && (
        <div className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-center text-xs text-stone-400">
          ยังไม่มีข้อความที่ tag ไว้ — เปิดบทสนทนาแล้วกด 🚩 ที่ข้อความ AI ที่ตอบผิด
        </div>
      )}
      <div className="space-y-3">
        {rows.map((f) => (
          <div key={f.id} className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-stone-400">
              <span className="text-red-600">🚩</span>
              <span>{CHANNEL_LABEL[f.channel] ?? f.channel}</span>
              <span>·</span>
              <span>{f.customerName ?? 'ไม่ระบุชื่อ'}</span>
              <span>·</span>
              <span>{fmtBkk(f.createdAt)} โดย {f.flaggedBy}</span>
              <Link
                href={`/quote-logs/${f.sessionId}#turn-${f.turnIndex}`}
                className="ml-auto underline hover:text-stone-600"
              >
                เปิดบทสนทนา →
              </Link>
            </div>
            <p className="text-sm text-stone-700 border-l-2 border-stone-200 pl-3 line-clamp-3">{f.turnText}</p>
            {f.note && <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">📝 {f.note}</p>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-stone-400">
        <span>หน้า {page}</span>
        <div className="flex gap-2">
          {page > 1 && <Link className="underline" href={hrefWith(sp, { view: 'flags', page: String(page - 1) })}>← ก่อนหน้า</Link>}
          {hasMore && <Link className="underline" href={hrefWith(sp, { view: 'flags', page: String(page + 1) })}>หน้าถัดไป →</Link>}
        </div>
      </div>
    </>
  );
}
