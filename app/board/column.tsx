import {
  type BoardColumn,
  type Dept,
  type BoardJob,
  URGENCY_COLORS,
  URGENCY_LABELS,
} from '@/lib/board';

const VENDOR_PURPLE = '#7c3aed';

/** Column for one staff/machine. ~280px wide on desktop, swipe-scroll on mobile. */
export function Column({ dept, column }: { dept: Dept; column: BoardColumn }) {
  const isVendor = !!column.staff.isVendor;
  const headerBg = isVendor ? `${VENDOR_PURPLE}10` : '#ffffff';
  const borderColor = isVendor ? `${VENDOR_PURPLE}40` : '#e7e5e4';
  return (
    <div
      className="flex-shrink-0 w-[260px] sm:w-[280px] flex flex-col rounded-xl border bg-white"
      style={{ borderColor }}
    >
      <div
        className="px-3 py-2 border-b rounded-t-xl"
        style={{ background: headerBg, borderColor }}
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: isVendor ? VENDOR_PURPLE : '#1c1917' }}
          >
            {column.staff.name}
          </span>
          <span
            className="text-[11px] tabular-nums px-1.5 py-0.5 rounded"
            style={{
              background: isVendor ? `${VENDOR_PURPLE}20` : '#f5f5f4',
              color: isVendor ? VENDOR_PURPLE : '#78716c',
            }}
          >
            {column.jobs.length}
          </span>
        </div>
        <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">
          {column.staff.role}
        </div>
      </div>

      <div className="flex-grow p-2 space-y-1.5 min-h-[60px] max-h-[600px] overflow-y-auto">
        {column.jobs.length === 0 ? (
          <div className="text-center text-stone-300 text-xs py-4">—</div>
        ) : (
          column.jobs.map((job) => <Card key={job.id} job={job} dept={dept} isVendorCol={isVendor} />)
        )}
      </div>
    </div>
  );
}

function Card({ job, isVendorCol }: { job: BoardJob; dept: Dept; isVendorCol: boolean }) {
  const urgencyColor = URGENCY_COLORS[job.urgency];
  return (
    <div
      className="rounded-md border bg-white p-2 hover:shadow-sm transition-shadow"
      style={{
        borderColor: isVendorCol ? `${VENDOR_PURPLE}30` : '#e7e5e4',
        borderLeft: `3px solid ${urgencyColor}`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] font-medium text-stone-900 leading-snug flex-grow break-words">
          {job.name || <span className="text-stone-400">(ไม่มีชื่อ)</span>}
        </div>
        {job.hasCowork && (
          <span
            className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap"
            title="มี co-work"
          >
            +CW
          </span>
        )}
      </div>

      {job.customer && (
        <div className="text-[11px] text-stone-500 mt-1 truncate" title={job.customer}>
          👤 {job.customer}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px]">
        <span
          className="px-1.5 py-0.5 rounded font-medium tabular-nums"
          style={{ background: urgencyColor + '20', color: urgencyColor }}
        >
          {URGENCY_LABELS[job.urgency]}
          {job.daysUntilDue !== null && job.urgency === 'overdue' && (
            <span className="ml-1">({job.daysUntilDue}d)</span>
          )}
          {job.daysUntilDue !== null && job.urgency === 'urgent' && (
            <span className="ml-1">(D-{job.daysUntilDue})</span>
          )}
        </span>
        <span className="text-stone-400 tabular-nums">{job.dateRaw}</span>
      </div>

      {job.orderId && (
        <div className="text-[10px] text-stone-400 mt-1 tabular-nums">#{job.id} · order {job.orderId}</div>
      )}
    </div>
  );
}
