'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { displayDate } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import { URGENCY_BADGE } from '@/lib/calendar';
import {
  IconX, IconPencil, IconAlertTriangle, IconPrinter, IconAlertCircle, IconFileText,
  IconCheck, IconCornerUpRight, IconUsers, IconRefreshCw,
} from '@/lib/icons';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';
import { PageSizeBar } from '@/components/page-size-bar';
import { PaginationBar } from '@/components/pagination-bar';
import { paginate, clampPage } from '@/lib/page-size';

// HistoryTab + its icon-set ride a separate chunk — only loads when a
// user actually opens an order detail modal. Mirrors the /board card.tsx
// pattern so /orders page-load doesn't pay for the audit-tab JS.
const HistoryTab = dynamic(
  () => import('@/components/history-tab').then((m) => ({ default: m.HistoryTab })),
  { ssr: false },
);

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
  /** Full spec payload, served inline from the page-level loadAll snapshot
   *  so the detail modal's "สเปคงาน" tab can render instantly without a
   *  separate `/api/orders/raw/<id>` roundtrip. Mirrors how the Kanban
   *  card detail uses `job.order.details` straight from the same snap.
   *  When this is missing or empty (legacy rows / fallback), the modal
   *  falls back to lazy-fetching the raw payload. */
  rawData?: Record<string, unknown> | null;
}

interface Props {
  rows: OrderRow[];
  role: 'admin' | 'sales' | 'staff';
  /** Default 20. Server passes this from `?per=20|50|100` URL param. */
  perPage?: number;
  /** 1-based page index from `?page=` URL param. Default 1. */
  page?: number;
}

/** WP-style /orders table: rows are clickable → opens a detail modal with
 *  the 5 quick-actions (สั่งซ้ำ / แก้ไข / Tracking / พิมพ์ / ยกเลิก).
 *
 *  Perf note: rows are React.memo'd and the click handler comes via a
 *  stable useCallback so opening the detail modal does NOT re-render
 *  500 rows. Without this, a row-click on /orders feels noticeably laggy. */
export function OrdersTable({ rows, role, perPage = 20, page = 1 }: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  // Memoize the active-row lookup — it's an O(n) scan of the full filtered
  // set that otherwise re-runs on every render (including parent delta polls).
  const active = useMemo(
    () => rows.find((r) => r.id === activeId) || null,
    [rows, activeId],
  );
  const onRowClick = useCallback((id: number) => setActiveId(id), []);
  // Clamp the requested page against the current filtered total so users
  // who narrow the filter while sitting on page 5 don't render a blank
  // table — they snap back to the last valid page instead.
  const safePage = clampPage(page, rows.length, perPage);
  const visible = paginate(rows, safePage, perPage);
  const startIdx = (safePage - 1) * perPage;

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
              <OrderRowMemo key={o.id} order={o} idx={startIdx + idx} onClick={onRowClick} />
            ))}
          </tbody>
        </table>
      </div>

      <PaginationBar total={rows.length} perPage={perPage} page={safePage} className="pt-2" />

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
  // WCAG-AA badge palette — see lib/calendar.ts URGENCY_BADGE (A11Y-P1).
  const badge = o.jobUrgency in URGENCY_BADGE
    ? URGENCY_BADGE[o.jobUrgency as 'normal']
    : { bg: '#f5f5f4', fg: '#44403c' };
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
            style={{ background: badge.bg, color: badge.fg }}
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

type DetailTab = 'info' | 'spec' | 'history';

interface RawData {
  details?: Record<string, unknown>;
  photobook?: Array<Record<string, unknown>>;
  cowork?: unknown;
  notes?: string;
  orderType?: string;
  // Plus all the gatherFormData() fields — see lib/photobook.ts OrderFormData
  [key: string]: unknown;
}

