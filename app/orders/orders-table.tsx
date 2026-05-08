'use client';

import { memo, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { displayDate } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import { URGENCY_COLORS } from '@/lib/calendar';
import {
  IconX, IconPencil, IconAlertTriangle, IconPrinter, IconAlertCircle, IconFileText,
  IconCheck, IconCornerUpRight, IconUsers, IconInfo, IconRefreshCw,
} from '@/lib/icons';
import { useToast } from '@/components/toast-provider';
import { useConfirm } from '@/components/confirm-provider';
import { PageSizeBar } from '@/components/page-size-bar';
import { PaginationBar } from '@/components/pagination-bar';
import { paginate, clampPage } from '@/lib/page-size';

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
  const active = rows.find((r) => r.id === activeId) || null;
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

  // Reset state + lazy-load full spec when modal opens for a new order.
  // /api/orders/raw/[id] returns the same rawData shape that's shown on
  // the Kanban card detail's "สเปคงาน" tab — single source of truth so
  // /orders + /board surface identical info.
  useEffect(() => {
    if (!order) return;
    setTab('info');
    setRawData(null);
    setRawError(null);
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
            className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100 -mr-2 -mt-1 disabled:opacity-50"
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

          {tab === 'history' && (
            <div className="text-center py-8 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-100 text-stone-400 mx-auto">
                <IconInfo size={20} />
              </div>
              <p className="text-sm text-stone-500">
                ประวัติงาน (audit log) ดูได้ใน{' '}
                <a
                  href="https://app.penprinting.co/production-monitoring/"
                  className="underline hover:text-stone-700"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ระบบ WP
                </a>
              </p>
            </div>
          )}

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

// ─── Spec rendering — formats rawData into readable rows ──────────

/** Friendly Thai labels for known rawData keys. Mirror of `lb` map in
 *  WP frontend (production-monitoring.js ~line 1109) and DETAIL_LABELS
 *  in board/card.tsx — same render shape so /orders + /board feel
 *  consistent. */
const SPEC_LABELS: Record<string, string> = {
  size: 'ขนาด',
  qty: 'จำนวน',
  paperCover: 'กระดาษปก',
  paperInner: 'กระดาษเนื้อใน',
  coverColor: 'สีปก',
  coverColorNote: 'หมายเหตุสีปก',
  innerColor: 'สีเนื้อใน',
  innerColorNote: 'หมายเหตุสีเนื้อใน',
  plateOld: 'ใช้ Plate เก่า',
  plateNew: 'Plate ใหม่',
  copyprint: 'Copyprint',
  inkjet: 'Inkjet',
  digital: 'Digital',
  plateSize: 'ขนาดเพลท',
  billPerSet: 'บิล/ชุด',
  setPerBook: 'ชุด/เล่ม',
  sheetPerBook: 'แผ่น/เล่ม',
  billColors: 'สีบิล',
  perf: 'ปรุ',
  perfPos: 'ตำแหน่งปรุ',
  runNo: 'หมายเลขรัน',
  runBook: 'รันเล่ม',
  runNum: 'รันหมายเลข',
  glue: 'ทากาว',
  saddle: 'เย็บมุงหลังคา',
  sew: 'เย็บกี่',
  spine: 'สันธรรมดา',
  glueHead: 'ทากาวหัว',
  glueSide: 'ทากาวข้าง',
  sewHead: 'เย็บหัว',
  sewSide: 'เย็บข้าง',
  sewCorner: 'เย็บมุม',
  sewThread: 'เย็บด้าย',
  sewSideTape: 'เย็บข้าง+เทป',
  coatGloss: 'เคลือบเงา',
  coatMatte: 'เคลือบด้าน',
  coatUV: 'เคลือบ UV',
  coatSpotUV: 'เคลือบ Spot UV',
  stampColor: 'ปั๊มสี',
  stampColorNote: 'หมายเหตุปั๊มสี',
  emboss: 'ปั๊มนูน',
  diecut: 'ไดคัท',
  diecutSelf: 'ไดคัท(เอง)',
  notes: 'หมายเหตุ',
  orderer: 'ผู้สั่งงาน',
};

const SPEC_HIDDEN_KEYS = new Set([
  'name', 'customer', 'dateIn', 'dateDue',
  'pin', 'orderType', 'photobookItems', 'photobook',
  'cowork', 'assignDept', 'assignStaff', 'forwardPrint', 'sizeUnit', 'qtyUnit',
]);

// For photobook orders the spec tab uses a WHITELIST instead of the
// printing-flavoured blacklist above. Reason: v2 OrderForm seeds the
// whole printing schema (plate / billColors / paperCover / coatGloss / ...)
// then flips orderType=photobook on top, so a photobook order's rawData
// carries dozens of irrelevant printing fields. The photobook items
// already render in their own table — the only generic fields a
// photobook customer cares about here are the freeform notes and who
// placed the order.
const PHOTOBOOK_VISIBLE_KEYS = new Set(['notes', 'orderer']);

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

  // Filter rawData entries: drop the keys we hide + empty/false values.
  const sizeUnit = String(raw.sizeUnit || '').trim();
  const qtyUnit = String(raw.qtyUnit || '').trim();

  const entries = Object.entries(raw).filter(([k, v]) => {
    // Empty / falsy filters always apply.
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    if (typeof v === 'boolean' && v === false) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (Array.isArray(v) && v.every((x) => !x)) return false;
    // Mode-aware key filter: photobook = whitelist (printing fields hide),
    // normal = the legacy blacklist of header / system keys.
    if (isPhotobook) return PHOTOBOOK_VISIBLE_KEYS.has(k);
    return !SPEC_HIDDEN_KEYS.has(k);
  });

  // Pretty value formatting — pair size with sizeUnit, qty with qtyUnit, etc.
  const formatValue = (k: string, v: unknown): string => {
    if (k === 'size' && sizeUnit) return `${v} ${sizeUnit}`;
    if (k === 'qty' && qtyUnit) return `${v} ${qtyUnit}`;
    if (typeof v === 'boolean') return v ? '✓' : '—';
    if (Array.isArray(v)) return v.filter(Boolean).join(', ') || '—';
    return String(v);
  };

  if (entries.length === 0 && photobookItems.length === 0) {
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

      {entries.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            รายละเอียดงาน
          </h3>
          <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 bg-stone-50/40">
            {entries.map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                <span className="text-stone-500 min-w-[100px] shrink-0">{SPEC_LABELS[k] || k}</span>
                <span className="text-stone-900 break-words">{formatValue(k, v)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
