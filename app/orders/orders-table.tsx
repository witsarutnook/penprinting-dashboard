'use client';

import { memo, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { displayDate } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import { URGENCY_COLORS } from '@/lib/calendar';
import {
  IconX, IconPencil, IconTrash, IconPrinter, IconAlertCircle, IconFileText,
  IconCheck, IconCornerUpRight,
} from '@/lib/icons';
import { useToast } from '@/components/toast-provider';
import { PageSizeBar } from '@/components/page-size-bar';

export interface OrderRow {
  id: number;
  name: string;
  customer: string;
  dateIn: string;
  dateDue: string;
  orderer?: string;
  pin?: string;
  orderStatus: string;
  orderStatusLabel: string;
  orderStatusClass: string;
  step: string;
  jobUrgency: string;
  jobUrgencyLabel: string;
  isOrphan: boolean;
  /** Where this row's job currently sits — for the modal "ขั้นตอนปัจจุบัน" hint. */
  jobDeptStaffLabel?: string;
}

interface Props {
  rows: OrderRow[];
  role: 'admin' | 'sales' | 'staff';
  /** Default 20. Server passes this from `?per=20|50|100` URL param. */
  perPage?: number;
}

/** WP-style /orders table: rows are clickable → opens a detail modal with
 *  the 5 quick-actions (สั่งซ้ำ / แก้ไข / Tracking / พิมพ์ / ลบ).
 *
 *  Perf note: rows are React.memo'd and the click handler comes via a
 *  stable useCallback so opening the detail modal does NOT re-render
 *  500 rows. Without this, a row-click on /orders feels noticeably laggy. */
export function OrdersTable({ rows, role, perPage = 20 }: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const active = rows.find((r) => r.id === activeId) || null;
  const onRowClick = useCallback((id: number) => setActiveId(id), []);
  const visible = rows.slice(0, perPage);

  return (
    <>
      <PageSizeBar total={rows.length} perPage={perPage} shown={visible.length} />
      <div className="bg-white rounded-2xl border border-stone-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[1024px]">
          <thead className="bg-stone-50 text-xs text-stone-500 uppercase">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-12">#</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">เลขที่ใบสั่ง</th>
              <th className="text-left px-3 py-2 font-medium">ชื่องาน</th>
              <th className="text-left px-3 py-2 font-medium">ลูกค้า</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">วันที่รับ</th>
              <th className="text-right px-3 py-2 font-medium whitespace-nowrap">กำหนดส่ง</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะใบสั่ง</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ขั้นตอนปัจจุบัน</th>
              <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะงาน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {visible.map((o, idx) => (
              <OrderRowMemo key={o.id} order={o} idx={idx} onClick={onRowClick} />
            ))}
          </tbody>
        </table>
        {rows.length > visible.length && (
          <div className="px-4 py-2 bg-stone-50 text-xs text-stone-500 text-center">
            แสดง {visible.length} จาก {rows.length} รายการ — ปรับจำนวนหรือใช้ตัวกรองด้านบน
          </div>
        )}
      </div>

      <OrderDetailModal
        order={active}
        role={role}
        onClose={() => setActiveId(null)}
      />
    </>
  );
}

// ─── Detail modal ─────────────────────────────────────────

// ─── Memoized row ─────────────────────────────────────────

/** Each row receives a stable `onClick` callback so it only re-renders
 *  when its own `order` prop changes (not when activeId changes). */
const OrderRowMemo = memo(function OrderRow({
  order: o, idx, onClick,
}: {
  order: OrderRow;
  idx: number;
  onClick: (id: number) => void;
}) {
  const urgencyColor = o.jobUrgency in URGENCY_COLORS
    ? URGENCY_COLORS[o.jobUrgency as 'normal']
    : '#9ca3af';
  const showUrgencyBadge =
    o.step !== 'จัดส่งแล้ว' &&
    o.step !== 'ยกเลิก' &&
    o.step !== 'ร่าง' &&
    o.step !== 'ไม่พบงาน';
  return (
    <tr
      onClick={() => onClick(o.id)}
      className={`cursor-pointer hover:bg-sky-50/40 transition-colors ${
        o.isOrphan ? 'bg-red-50/30' : ''
      }`}
    >
      <td className="px-3 py-2 tabular-nums text-stone-400">{idx + 1}</td>
      <td className="px-3 py-2 tabular-nums text-stone-700 font-medium whitespace-nowrap">
        <span className="text-sky-700 hover:underline">#{o.id}</span>
      </td>
      <td className="px-3 py-2 font-medium text-stone-900 max-w-[14rem] truncate" title={o.name}>
        {o.name}
      </td>
      <td className="px-3 py-2 text-stone-600 max-w-[12rem] truncate" title={o.customer}>
        {o.customer || '—'}
      </td>
      <td className="px-3 py-2 text-right text-stone-500 tabular-nums whitespace-nowrap">
        {displayDate(o.dateIn)}
      </td>
      <td className="px-3 py-2 text-right text-stone-700 tabular-nums whitespace-nowrap">
        {displayDate(o.dateDue)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${o.orderStatusClass}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            o.orderStatus === 'cancelled' ? 'bg-red-500'
              : o.orderStatus === 'shipped' ? 'bg-emerald-500'
                : o.orderStatus === 'draft' ? 'bg-amber-500'
                  : 'bg-sky-500'
          }`} />
          {o.orderStatusLabel}
        </span>
      </td>
      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{o.step}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {showUrgencyBadge ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium tabular-nums"
            style={{ background: urgencyColor + '20', color: urgencyColor }}
          >
            {o.jobUrgencyLabel}
          </span>
        ) : (
          <span className="text-stone-400 text-xs">{o.jobUrgencyLabel}</span>
        )}
      </td>
    </tr>
  );
});

function OrderDetailModal({
  order, role, onClose,
}: {
  order: OrderRow | null;
  role: 'admin' | 'sales' | 'staff';
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState<null | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (order && !dlg.open) {
      setError(null);
      dlg.showModal();
    } else if (!order && dlg.open) {
      dlg.close();
    }
  }, [order]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) { e.preventDefault(); onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  async function deleteOrder() {
    if (!order) return;
    if (!confirm(
      `ลบใบสั่งงาน #${order.id} "${order.name}" ?\n\n` +
      `⚠ ลบถาวร — กู้คืนไม่ได้!\n` +
      `Job ที่ผูกอยู่ (ถ้ามี) จะถูก "ยกเลิก" อัตโนมัติพร้อมเหตุผล "ใบสั่งงานถูกลบ"`,
    )) return;
    const id = order.id;
    const name = order.name;
    setError(null);
    setBusy('delete');
    toast.show(`กำลังลบใบสั่ง #${id}...`);
    onClose();
    try {
      const res = await fetch('/api/orders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, cascade: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || `ลบไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      broadcastWrite('/api/orders/delete');
      const cascadeCount = Array.isArray(data.cancelledJobs) ? data.cancelledJobs.length : 0;
      toast.success(
        cascadeCount > 0
          ? `ลบใบสั่ง #${id} "${name}" + ยกเลิก Job ${cascadeCount} งาน`
          : `ลบใบสั่ง #${id} "${name}" แล้ว`,
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (!order) return null;
  const canEdit = (role === 'admin' || role === 'sales')
    && order.orderStatus !== 'shipped' && order.orderStatus !== 'cancelled';
  const canDelete = role === 'admin';
  const canDuplicate = role === 'admin' || role === 'sales';

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[92vw]"
    >
      <div className="flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3 border-b border-stone-100 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-grow">
            <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
              <span
                className={`px-2 py-0.5 rounded font-semibold ${order.orderStatusClass}`}
              >
                {order.orderStatusLabel}
              </span>
              <span className="text-stone-500">{order.step}</span>
              <span className="text-stone-400 tabular-nums">#{order.id}</span>
            </div>
            <h2 className="text-lg font-bold text-stone-900 leading-snug break-words">
              ใบสั่งงาน #{order.id} — {order.name || '(ไม่มีชื่อ)'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100 -mr-2 -mt-1 disabled:opacity-50"
            aria-label="ปิด"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-grow overflow-y-auto p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <KV label="ชื่องาน" value={order.name} />
            <KV label="ลูกค้า" value={order.customer || '—'} />
            <KV label="วันที่รับ" value={displayDate(order.dateIn)} />
            <KV label="กำหนดส่ง" value={displayDate(order.dateDue)} />
            <KV label="ผู้สั่งงาน" value={order.orderer || '—'} />
            <KV label="ขั้นตอนปัจจุบัน" value={order.step} />
            {order.pin && <KV label="PIN tracking" value={order.pin} />}
          </div>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer — 5 actions */}
        <div className="border-t border-stone-100 bg-stone-50/60 px-5 py-3 flex flex-wrap justify-center gap-2">
          {canDuplicate && (
            <Link
              href={`/orders/new?from=${order.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              title="สร้างใบสั่งใหม่ — ใช้ spec จากใบนี้, ใส่กำหนดส่งใหม่"
            >
              <IconCornerUpRight size={14} />
              สั่งซ้ำ
            </Link>
          )}
          {canEdit && (
            <Link
              href={`/orders/${order.id}/edit`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600"
            >
              <IconPencil size={14} />
              แก้ไข
            </Link>
          )}
          {order.pin && (
            <Link
              href={`/orders/${order.id}/tracking-card`}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700"
              title="ดาวน์โหลดการ์ด tracking + PIN สำหรับลูกค้า"
            >
              <IconCheck size={14} />
              บันทึก Tracking
            </Link>
          )}
          <Link
            href={`/orders/${order.id}/print`}
            target="_blank"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700"
          >
            <IconPrinter size={14} />
            พิมพ์ใบสั่งงาน
          </Link>
          {canDelete && (
            <button
              type="button"
              onClick={deleteOrder}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              title="ลบใบสั่งงานถาวร — Job ที่ผูกอยู่ต้องจัดการแยก"
            >
              <IconTrash size={14} />
              {busy === 'delete' ? 'กำลังลบ...' : 'ลบใบสั่ง'}
            </button>
          )}
        </div>
        <p className="px-5 pb-3 text-[11px] text-stone-400 text-center">
          <IconFileText size={10} className="inline-block mr-0.5 align-text-bottom" />
          แก้ใบสั่งงาน → cascade ไป Job ที่ผูกอยู่อัตโนมัติ
        </p>
      </div>
    </dialog>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-stone-50/60 border border-stone-100 px-3 py-2 flex items-baseline justify-between gap-2">
      <span className="text-xs text-stone-500 font-medium flex-shrink-0">{label}:</span>
      <span className="text-sm text-stone-900 break-words text-right">{value || '—'}</span>
    </div>
  );
}
