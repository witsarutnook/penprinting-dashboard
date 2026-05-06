'use client';

import { useState } from 'react';
import {
  type CalendarDay,
  type Urgency,
  URGENCY_LABELS,
  URGENCY_COLORS,
  DEPT_LABELS,
  type Dept,
} from '@/lib/calendar';
import { IconUser, IconFolder } from '@/lib/icons';

const TH_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

export function CalendarGrid({ days, todayKey }: { days: CalendarDay[]; todayKey: string }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedDay = selectedKey ? days.find((d) => d.key === selectedKey) : null;

  return (
    <>
      {/* Weekday header (desktop only — mobile uses 1-col list view) */}
      <div className="hidden sm:grid grid-cols-7 gap-1 mb-1">
        {TH_WEEKDAYS.map((w) => (
          <div key={w} className="text-center text-xs font-medium text-stone-500 py-1">
            {w}
          </div>
        ))}
      </div>

      {/* Desktop: 7-col grid */}
      <div className="hidden sm:grid grid-cols-7 gap-1">
        {days.map((d) => (
          <DayCell
            key={d.key}
            day={d}
            todayKey={todayKey}
            isSelected={d.key === selectedKey}
            onClick={() => {
              if (d.jobs.length === 0 || !d.inMonth) return;
              setSelectedKey(d.key === selectedKey ? null : d.key);
            }}
          />
        ))}
      </div>

      {/* Mobile: vertical list — only days WITH jobs (skip empties to save space) */}
      <div className="sm:hidden space-y-1.5">
        {days.filter((d) => d.inMonth && d.jobs.length > 0).map((d) => (
          <MobileDayRow
            key={d.key}
            day={d}
            isSelected={d.key === selectedKey}
            onClick={() => setSelectedKey(d.key === selectedKey ? null : d.key)}
          />
        ))}
        {days.filter((d) => d.inMonth && d.jobs.length > 0).length === 0 && (
          <div className="text-center text-stone-400 text-sm py-12">
            ไม่มีงานในเดือนนี้ (หรือ filter ไม่ตรง)
          </div>
        )}
      </div>

      {/* Selected day detail panel — desktop sticky beneath grid */}
      {selectedDay && selectedDay.jobs.length > 0 && (
        <div className="hidden sm:block mt-4">
          <DayDetail day={selectedDay} />
        </div>
      )}
    </>
  );
}

// ─── Desktop cell ──────────────────────────────────────────

function DayCell({
  day,
  todayKey,
  isSelected,
  onClick,
}: {
  day: CalendarDay;
  todayKey: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  const total = day.jobs.length;
  const clickable = day.inMonth && total > 0;

  // Background tint by load
  let bg = 'bg-white';
  if (day.inMonth && total > 0) {
    if (day.counts.overdue > 0) bg = 'bg-red-50';
    else if (total >= 7) bg = 'bg-amber-50';
    else if (total >= 4) bg = 'bg-yellow-50';
    else bg = 'bg-blue-50';
  } else if (!day.inMonth) {
    bg = 'bg-stone-50';
  }

  const borderClass =
    day.key === todayKey
      ? 'ring-2 ring-accent'
      : isSelected
        ? 'ring-2 ring-stone-400'
        : '';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`min-h-[88px] rounded-md border border-stone-200 ${bg} ${borderClass} p-1.5 text-left transition-all ${
        clickable ? 'hover:border-stone-300 cursor-pointer' : 'cursor-default'
      } ${!day.inMonth ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-sm font-medium ${
            day.key === todayKey
              ? 'text-accent'
              : day.isWeekend
                ? 'text-stone-400'
                : 'text-stone-700'
          }`}
        >
          {day.dayNum}
        </span>
        {total > 0 && day.inMonth && (
          <span className="text-[10px] tabular-nums text-stone-500 bg-white/70 px-1 rounded">
            {total}
          </span>
        )}
      </div>
      {day.inMonth && total > 0 && (
        <div className="flex flex-wrap gap-0.5 mt-1">
          {(['overdue', 'dday', 'urgent', 'normal'] as Urgency[]).map((u) =>
            day.counts[u] > 0 ? (
              <span
                key={u}
                className="text-[10px] font-semibold rounded px-1 py-0.5 leading-none tabular-nums"
                style={{ background: URGENCY_COLORS[u] + '25', color: URGENCY_COLORS[u] }}
              >
                {day.counts[u]}
              </span>
            ) : null,
          )}
        </div>
      )}
    </button>
  );
}

