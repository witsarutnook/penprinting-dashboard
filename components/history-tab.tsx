'use client';

import { useEffect, useState, type JSX } from 'react';
import {
  IconAlertCircle,
  IconCheck,
  IconCornerUpRight,
  IconFilePlus,
  IconInfo,
  IconPencil,
  IconPlus,
  IconRefreshCw,
  IconTrash,
  IconTruck,
  IconUsers,
  IconXCircle,
} from '@/lib/icons';

/** Audit timeline tab — fetches from /api/audit on mount, renders chronological
 *  list of actions with icon + label + timestamp + summary + role.
 *
 *  Drop-in replacement for the "ประวัติ" placeholder in /board card detail
 *  + /orders detail modal. Mirrors WP `renderJobHistoryTab` (production-monitoring.js
 *  ~line 1066) — same data shape, same chronological ordering, Thai labels. */

type IconComponent = (props: { size?: number; className?: string }) => JSX.Element;

const ACTION_ICON: Record<string, IconComponent> = {
  // Order lifecycle
  addOrder: IconFilePlus,
  createOrder: IconFilePlus,
  updateOrder: IconPencil,
  deleteOrder: IconTrash,
  deleteOrderCascade: IconTrash,
  cancelOrder: IconXCircle,
  promoteDraft: IconCheck,
  // Job lifecycle
  addJob: IconPlus,
  updateJob: IconPencil,
  deleteJob: IconTrash,
  cancelJob: IconXCircle,
  restoreJob: IconRefreshCw,
  moveToShipped: IconTruck,
  // Forwards (WP used "forward"; v2 uses "bulkForward")
  bulkForward: IconCornerUpRight,
  // Co-work
  setCowork: IconUsers,
};

const ACTION_LABEL: Record<string, string> = {
  addOrder: 'สั่งงาน',
  createOrder: 'สั่งงาน',
  updateOrder: 'แก้ไขใบสั่ง',
  deleteOrder: 'ลบใบสั่ง',
  deleteOrderCascade: 'ลบใบสั่ง (cascade)',
  cancelOrder: 'ยกเลิกใบสั่ง',
  promoteDraft: 'ส่งเข้าระบบ',
  addJob: 'เพิ่มงาน',
  updateJob: 'แก้ไขงาน',
  deleteJob: 'ลบงาน',
  cancelJob: 'ยกเลิกงาน',
  restoreJob: 'กู้คืนงาน',
  moveToShipped: 'จัดส่ง',
  bulkForward: 'ส่งงานต่อ',
  setCowork: 'Co-work',
};

interface AuditEntry {
  timestamp: string;
  role: string;
  action: string;
  targetId: string;
  summary: string;
}

function formatAuditTime(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface HistoryTabProps {
  jobId?: number | string | null;
  orderId?: number | string | null;
}

export function HistoryTab({ jobId, orderId }: HistoryTabProps) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);

    const params = new URLSearchParams();
    if (jobId != null && String(jobId).trim()) params.set('jobId', String(jobId));
    if (orderId != null && String(orderId).trim()) params.set('orderId', String(orderId));
    if (params.toString().length === 0) {
      setEntries([]);
      return;
    }

    fetch(`/api/audit?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error || `HTTP ${res.status}`);
          setEntries([]);
          return;
        }
        setEntries(json.entries || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, [jobId, orderId]);

  if (entries === null) {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-stone-100 text-stone-400 mx-auto">
          <IconRefreshCw size={18} className="animate-spin" />
        </div>
        <p className="text-sm text-stone-500">กำลังโหลดประวัติ...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2 m-3">
        <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
        <span>โหลดประวัติไม่ได้ — {error}</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-stone-100 text-stone-400 mx-auto">
          <IconInfo size={18} />
        </div>
        <p className="text-sm text-stone-500">ยังไม่มีประวัติการทำงาน</p>
      </div>
    );
  }

  return (
    <ol className="relative ml-3 border-l border-stone-200 space-y-4 py-2 pr-3">
      {entries.map((entry, i) => {
        const Icon = ACTION_ICON[entry.action] || IconInfo;
        const label = ACTION_LABEL[entry.action] || entry.action;
        return (
          <li key={`${entry.timestamp}-${i}`} className="relative pl-6">
            <span className="absolute -left-[11px] top-0 inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-white border border-stone-200 text-stone-600">
              <Icon size={12} />
            </span>
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-sm font-medium text-stone-900">{label}</span>
              <span className="text-xs text-stone-400 tabular-nums">
                {formatAuditTime(entry.timestamp)}
              </span>
            </div>
            {entry.summary && (
              <div className="text-xs text-stone-600 mt-0.5 break-words">{entry.summary}</div>
            )}
            {entry.role && (
              <div className="text-[11px] text-stone-400 mt-0.5">โดย: {entry.role}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
