// app/quote-logs/[id]/page.tsx — transcript viewer (admin only, read-only).
// บับเบิล user ซ้าย / assistant ขวา + quote cards แทรกตามเวลา (mergeTimeline).
// Flag ผูกกับบับเบิลเฉพาะเมื่อ snapshot text ตรงกัน — index drift → detached section.
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { loadQuoteLogDetail, mergeTimeline, type TurnFlag } from '@/lib/ai-quote/logs';
import { FlagButton } from './flag-button';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'บทสนทนา — AI Logs' };

const CHANNEL_LABEL: Record<string, string> = {
  line: 'LINE', messenger: 'Messenger', dashboard: 'ทีมงาน (dashboard)',
};

function fmtBkk(iso: string | undefined, withDate = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    ...(withDate ? { day: '2-digit', month: 'short' } : {}),
    hour: '2-digit', minute: '2-digit',
  });
}

const PRODUCT_LABEL: Record<string, string> = {
  brochure: 'โบรชัวร์/ใบปลิว', book: 'หนังสือ', notebook: 'สมุด',
  box: 'กล่อง', bag: 'ถุงกระดาษ', namecard: 'นามบัตร',
};

function specSummary(spec: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(spec)) {
    if (v == null) continue;
    parts.push(typeof v === 'object' ? `${k}:${JSON.stringify(v)}` : `${k}:${String(v)}`);
  }
  const s = parts.join(' · ');
  return s.length > 220 ? `${s.slice(0, 220)}…` : s;
}

export default async function QuoteLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) redirect('/login?next=/quote-logs');
  if (session.role !== 'admin') redirect('/board');

  const { id } = await params;
  const detail = await loadQuoteLogDetail(Number(id));
  if (!detail) notFound();

  const items = mergeTimeline(detail.conversation, detail.quotes);
  const flagByIndex = new Map<number, TurnFlag>(detail.flags.map((f) => [f.turnIndex, f]));
  // flag ผูกบับเบิลได้เมื่อ text ตรง snapshot — ไม่ตรง = index drift → detached
  const detached = detail.flags.filter((f) => {
    const turn = detail.conversation[f.turnIndex];
    return !turn || turn.text.slice(0, 1000) !== f.turnText;
  });
  const detachedIds = new Set(detached.map((f) => f.id));

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="pl-4 pr-12 sm:pl-6 sm:pr-6 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/quote-logs" className="text-xs text-stone-400 hover:text-stone-600 underline">← AI Logs</Link>
          <h1 className="text-lg font-bold text-stone-900">
            #{detail.id} · {CHANNEL_LABEL[detail.channel] ?? detail.channel}
            {detail.customerName ? ` · ${detail.customerName}` : ''}
          </h1>
          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] ${
            detail.leadStatus === 'escalated' ? 'bg-amber-50 text-amber-700'
            : detail.leadStatus === 'กำลังติดตาม' ? 'bg-blue-50 text-blue-700'
            : 'bg-stone-100 text-stone-500'
          }`}>{detail.leadStatus}</span>
          <span className="text-xs text-stone-400">
            เริ่ม {fmtBkk(detail.createdAt, true)} · ล่าสุด {fmtBkk(detail.updatedAt, true)}
          </span>
          {detail.leadStatus !== 'ใหม่' && (
            <Link href="/quote-leads" className="text-xs text-stone-400 underline hover:text-stone-600">ไปหน้า Lead</Link>
          )}
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 max-w-3xl mx-auto space-y-3">
        {detail.conversation.length === 0 && (
          <div className="rounded-lg border border-stone-200 bg-white px-4 py-8 text-center text-xs text-stone-400">
            session นี้ไม่มีข้อความ (เข้าโหมดแล้วไม่ได้คุย)
          </div>
        )}

        {items.map((item, i) => {
          if (item.kind === 'quote') {
            return (
              <div key={`q-${item.quote.id}`} className="mx-auto w-fit max-w-full rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                🧮 <strong>{PRODUCT_LABEL[item.quote.productType] ?? item.quote.productType}</strong>
                {' — '}{specSummary(item.quote.spec)}
                {' → '}<strong className="tabular-nums">{item.quote.unitPrice.toLocaleString('th-TH', { maximumFractionDigits: 4 })} บาท/หน่วย</strong>
                {fmtBkk(item.quote.createdAt) && <span className="ml-2 opacity-60">{fmtBkk(item.quote.createdAt)}</span>}
              </div>
            );
          }
          const { index, turn } = item;
          const isAi = turn.role === 'assistant';
          const flag = flagByIndex.get(index);
          const anchored = flag && !detachedIds.has(flag.id) ? flag : undefined;
          return (
            <div key={`t-${i}`} id={`turn-${index}`} className={`flex ${isAi ? 'justify-end' : 'justify-start'} scroll-mt-20`}>
              <div className={`max-w-[85%] sm:max-w-[75%] space-y-1 ${isAi ? 'items-end' : 'items-start'}`}>
                <div className={`rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                  isAi
                    ? `bg-accent/10 text-stone-900 rounded-br-sm ${anchored ? 'ring-2 ring-red-400' : ''}`
                    : 'bg-stone-100 text-stone-800 rounded-bl-sm'
                }`}>
                  {turn.text}
                </div>
                <div className={`flex items-center gap-2 text-[11px] text-stone-400 ${isAi ? 'justify-end' : ''}`}>
                  {!isAi && <span>ลูกค้า</span>}
                  {fmtBkk(turn.ts) && <span>{fmtBkk(turn.ts)}</span>}
                  {isAi && (
                    <FlagButton
                      sessionId={detail.id}
                      turnIndex={index}
                      flagged={Boolean(anchored)}
                      note={anchored?.note ?? null}
                    />
                  )}
                  {isAi && <span>น้อง PP</span>}
                </div>
                {anchored?.note && (
                  <p className={`text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1 ${isAi ? 'text-right' : ''}`}>📝 {anchored.note}</p>
                )}
              </div>
            </div>
          );
        })}

        {detached.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50/50 p-3 space-y-2">
            <p className="text-xs font-medium text-red-700">🚩 tags ที่ตำแหน่งไม่ตรงแล้ว (แสดงจาก snapshot)</p>
            {detached.map((f) => (
              <div key={f.id} className="text-xs text-stone-600">
                <p className="border-l-2 border-red-200 pl-2 line-clamp-2">{f.turnText}</p>
                {f.note && <p className="text-amber-700 mt-0.5">📝 {f.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