function OrderDetailModal({
  order, role, onClose,
}: {
  order: OrderRow | null;
  role: 'admin' | 'sales' | 'staff';
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirmDlg = useConfirm();
  const [, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState<null | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>('info');
  const [rawData, setRawData] = useState<RawData | null>(null);
  const [rawLoading, setRawLoading] = useState(false);
  const [rawError, setRawError] = useState<string | null>(null);

  // Inline-first spec hydration. The /orders page now passes the full
  // rawData straight from its loadAll snapshot (matches how /board card
  // detail uses `job.order.details`), so the modal renders instantly
  // without a /api/orders/raw/[id] roundtrip. When rawData is missing
  // (e.g. an order that was edited in another tab and the row was
  // promoted to OrderRow without a fresh snap), we fall back to the
  // lazy fetch path so behaviour is preserved.
  useEffect(() => {
    if (!order) return;
    setTab('info');
    setRawError(null);
    if (order.rawData && Object.keys(order.rawData).length > 0) {
      setRawData(order.rawData as RawData);
      setRawLoading(false);
      return;
    }
    setRawData(null);
    setRawLoading(true);
    let cancelled = false;
    fetch(`/api/orders/raw/${order.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (cancelled) return;
        setRawData((data?.rawData as RawData) || {});
      })
      .catch((err) => {
        if (cancelled) return;
        setRawError(err instanceof Error ? err.message : 'โหลดสเปคงานไม่ได้');
      })
      .finally(() => {
        if (!cancelled) setRawLoading(false);
      });
    return () => { cancelled = true; };
  }, [order]);

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

  async function cancelOrder() {
    if (!order) return;
    const ok = await confirmDlg.confirm({
      title: `ยกเลิกใบสั่งงาน #${order.id}?`,
      message: `"${order.name}"\n\nสถานะจะเปลี่ยนเป็น "ยกเลิก" และข้อมูลใบสั่งยังคงอยู่ในระบบ\nJob ที่ผูกอยู่ (ถ้ามี) จะถูกย้ายไปรายการยกเลิกอัตโนมัติ`,
      okLabel: 'ยกเลิกใบสั่ง',
      variant: 'warn',
    });
    if (!ok) return;
    const id = order.id;
    const name = order.name;
    setError(null);
    setBusy('delete');
    toast.show(`กำลังยกเลิกใบสั่ง #${id}...`);
    onClose();
    try {
      const res = await fetch('/api/orders/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || `ยกเลิกไม่สำเร็จ (HTTP ${res.status})`);
        return;
      }
      broadcastWrite('/api/orders/cancel');
      const cascadeCount = Array.isArray(data.cancelledJobs) ? data.cancelledJobs.length : 0;
      toast.success(
        cascadeCount > 0
          ? `ยกเลิกใบสั่ง #${id} "${name}" + ยกเลิก Job ${cascadeCount} งาน`
          : `ยกเลิกใบสั่ง #${id} "${name}" แล้ว`,
      );
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  }

  if (!order) return null;
  // Edit + delete = admin only. Sales can still ดู the order, สั่งซ้ำ,
  // and print/tracking — they just can't mutate existing rows.
  const canEdit = role === 'admin'
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
            className="text-stone-400 hover:text-stone-700 w-11 h-11 flex items-center justify-center rounded hover:bg-stone-100 -mr-2 -mt-1 disabled:opacity-50"
            aria-label="ปิด"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Tabs — match Kanban card detail (lib/board card.tsx DetailContent) */}
        <div className="border-b border-stone-100 bg-white flex-shrink-0">
          <div className="flex px-5 gap-4 overflow-x-auto">
            <DetailTabBtn active={tab === 'info'} onClick={() => setTab('info')} label="ข้อมูลหลัก" />
            <DetailTabBtn active={tab === 'spec'} onClick={() => setTab('spec')} label="สเปคงาน" />
            <DetailTabBtn active={tab === 'history'} onClick={() => setTab('history')} label="ประวัติ" />
          </div>
        </div>

        {/* Body */}
        <div className="flex-grow overflow-y-auto p-5 space-y-3">
          {tab === 'info' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <KV label="ชื่องาน" value={order.name} />
                <KV label="ลูกค้า" value={order.customer || '—'} />
                <KV label="วันที่รับ" value={displayDate(order.dateIn)} />
                <KV label="กำหนดส่ง" value={displayDate(order.dateDue)} />
                <KV label="ผู้สั่งงาน" value={order.orderer || '—'} />
                <KV label="ขั้นตอนปัจจุบัน" value={order.step} />
                {order.pin && <KV label="PIN tracking" value={order.pin} />}
              </div>
              {(() => {
                const cowork = parseCoworkArray(rawData?.cowork);
                if (cowork.length === 0) return null;
                return (
                  <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5">
                    <div className="text-xs font-semibold text-violet-700 mb-1.5 flex items-center gap-1.5">
                      <IconUsers size={12} />
                      Co-work — ผู้ร่วมพิมพ์ ({cowork.length})
                    </div>
                    <ul className="space-y-0.5 text-sm text-stone-700">
                      {cowork.map((cw, i) => (
                        <li key={i}>
                          <span className="text-stone-500 text-xs">[{cw.dept}]</span>{' '}
                          <span className="font-medium">{cw.staff}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
            </>
          )}

          {tab === 'spec' && (
            <>
              {rawLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-sm text-stone-500">
                  <IconRefreshCw size={14} className="animate-spin" />
                  กำลังโหลดสเปคงาน...
                </div>
              )}
              {rawError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <span>{rawError}</span>
                </div>
              )}
              {!rawLoading && !rawError && rawData && (
                <SpecSection raw={rawData} />
              )}
            </>
          )}

          {/* Always-mount + display toggle = prefetch audit when modal opens.
           *  HistoryTab fires fetch on mount; user reads info/spec tab while
           *  audit loads in background → ประวัติ click feels instant.
           *  /orders modal exposes only order id (jobId not on OrderRow type).
           *  Mirrors WP `buildJobTimeline(o.id, o.id)` — entries with
           *  targetId === orderId cover the order-level lifecycle. */}
          <div style={{ display: tab === 'history' ? 'block' : 'none' }}>
            <HistoryTab orderId={order.id} />
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
          {canDelete && order.orderStatus !== 'cancelled' && (
            <button
              type="button"
              onClick={cancelOrder}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              title="ยกเลิกใบสั่งงาน — สถานะเปลี่ยนเป็นยกเลิก, Job ที่ผูกอยู่ย้ายไปรายการยกเลิก"
            >
              <IconAlertTriangle size={14} />
              {busy === 'delete' ? 'กำลังยกเลิก...' : 'ยกเลิกใบสั่ง'}
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

// ─── Tab button (matches Kanban card detail) ─────────────
function DetailTabBtn({
  active, onClick, label,
}: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'text-sky-700 border-sky-500' : 'text-stone-500 border-transparent hover:text-stone-700'
      }`}
    >
      {label}
    </button>
  );
}

// ─── Cowork helpers (kept inline — duplicated from board/card.tsx
//      to avoid a refactor of that 1400-line file. If a third consumer
//      shows up, lift to lib/order-detail.tsx.) ─────────────────────

interface CoworkEntry { dept: string; staff: string }

function parseCoworkArray(cowork: unknown): CoworkEntry[] {
  if (!Array.isArray(cowork)) return [];
  const out: CoworkEntry[] = [];
  for (const c of cowork) {
    if (typeof c === 'string' && c.trim()) {
      out.push({ dept: 'print', staff: c.trim() });
    } else if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      const dept = String(obj.dept || '').trim();
      const staff = String(obj.staff || '').trim();
      if (staff) out.push({ dept: dept || 'print', staff });
    }
  }
  return out;
}

// ─── Spec rendering — formats rawData into structured sections ──────
//
// Label dictionary + section grouping + value formatting all live in
// lib/spec-format.ts so /orders modal + /board card detail share the
// same UX (mirrors WP `renderJobSpecTab` + printOrderHtml sections).

import { buildSpecSections } from '@/lib/spec-format';

interface PhotobookItem {
  size?: string;
  binding?: string;
  qty?: string;
  special?: string;
}

function SpecSection({ raw }: { raw: RawData }) {
  const isPhotobook = raw.orderType === 'photobook';

  // Photobook items can be stored under either key — match orderFormFromRaw fallback.
  const photobookItems: PhotobookItem[] = Array.isArray(raw.photobookItems)
    ? (raw.photobookItems as PhotobookItem[])
    : Array.isArray(raw.photobook)
      ? (raw.photobook as PhotobookItem[])
      : [];

  const sections = buildSpecSections(raw as Record<string, unknown>, isPhotobook);

  if (sections.length === 0 && photobookItems.length === 0) {
    return <p className="text-sm text-stone-400 text-center py-4">ไม่มีสเปคงาน</p>;
  }

  return (
    <div className="space-y-3">
      {isPhotobook && photobookItems.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <IconFileText size={12} />
            Photobook ({photobookItems.length} เล่ม)
          </h3>
          <div className="rounded-lg border border-violet-200 bg-violet-50/30 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-violet-100/50 text-xs text-violet-700">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium w-10">#</th>
                  <th className="text-left px-3 py-1.5 font-medium">ขนาด</th>
                  <th className="text-left px-3 py-1.5 font-medium">เข้าเล่ม</th>
                  <th className="text-right px-3 py-1.5 font-medium w-16">จำนวน</th>
                  <th className="text-left px-3 py-1.5 font-medium">คำสั่งพิเศษ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100">
                {photobookItems.map((item, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 tabular-nums text-stone-500">{i + 1}</td>
                    <td className="px-3 py-1.5 text-stone-900">{item.size || '—'}</td>
                    <td className="px-3 py-1.5 text-stone-700">{item.binding || '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-900 font-medium">
                      {item.qty || '—'}
                    </td>
                    <td className="px-3 py-1.5 text-stone-600">{item.special || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            {section.title}
          </h3>
          {section.chips ? (
            <div className="flex flex-wrap gap-1.5 px-1">
              {section.entries.map((e) => (
                <span
                  key={e.key}
                  className="inline-flex items-center gap-1 rounded-full bg-stone-100 text-stone-700 px-2.5 py-1 text-xs"
                >
                  {e.display === '✓' ? (
                    <>
                      <span className="text-emerald-600 font-bold">✓</span>
                      {e.label}
                    </>
                  ) : (
                    <>
                      <span className="text-stone-500">{e.label}:</span>
                      <span className="font-medium">{e.display}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 bg-stone-50/40">
              {section.entries.map((e) => (
                <div key={e.key} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                  <span className="text-stone-500 min-w-[100px] shrink-0">{e.label}</span>
                  <span className="text-stone-900 break-words">{e.display}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
