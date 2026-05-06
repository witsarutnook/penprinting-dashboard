import { type BoardColumn, type Dept } from '@/lib/board';
import { getStaffTheme } from '@/lib/staff-icons';
import { Card } from './card';

const VENDOR_PURPLE = '#7c3aed';

/** Per-staff column. WP-style icon-header card on top, then a vertical
 *  list of jobs underneath. Vendor staff (outsource / diecut_out) get a
 *  purple accent line + tinted bg. */
export function Column({
  dept,
  column,
  sessionRole,
}: {
  dept: Dept;
  column: BoardColumn;
  sessionRole: string | null;
}) {
  const isVendor = !!column.staff.isVendor;
  const theme = getStaffTheme(dept, column.staff.id);
  return (
    <div
      className="flex flex-col rounded-2xl border bg-white"
      style={{
        borderColor: isVendor ? `${VENDOR_PURPLE}30` : '#e7e5e4',
        borderBottomColor: isVendor ? VENDOR_PURPLE : undefined,
        borderBottomWidth: isVendor ? 2 : 1,
      }}
    >
      {/* Icon header */}
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b border-stone-100 rounded-t-2xl ${
          isVendor ? 'bg-violet-50/40' : ''
        }`}
      >
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${theme.bgClass}`}
        >
          <theme.Icon size={22} className={theme.iconClass} />
        </div>
        <div className="min-w-0 flex-grow">
          <div
            className="text-sm font-semibold truncate"
            style={{ color: isVendor ? VENDOR_PURPLE : '#1c1917' }}
          >
            {column.staff.name}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 truncate">
            {column.staff.role}
          </div>
        </div>
        <span
          className="text-sm font-semibold tabular-nums px-2 py-0.5 rounded-md flex-shrink-0"
          style={{
            background: isVendor ? `${VENDOR_PURPLE}15` : '#f5f5f4',
            color: isVendor ? VENDOR_PURPLE : '#57534e',
          }}
        >
          {column.jobs.length}
        </span>
      </div>

      {/* Job list */}
      <div className="flex-grow p-2.5 space-y-2 min-h-[80px] overflow-y-auto">
        {column.jobs.length === 0 ? (
          <div className="text-center text-stone-300 text-xs py-8">ไม่มีงานค้าง</div>
        ) : (
          column.jobs.map((job) => (
            <Card
              key={job.id}
              job={job}
              dept={dept}
              isVendorCol={isVendor}
              sessionRole={sessionRole}
            />
          ))
        )}
      </div>
    </div>
  );
}
