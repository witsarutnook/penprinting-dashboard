import { getQuotaStats, AppsScriptError } from '@/lib/api';

/** Apps Script usage widget — 14-day daily request counts.
 *
 *  Surfaces the per-day call volume against Apps Script (loadAll, getOrder,
 *  bulk-forward, etc) so admins can spot quota trends before hitting the
 *  daily UrlFetchApp ceiling (50K calls / Workspace) or the 6-hour script
 *  runtime ceiling. Pairs with the daily synthetic latency check (LINE
 *  alert at 8 AM) for a complete usage picture.
 *
 *  Server-rendered — no client JS, just an inline SVG sparkline. ISR 5 min.
 *
 *  Pre-v5.10.9 Apps Script returns "Unknown action" for getQuotaStats
 *  → widget renders an empty state with a "redeploy Apps Script" hint
 *  rather than throwing. */
export async function QuotaUsageWidget() {
  let stats;
  let error: string | null = null;
  try {
    stats = await getQuotaStats();
  } catch (err) {
    error = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error ? err.message : String(err);
  }

  if (error) {
    return (
      <section className="mt-8 bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-3">
          Apps Script usage (14 วัน)
        </h2>
        <div className="text-xs text-amber-700 font-mono">โหลด stats ไม่สำเร็จ — {error}</div>
      </section>
    );
  }

  if (!stats || stats.daily.length === 0) {
    return (
      <section className="mt-8 bg-white rounded-xl border border-stone-200 p-5">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide mb-1">
          Apps Script usage (14 วัน)
        </h2>
        <p className="text-xs text-stone-500">
          ยังไม่มี stats — Apps Script ต้อง redeploy เป็น v5.10.9+ (เพิ่ม <code className="bg-stone-100 px-1 rounded">getQuotaStats</code> action) แล้ว counter จะเริ่มสะสม
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 bg-white rounded-xl border border-stone-200 p-5">
      <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-sm font-medium text-stone-500 uppercase tracking-wide">
          Apps Script usage
        </h2>
        <span className="text-[11px] text-stone-400">14 วันล่าสุด · refresh ทุก 5 นาที</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <Stat label="วันนี้" value={stats.todayCount} unit="ครั้ง" emphasis />
        <Stat label="รวม 14 วัน" value={stats.windowTotal} unit="ครั้ง" />
        <Stat label="พีคต่อวัน" value={stats.peak} unit="ครั้ง" />
      </div>

      <Sparkline daily={stats.daily} peak={stats.peak} />

      <p className="text-[11px] text-stone-400 mt-3">
        นับทุก doGet/doPost ที่ผ่าน auth — รวมหน้า dashboard, modal, /track, cron jobs.
        ไม่นับ requests ที่ rate-limited ที่ Vercel ก่อนถึง Apps Script.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: number;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`tabular-nums ${
            emphasis ? 'text-3xl font-bold text-stone-900' : 'text-2xl font-semibold text-stone-700'
          }`}
        >
          {value.toLocaleString('en-US')}
        </span>
        <span className="text-xs text-stone-500">{unit}</span>
      </div>
    </div>
  );
}

function Sparkline({
  daily,
  peak,
}: {
  daily: { date: string; count: number }[];
  peak: number;
}) {
  const width = 100; // viewBox unit; scales with container
  const height = 36;
  const barCount = daily.length;
  const gap = 0.4;
  const barW = (width - gap * (barCount - 1)) / barCount;
  const scale = peak > 0 ? height / peak : 0;
  const today = daily[daily.length - 1]?.date;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-12"
        role="img"
        aria-label="Apps Script daily usage sparkline"
      >
        {daily.map((d, i) => {
          const h = scale > 0 ? Math.max(d.count * scale, d.count > 0 ? 1 : 0) : 0;
          const x = i * (barW + gap);
          const y = height - h;
          const isToday = d.date === today;
          const fill = isToday ? '#1a202c' : '#cbd5e1';
          return (
            <rect
              key={d.date}
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={fill}
              rx="0.4"
            >
              <title>{`${d.date}: ${d.count.toLocaleString('en-US')} ครั้ง`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-stone-400 tabular-nums">
        <span>{daily[0]?.date.slice(5) ?? ''}</span>
        <span>{today?.slice(5) ?? ''}</span>
      </div>
    </div>
  );
}