// ─── Mobile row ────────────────────────────────────────────

function MobileDayRow({
  day,
  isSelected,
  onClick,
}: {
  day: CalendarDay;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-stone-200 overflow-hidden">
      <button
        type="button"
        onClick={onClick}
        className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-stone-50"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 text-center ${
              day.isToday ? 'text-accent font-semibold' : 'text-stone-700'
            }`}
          >
            <div className="text-lg leading-none tabular-nums">{day.dayNum}</div>
            <div className="text-[10px] text-stone-500 mt-0.5">{TH_WEEKDAYS[day.weekday]}</div>
          </div>
          <div>
            <div className="text-sm text-stone-900">{day.jobs.length} รายการ</div>
            <div className="flex gap-1 mt-0.5">
              {(['overdue', 'dday', 'urgent', 'normal'] as Urgency[]).map((u) =>
                day.counts[u] > 0 ? (
                  <span
                    key={u}
                    className="text-[10px] font-semibold rounded px-1 py-0.5 leading-none tabular-nums"
                    style={{ background: URGENCY_COLORS[u] + '25', color: URGENCY_COLORS[u] }}
                  >
                    {day.counts[u]}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>
        <span className="text-stone-400 text-sm">{isSelected ? '▴' : '▾'}</span>
      </button>
      {isSelected && (
        <div className="border-t border-stone-100 px-3 py-2 bg-stone-50/50">
          <DayJobsList jobs={day.jobs} />
        </div>
      )}
    </div>
  );
}

// ─── Detail panel (desktop) ────────────────────────────────

function DayDetail({ day }: { day: CalendarDay }) {
  const [y, m, d] = day.key.split('-').map(Number);
  const dateLabel = `${d} ${
    [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ][m - 1]
  } ${y + 543}`;
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-4">
      <h3 className="text-sm font-semibold text-stone-900 mb-3">
        {dateLabel} — {day.jobs.length} รายการ
      </h3>
      <DayJobsList jobs={day.jobs} />
    </div>
  );
}

// ─── Shared: jobs list ─────────────────────────────────────

function DayJobsList({ jobs }: { jobs: CalendarDay['jobs'] }) {
  return (
    <ul className="space-y-1.5">
      {jobs.map((j) => (
        <li
          key={j.id}
          className="flex items-start gap-2 text-sm rounded-md px-2 py-1.5"
          style={{ background: URGENCY_COLORS[j.urgency] + '12' }}
        >
          <span
            className="text-[10px] font-semibold rounded px-1.5 py-0.5 leading-none mt-0.5 whitespace-nowrap"
            style={{ background: URGENCY_COLORS[j.urgency], color: 'white' }}
          >
            {URGENCY_LABELS[j.urgency]}
          </span>
          <div className="flex-grow min-w-0">
            <div className="text-stone-900 truncate">{j.name || '(ไม่มีชื่อ)'}</div>
            <div className="text-xs text-stone-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              {j.customer && (
                <span className="inline-flex items-center gap-1">
                  <IconUser size={11} />
                  {j.customer}
                </span>
              )}
              {(j.dept as Dept) in DEPT_LABELS && (
                <span className="inline-flex items-center gap-1">
                  <IconFolder size={11} />
                  {DEPT_LABELS[j.dept as Dept]}
                </span>
              )}
              {j.staff && <span>· {j.staff}</span>}
              <span className="text-stone-400">#{j.id}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
