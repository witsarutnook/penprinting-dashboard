import {
  type BoardColumn,
  type Dept,
} from '@/lib/board';
import { Card } from './card';

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
          column.jobs.map((job) => (
            <Card key={job.id} job={job} dept={dept} isVendorCol={isVendor} />
          ))
        )}
      </div>
    </div>
  );
}
