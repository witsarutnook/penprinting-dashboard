'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useBulkMode } from './bulk-context';
import { IconCheckSquare } from '@/lib/icons';
import type { Urgency } from '@/lib/calendar';

interface ChipDef {
  key: '' | Urgency;
  label: string;
  /** Dot color (hex). Empty = no dot (the "ทั้งหมด" pill). */
  dotColor?: string;
}

const CHIPS: ChipDef[] = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'overdue', label: 'เลยกำหนด', dotColor: '#dc2626' },
  { key: 'dday', label: 'D-Day', dotColor: '#7c3aed' },
  { key: 'urgent', label: 'ด่วน ≤3 วัน', dotColor: '#f59e0b' },
  { key: 'normal', label: 'ปกติ', dotColor: '#22c55e' },
];

/** Pill-shaped urgency filter row + bulk-mode toggle. URL state via `?u=`. */
export function FilterChips() {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('u') || '';
  const { mode, toggleMode } = useBulkMode();

  function hrefFor(key: string): string {
    const next = new URLSearchParams(params.toString());
    if (key) next.set('u', key);
    else next.delete('u');
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {CHIPS.map((c) => {
        const active = current === c.key;
        const allActive = c.key === '' && active;
        return (
          <Link
            key={c.key || 'all'}
            href={hrefFor(c.key)}
            scroll={false}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              allActive
                ? 'bg-sky-600 text-white border-sky-600'
                : active
                  ? 'bg-white text-stone-900 border-stone-300'
                  : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
            }`}
          >
            {c.dotColor && (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: c.dotColor }}
              />
            )}
            {c.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={toggleMode}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ml-auto sm:ml-2 ${
          mode
            ? 'bg-red-50 text-red-700 border-red-300'
            : 'bg-white text-red-700 border-red-300 hover:bg-red-50'
        }`}
      >
        <IconCheckSquare size={13} />
        {mode ? 'ออกจากโหมดเลือก' : 'เลือกหลายงาน'}
      </button>
    </div>
  );
}
