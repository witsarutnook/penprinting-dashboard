'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type BoardJob,
  type Dept,
  URGENCY_COLORS,
  URGENCY_LABELS,
  DEPT_LABELS,
  STAFF,
  coworkPrintStaffIds,
} from '@/lib/board';
import { computeFromType, getVisibleTargets, RESTRICTED_TARGETS } from '@/lib/forward';
import { broadcastWrite } from '@/lib/auto-sync';
import { displayDate } from '@/lib/jobs';
import { useBulkMode } from '@/components/board/bulk-context';
import { useUndo } from '@/components/board/undo-context';
import { OrderForm } from './order-form';
import {
  IconCheck,
  IconX,
  IconPencil,
  IconTrash,
  IconAlertTriangle,
  IconAlertCircle,
  IconInfo,
  IconCornerUpRight,
  IconRefreshCw,
  IconUser,
  IconUsers,
  IconPlus,
  IconCheckSquare,
  IconSquare,
  IconLock,
} from '@/lib/icons';
import { JobForm } from './job-form';

const VENDOR_PURPLE = '#7c3aed';

/** Map (urgency, daysUntilDue) → "รับ Xว" / "วันนี้" / "เกิน Xว" — matches WP card format. */
function urgencyDaysLabel(urgency: string, days: number): string {
  if (urgency === 'overdue') return `เกิน ${Math.abs(days)}ว`;
  if (urgency === 'dday' || days === 0) return 'วันนี้!';
  return `รับ ${days}ว`;
}

/** "SM74, MO 5สี" — friendly inline list of cowork machine names. */
function coworkInline(raw: unknown): string {
  const ids = coworkPrintStaffIds(raw);
  if (ids.length === 0) return '';
  return ids
    .map((id) => STAFF.print.find((s) => s.id === id)?.name || id)
    .join(', ');
}

function coworkTooltip(raw: unknown): string {
  const inline = coworkInline(raw);
  return inline ? `Co-work: ${inline}` : 'มี co-work';
}

/** Card with built-in detail modal + inline forward/cowork dialogs (native <dialog>). */
export function Card({
  job,
  isVendorCol,
  sessionRole,
}: {
  job: BoardJob;
  dept: Dept;
  isVendorCol: boolean;
  sessionRole: string | null;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [coworkOpen, setCoworkOpen] = useState(false);
  const [shipBusy, setShipBusy] = useState(false);
  const [shipError, setShipError] = useState<string | null>(null);
  const { mode: bulkMode, selected, toggleJob } = useBulkMode();
  const isSelected = selected.has(job.id);
  const urgencyColor = URGENCY_COLORS[job.urgency];

  // Compute primary action button per WP renderJobCard rules
  const dept = String(job.dept);
  const staff = job.staff;
  const isGuest = !!job.isGuest;
  const isAdmin = sessionRole === 'admin';
  const canCreate = isAdmin || sessionRole === 'sales';
  const fromType = computeFromType(dept, staff);
  const forwardTargets = fromType ? getVisibleTargets(fromType, isAdmin) : [];

  type CardAction = { kind: 'ship' } | { kind: 'forward'; label: string } | null;
  let primaryAction: CardAction = null;
  // Guest cowork cards are read-only — no actions, primary owner moves the job.
  if (!isGuest) {
    if (dept === 'post' && staff === 'ship') {
      primaryAction = { kind: 'ship' };
    } else if (dept === 'print' && staff === 'outsource') {
      if (canCreate && forwardTargets.length > 0) {
        primaryAction = { kind: 'forward', label: 'งานกลับ → รอจัดส่ง' };
      }
    } else if (dept === 'post' && staff === 'diecut_out') {
      if (canCreate && forwardTargets.length > 0) {
        primaryAction = { kind: 'forward', label: 'งานกลับ → รอจัดส่ง' };
      }
    } else if (forwardTargets.length > 0) {
      primaryAction = { kind: 'forward', label: 'เสร็จ-ส่งต่อ' };
    }
  }
  // Co-work: print dept only (excluding outsource), and only on the host card.
  const showCowork = !isGuest && dept === 'print' && staff !== 'outsource';

  function open() {
    if (bulkMode) {
      toggleJob(job.id);
      return;
    }
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }
  function startEdit() {
    dialogRef.current?.close();
    setEditOpen(true);
  }
  function startEditOrder() {
    dialogRef.current?.close();
    setEditOrderOpen(true);
  }

  async function handleShipClick() {
    if (bulkMode) {
      toggleJob(job.id);
      return;
    }
    if (shipBusy) return;
    if (!confirm(`ยืนยัน "จัดส่งเสร็จ" สำหรับ "${job.name}" ?`)) return;
    setShipError(null);
    setShipBusy(true);
    const res = await fetch('/api/jobs/move-to-shipped', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, name: job.name, orderId: job.orderId }),
    });
    setShipBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setShipError(data?.error || `HTTP ${res.status}`);
      return;
    }
    broadcastWrite('/api/jobs/move-to-shipped');
    router.refresh();
  }

  // Click backdrop closes the dialog
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'DIALOG') dlg!.close();
    }
    dlg.addEventListener('click', onClick);
    return () => dlg.removeEventListener('click', onClick);
  }, []);

  // Drag state — visually fade the card while it's being dragged elsewhere
  const [isDragging, setIsDragging] = useState(false);
  const draggable = !bulkMode && !isGuest;

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    if (!draggable) return;
    // Encode dept in MIME type so columns can validate same-dept during dragover
    e.dataTransfer.setData(`application/x-job-${dept}`, String(job.id));
    e.dataTransfer.setData('text/plain', String(job.id));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  }
  function handleDragEnd() {
    setIsDragging(false);
  }

  return (
    <>
      <div
        draggable={draggable}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-all relative ${
          bulkMode && isSelected
            ? 'ring-2 ring-sky-400 border-sky-300 bg-white'
            : isGuest
              ? 'bg-violet-50 border-violet-200 border-dashed'
              : job.hasCowork
                ? 'bg-violet-50/30 border-dashed bg-white'
                : 'bg-white'
        } ${bulkMode && !isSelected ? 'hover:bg-sky-50/30 cursor-pointer' : ''} ${
          draggable ? 'cursor-grab active:cursor-grabbing' : ''
        } ${isDragging ? 'opacity-40' : ''}`}
        onClick={bulkMode ? open : undefined}
        style={{
          borderColor: bulkMode && isSelected
            ? undefined
            : isGuest
              ? `${VENDOR_PURPLE}60`
              : job.hasCowork
                ? `${VENDOR_PURPLE}50`
                : isVendorCol ? `${VENDOR_PURPLE}30` : '#e7e5e4',
          borderLeft: `3px solid ${urgencyColor}`,
        }}
      >
        {/* Top row: name + ร่วมพิมพ์/guest badge + รายละเอียด button */}
        <div className="flex items-start justify-between gap-1.5">
          {bulkMode && !isGuest && (
            <span
              className={`flex-shrink-0 mt-0.5 ${isSelected ? 'text-sky-600' : 'text-stone-300'}`}
              aria-hidden="true"
            >
              {isSelected ? <IconCheckSquare size={14} /> : <IconSquare size={14} />}
            </span>
          )}
          <div className="text-[13px] font-semibold text-stone-900 leading-tight flex-grow break-words flex items-baseline gap-1 flex-wrap">
            <span>{job.name || <span className="text-stone-400">(ไม่มีชื่อ)</span>}</span>
            {isGuest ? (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0 rounded bg-violet-200 text-violet-800 whitespace-nowrap font-medium leading-tight self-center"
                title="Co-work — ย้ายได้จากเครื่องหลักเท่านั้น"
              >
                <IconLock size={9} />
                ร่วมพิมพ์
              </span>
            ) : job.hasCowork ? (
              <span
                className="text-[11px] font-medium text-violet-700 whitespace-nowrap"
                title={coworkTooltip(job.cowork)}
              >
                · + {coworkInline(job.cowork)}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            disabled={bulkMode}
            className="text-[10px] text-stone-500 hover:text-stone-900 hover:bg-stone-100 px-1.5 py-0 rounded whitespace-nowrap flex-shrink-0 disabled:opacity-50 leading-snug"
          >
            รายละเอียด
          </button>
        </div>

        {/* Combined customer + dates line — single row to match WP density */}
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-stone-500 leading-tight overflow-hidden">
          {job.customer && (
            <>
              <IconUser size={10} className="flex-shrink-0 text-stone-400" />
              <span className="truncate text-stone-600 font-medium min-w-0">{job.customer}</span>
              <span className="text-stone-300 flex-shrink-0">·</span>
            </>
          )}
          <span className="text-stone-400 tabular-nums whitespace-nowrap flex-shrink-0">
            {job.dateInRaw && (
              <>
                {displayDate(job.dateInRaw)}
                <span className="mx-0.5 text-stone-300">→</span>
              </>
            )}
            {displayDate(job.dateRaw)}
          </span>
        </div>

        {/* Action row — primary action + Co-work + urgency badge */}
        <div className="flex items-center justify-between gap-2 mt-1.5 text-xs flex-wrap">
          <div className="flex items-center gap-1.5">
            {primaryAction?.kind === 'ship' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleShipClick();
                }}
                disabled={bulkMode || shipBusy}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-medium text-[12px] disabled:opacity-50"
                title="จัดส่งเสร็จ — ปิดงาน"
              >
                <IconCheck size={13} />
                {shipBusy ? 'กำลังส่ง...' : 'จัดส่งเสร็จ'}
              </button>
            )}
            {primaryAction?.kind === 'forward' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (bulkMode) toggleJob(job.id);
                  else setForwardOpen(true);
                }}
                disabled={bulkMode}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-50 text-sky-700 hover:bg-sky-100 font-medium text-[12px] disabled:opacity-50"
              >
                <IconCheck size={13} />
                {primaryAction.label}
              </button>
            )}
            {showCowork && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (bulkMode) toggleJob(job.id);
                  else setCoworkOpen(true);
                }}
                disabled={bulkMode}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium text-[12px] transition-colors ${
                  job.hasCowork
                    ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                    : 'bg-violet-50 text-violet-700 hover:bg-violet-100'
                } disabled:opacity-50`}
              >
                <IconUsers size={13} />
                {job.hasCowork ? 'แก้ Co-work' : 'Co-work'}
              </button>
            )}
          </div>
          <span
            className="px-1.5 py-0.5 rounded font-medium tabular-nums whitespace-nowrap text-[10px] leading-snug"
            style={{ background: urgencyColor + '20', color: urgencyColor }}
          >
            {URGENCY_LABELS[job.urgency]}
            {job.daysUntilDue !== null && (
              <span className="ml-1 text-stone-500">
                · {urgencyDaysLabel(job.urgency, job.daysUntilDue)}
              </span>
            )}
          </span>
        </div>
        {shipError && (
          <div className="mt-1 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 flex items-start gap-1">
            <IconAlertCircle size={10} className="flex-shrink-0 mt-px" />
            <span>{shipError}</span>
          </div>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[92vw]"
      >
        <DetailContent
          job={job}
          onClose={close}
          onEdit={startEdit}
          onEditOrder={startEditOrder}
          sessionRole={sessionRole}
        />
      </dialog>
      <ForwardDialog
        job={job}
        open={forwardOpen}
        onClose={() => setForwardOpen(false)}
        sessionRole={sessionRole}
      />
      <CoworkDialog
        job={job}
        open={coworkOpen}
        onClose={() => setCoworkOpen(false)}
      />
      <JobForm initial={job} open={editOpen} onClose={() => setEditOpen(false)} />
      {job.order && (
        <OrderForm
          open={editOrderOpen}
          onClose={() => setEditOrderOpen(false)}
          defaultOrderer={job.order.orderer}
          initial={job.order}
        />
      )}
    </>
  );
}

// ─── Inline Forward dialog (matches WP screenshot) ──────────

function ForwardDialog({
  job,
  open,
  onClose,
  sessionRole,
}: {
  job: BoardJob;
  open: boolean;
  onClose: () => void;
  sessionRole: string | null;
}) {
  const router = useRouter();
  const { recordForward } = useUndo();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = sessionRole === 'admin';
  const fromType = computeFromType(String(job.dept), String(job.staff));
  const forwardTargets = fromType ? getVisibleTargets(fromType, isAdmin) : [];

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setTarget('');
      setNote('');
      setError(null);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel() { onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  async function submit() {
    const tgt = forwardTargets.find((t) => t.value === target);
    if (!target || !tgt) {
      setError('กรุณาเลือกปลายทาง');
      return;
    }
    setError(null);
    setBusy(true);
    const preForwardSnapshot = {
      name: job.name,
      dept: String(job.dept),
      staff: job.staff,
      date: job.dateRaw,
      dateIn: job.dateInRaw,
      status: job.status,
      orderId: job.orderId,
      cowork: job.cowork,
    };
    const res = await fetch('/api/jobs/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: job.id,
        targetDept: tgt.dept,
        targetStaff: tgt.value,
        note: note.trim() || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    broadcastWrite('/api/jobs/forward');
    if (isAdmin && data?.newId) {
      recordForward({
        newJobId: Number(data.newId),
        snapshot: preForwardSnapshot,
        destinationLabel: tgt.label,
        jobName: job.name,
      });
    }
    router.refresh();
    onClose();
  }

  const targetLabel = forwardTargets.find((t) => t.value === target)?.label;

  return (
    <dialog
      ref={dialogRef}
      className="rounded-xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[92vw]"
    >
      <div className="flex flex-col">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-stone-900 truncate">
            ส่งต่อ{targetLabel ? ` → ${targetLabel}` : ''}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-stone-400 hover:text-stone-700 w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100 disabled:opacity-50"
            aria-label="ปิด"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">ชื่องาน</label>
              <input
                type="text"
                value={job.name}
                readOnly
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-stone-50/60 text-stone-700"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-700 mb-1">ส่งต่อไป</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                disabled={busy}
                autoFocus
                className="w-full px-3 py-2 border border-sky-300 rounded-lg text-sm bg-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:opacity-50"
              >
                <option value="">— เลือกปลายทาง —</option>
                {forwardTargets.map((t) => (
                  <option key={`${t.dept}:${t.value}`} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-700 mb-1">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              rows={4}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-stone-50/40 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 resize-y"
            />
          </div>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-stone-100 bg-stone-50/40 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !target}
            className="px-5 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'กำลังส่งต่อ...' : 'ส่งต่อ'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Inline Co-work dialog (matches WP screenshot — print staff checkboxes) ─

function CoworkDialog({
  job,
  open,
  onClose,
}: {
  job: BoardJob;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // WP behavior: show all print staff EXCEPT the current owner (sm74 etc.)
  const printStaff = STAFF.print.filter((s) => s.id !== job.staff);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      // Pre-check existing cowork — handles both WP string[] and legacy {dept,staff}[]
      setSelected(new Set(coworkPrintStaffIds(job.cowork)));
      setError(null);
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, job.cowork, job.staff]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel() { onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setError(null);
    setBusy(true);
    // WP-compatible format: string[] of print staff ids
    const cowork = Array.from(selected);
    const res = await fetch('/api/jobs/cowork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: job.id, cowork }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return;
    }
    broadcastWrite('/api/jobs/cowork');
    router.refresh();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-md w-[92vw]"
    >
      <div className="flex flex-col">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-stone-900 truncate flex items-center gap-2">
            <IconUsers size={16} className="text-violet-600 flex-shrink-0" />
            <span className="truncate">Co-work: {job.name || '(ไม่มีชื่อ)'}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-stone-400 hover:text-stone-700 w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100 disabled:opacity-50"
            aria-label="ปิด"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-stone-600">เลือกเครื่องที่ต้องการร่วมพิมพ์งานนี้</p>
          <div className="space-y-2">
            {printStaff.map((s) => {
              const isSelected = selected.has(s.id);
              return (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-violet-300 bg-violet-50/60'
                      : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50/60'
                  } ${busy ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(s.id)}
                    disabled={busy}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-sm text-stone-800">{s.name}</span>
                </label>
              );
            })}
          </div>
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full mt-2 px-4 py-3 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'กำลังบันทึก...' : 'บันทึก Co-work'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ─── Modal content ────────────────────────────────────────

type DetailTab = 'info' | 'spec' | 'history';

function DetailContent({
  job,
  onClose,
  onEdit,
  onEditOrder,
  sessionRole,
}: {
  job: BoardJob;
  onClose: () => void;
  onEdit: () => void;
  onEditOrder: () => void;
  sessionRole: string | null;
}) {
  const canEditOrder = sessionRole === 'admin' || sessionRole === 'sales';
  const [tab, setTab] = useState<DetailTab>('info');
  const dept = job.dept as Dept;
  const deptLabelLong = DEPT_LABELS[dept] || job.dept;
  const staffDef = STAFF[dept]?.find((s) => s.id === job.staff);
  const staffName = staffDef?.name || job.staff;
  const cowork = parseCoworkArray(job.cowork);
  const hasSpec = !!(
    (job.order?.details && Object.keys(job.order.details).length > 0) ||
    cowork.length > 0
  );
  const urgencyColor = URGENCY_COLORS[job.urgency];

  return (
    <div className="flex flex-col max-h-[90vh]">
      {/* Sticky header */}
      <div
        className="px-5 py-3 border-b border-stone-100 bg-white flex items-start justify-between gap-3 flex-shrink-0"
        style={{ borderTop: `4px solid ${urgencyColor}` }}
      >
        <div className="min-w-0 flex-grow">
          <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
            <span
              className="px-2 py-0.5 rounded font-semibold tabular-nums"
              style={{ background: urgencyColor + '20', color: urgencyColor }}
            >
              {URGENCY_LABELS[job.urgency]}
            </span>
            <span className="text-stone-500">
              {deptLabelLong} · <span className="font-medium">{staffName}</span>
            </span>
            <span className="text-stone-400 tabular-nums">#{job.id}</span>
            {job.orderId && (
              <span className="text-stone-400 tabular-nums">order {job.orderId}</span>
            )}
          </div>
          <h2 className="text-lg font-bold text-stone-900 leading-snug break-words">
            {job.name || '(ไม่มีชื่อ)'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100 -mr-2 -mt-1"
          aria-label="ปิด"
        >
          <IconX size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-100 bg-white flex-shrink-0">
        <div className="flex px-5 gap-4 overflow-x-auto">
          <TabBtn active={tab === 'info'} onClick={() => setTab('info')} label="ข้อมูลหลัก" />
          {hasSpec && (
            <TabBtn active={tab === 'spec'} onClick={() => setTab('spec')} label="สเปคงาน" />
          )}
          <TabBtn active={tab === 'history'} onClick={() => setTab('history')} label="ประวัติ" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-grow overflow-y-auto p-5 space-y-4">
        {tab === 'info' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <KVTile label="ชื่องาน" value={job.name} align="left" />
              <KVTile
                label="สถานะ"
                value={URGENCY_LABELS[job.urgency]}
                valueClass="font-medium"
                valueStyle={{ color: urgencyColor }}
              />
              <KVTile label="กำหนดส่ง" value={displayDate(job.dateRaw)} />
              <KVTile label="แผนก" value={deptLabelLong} />
              <KVTile label="ผู้รับผิดชอบ" value={staffName} />
              <KVTile label="วันที่รับงาน" value={displayDate(job.dateInRaw)} />
              {job.orderId && (
                <>
                  <KVTile label="ใบสั่งงาน" value={`#${job.orderId}`} />
                  {job.order?.customer && <KVTile label="ลูกค้า" value={job.order.customer} />}
                </>
              )}
              {job.order?.orderer && <KVTile label="ผู้สั่งงาน" value={job.order.orderer} />}
            </div>
            {cowork.length > 0 && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5">
                <div className="text-xs font-semibold text-violet-700 mb-1.5 flex items-center gap-1.5">
                  <IconUsers size={12} />
                  Co-work — ผู้ร่วมพิมพ์ ({cowork.length})
                </div>
                <ul className="space-y-0.5 text-sm text-stone-700">
                  {cowork.map((cw, i) => {
                    const dept = cw.dept as Dept;
                    const staffName =
                      STAFF[dept]?.find((s) => s.id === cw.staff)?.name || cw.staff;
                    const deptLabel = DEPT_LABELS[dept] || cw.dept;
                    return (
                      <li key={i}>
                        <span className="text-stone-500 text-xs">[{deptLabel}]</span>{' '}
                        <span className="font-medium">{staffName}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {job.order && canEditOrder && (
              <button
                type="button"
                onClick={onEditOrder}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-accent hover:bg-accent/10"
              >
                <IconPencil size={12} />
                แก้ใบสั่งงาน #{job.order.id}
              </button>
            )}
          </>
        )}

        {tab === 'spec' && (
          <>
            {job.order?.details && Object.keys(job.order.details).length > 0 ? (
              <Section title="รายละเอียดงาน">
                <DetailsTable details={job.order.details} />
              </Section>
            ) : (
              <p className="text-sm text-stone-400 text-center py-4">ไม่มีสเปคงาน</p>
            )}

            {cowork.length > 0 && (
              <Section title="Co-work — ผู้ร่วมพิมพ์">
                <ul className="text-sm text-stone-700 space-y-1 px-3 py-2">
                  {cowork.map((cw, i) => {
                    const dept = cw.dept as Dept;
                    const staffName =
                      STAFF[dept]?.find((s) => s.id === cw.staff)?.name || cw.staff;
                    const deptLabel = DEPT_LABELS[dept] || cw.dept;
                    return (
                      <li key={i} className="flex items-center gap-2">
                        <IconUsers size={12} className="text-violet-600 flex-shrink-0" />
                        <span className="text-stone-500 text-xs">[{deptLabel}]</span>
                        <span className="font-medium">{staffName}</span>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}
          </>
        )}

        {tab === 'history' && (
          <div className="text-center py-8 space-y-3">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-100 text-stone-400 mx-auto">
              <IconInfo size={20} />
            </div>
            <p className="text-sm text-stone-500">ประวัติงาน (audit log) ดูได้ใน{' '}
              <a
                href="https://app.penprinting.co/production-monitoring/"
                className="underline hover:text-stone-700"
              >
                ระบบ WP
              </a>
            </p>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className="border-t border-stone-100 bg-stone-50/60 px-5 py-3 flex-shrink-0">
        <ActionButtons job={job} sessionRole={sessionRole} onEdit={onEdit} onSuccess={onClose} />
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
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

/** Tile-style KV — matches WP detail modal grid layout (label top, value bottom in a stone-50 box). */
function KVTile({
  label,
  value,
  align = 'right',
  valueClass = '',
  valueStyle = {},
}: {
  label: string;
  value: string;
  align?: 'left' | 'right';
  valueClass?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="rounded-lg bg-stone-50/60 border border-stone-100 px-3 py-2 flex items-baseline justify-between gap-2">
      <span className="text-xs text-stone-500 font-medium flex-shrink-0">{label}:</span>
      <span
        className={`text-sm text-stone-900 break-words ${align === 'right' ? 'text-right' : 'text-left'} ${valueClass}`}
        style={valueStyle}
      >
        {value || '—'}
      </span>
    </div>
  );
}

// ─── Action buttons ───────────────────────────────────────

function ActionButtons({
  job,
  sessionRole,
  onEdit,
  onSuccess,
}: {
  job: BoardJob;
  sessionRole: string | null;
  onEdit: () => void;
  onSuccess: () => void;
}) {
  const router = useRouter();
  const { recordForward } = useUndo();
  const [busy, setBusy] = useState<null | 'ship' | 'delete' | 'cancel' | 'forward' | 'reassign' | 'cowork'>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<null | 'forward' | 'reassign' | 'cowork'>(null);
  const [actionTarget, setActionTarget] = useState('');
  const [coworkRows, setCoworkRows] = useState<Array<{ dept: string; staff: string }>>([]);
  const isAdmin = sessionRole === 'admin';
  const fromType = computeFromType(String(job.dept), String(job.staff));
  const forwardTargets = fromType ? getVisibleTargets(fromType, isAdmin) : [];
  const canForward = forwardTargets.length > 0;

  // Same-dept reassign targets — exclude current staff and outsource/diecut_out for non-admin.
  const dept = job.dept as Dept;
  const reassignTargets = (STAFF[dept] || [])
    .filter((s) => s.id !== job.staff)
    .filter((s) => isAdmin || !RESTRICTED_TARGETS.has(s.id));
  const canReassign = reassignTargets.length > 0;

  async function callApi(path: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return false;
    }
    broadcastWrite(path);
    return true;
  }

  async function moveToShipped() {
    setError(null);
    setBusy('ship');
    const ok = await callApi('/api/jobs/move-to-shipped', {
      id: job.id,
      name: job.name,
      orderId: job.orderId,
    });
    setBusy(null);
    if (ok) {
      router.refresh();
      onSuccess();
    }
  }

  async function deleteJob() {
    if (!confirm(`ยืนยันการลบงาน "${job.name}" ?\n\nงานจะหายจาก Kanban — ไม่มีปุ่มกู้คืน (ใช้ Cancel ถ้าต้องการเก็บประวัติ)`))
      return;
    setError(null);
    setBusy('delete');
    const ok = await callApi('/api/jobs/delete', { id: job.id });
    setBusy(null);
    if (ok) {
      router.refresh();
      onSuccess();
    }
  }

  async function cancelJob() {
    const reason = prompt(`ยกเลิกงาน "${job.name}" — ใส่เหตุผล:`);
    if (!reason || reason.trim() === '') return;
    setError(null);
    setBusy('cancel');
    const ok = await callApi('/api/jobs/cancel', {
      id: job.id,
      name: job.name,
      dept: job.dept,
      staff: job.staff,
      orderId: job.orderId,
      reason: reason.trim(),
    });
    setBusy(null);
    if (ok) {
      router.refresh();
      onSuccess();
    }
  }

  async function submitForward() {
    const target = forwardTargets.find((t) => t.value === actionTarget);
    if (!actionTarget || !target) {
      setError('กรุณาเลือกปลายทาง');
      return;
    }
    setError(null);
    setBusy('forward');
    // Snapshot the source state BEFORE the API call — needed for undo if admin.
    const preForwardSnapshot = {
      name: job.name,
      dept: String(job.dept),
      staff: job.staff,
      date: job.dateRaw,
      dateIn: job.dateInRaw,
      status: job.status,
      orderId: job.orderId,
      cowork: job.cowork,
    };
    const res = await fetch('/api/jobs/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: job.id,
        targetDept: target.dept,
        targetStaff: target.value,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || `HTTP ${res.status}`);
      return;
    }
    const data = await res.json().catch(() => ({}));
    broadcastWrite('/api/jobs/forward');
    if (sessionRole === 'admin' && data?.newId) {
      recordForward({
        newJobId: Number(data.newId),
        snapshot: preForwardSnapshot,
        destinationLabel: target.label,
        jobName: job.name,
      });
    }
    router.refresh();
    onSuccess();
  }

  async function submitReassign() {
    if (!actionTarget) {
      setError('กรุณาเลือกผู้รับงาน');
      return;
    }
    setError(null);
    setBusy('reassign');
    const ok = await callApi('/api/jobs/reassign', {
      id: job.id,
      targetStaff: actionTarget,
    });
    setBusy(null);
    if (ok) {
      router.refresh();
      onSuccess();
    }
  }

  function startAction(mode: 'forward' | 'reassign' | 'cowork') {
    setError(null);
    setActionTarget('');
    if (mode === 'cowork') {
      const existing = parseCoworkArray(job.cowork);
      setCoworkRows(existing.length > 0 ? existing : [{ dept: '', staff: '' }]);
    }
    setActionMode(mode);
  }

  function cancelAction() {
    setActionMode(null);
    setActionTarget('');
    setCoworkRows([]);
    setError(null);
  }

  async function submitCowork() {
    // Drop empty rows; backend re-validates.
    const cleaned = coworkRows
      .map((r) => ({ dept: r.dept.trim(), staff: r.staff.trim() }))
      .filter((r) => r.dept || r.staff);
    setError(null);
    setBusy('cowork');
    const ok = await callApi('/api/jobs/cowork', { id: job.id, cowork: cleaned });
    setBusy(null);
    if (ok) {
      router.refresh();
      onSuccess();
    }
  }

  return (
    <section>
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
        การดำเนินการ
      </h3>
      {actionMode === 'forward' ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
          <label className="block text-xs font-medium text-stone-700 mb-1.5 flex items-center gap-1.5">
            <IconCornerUpRight size={14} />
            ส่งต่อไปที่
          </label>
          <select
            value={actionTarget}
            onChange={(e) => setActionTarget(e.target.value)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            autoFocus
          >
            <option value="">— เลือกปลายทาง —</option>
            {forwardTargets.map((t) => (
              <option key={`${t.dept}:${t.value}`} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={submitForward}
              disabled={busy !== null || !actionTarget}
              className="flex-1 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'forward' ? 'กำลังส่งต่อ...' : 'ยืนยันส่งต่อ'}
            </button>
            <button
              type="button"
              onClick={cancelAction}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : actionMode === 'cowork' ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-stone-700 flex items-center gap-1.5">
              <IconUsers size={14} />
              Co-work — ผู้ช่วยงาน
            </label>
            <button
              type="button"
              onClick={() => setCoworkRows((rows) => [...rows, { dept: '', staff: '' }])}
              disabled={busy !== null}
              className="text-[11px] text-accent hover:text-accent-dark font-medium disabled:opacity-50 inline-flex items-center gap-1"
            >
              <IconPlus size={11} />
              เพิ่มแถว
            </button>
          </div>
          {coworkRows.length === 0 ? (
            <p className="text-xs text-stone-500 px-1 py-2">
              ไม่มีผู้ช่วยงาน — กด &quot;เพิ่มแถว&quot; เพื่อใส่
            </p>
          ) : (
            <div className="space-y-2">
              {coworkRows.map((row, i) => {
                const staffOptions = STAFF[row.dept as Dept] || [];
                return (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={row.dept}
                      onChange={(e) => {
                        const newDept = e.target.value;
                        setCoworkRows((rows) =>
                          rows.map((r, idx) =>
                            idx === i
                              ? {
                                  dept: newDept,
                                  staff:
                                    STAFF[newDept as Dept]?.some((s) => s.id === r.staff) ? r.staff : '',
                                }
                              : r,
                          ),
                        );
                      }}
                      disabled={busy !== null}
                      className="flex-1 px-2 py-1.5 border border-stone-200 rounded text-sm bg-white focus:outline-none focus:border-accent disabled:opacity-50"
                    >
                      <option value="">— แผนก —</option>
                      {(['graphic', 'print', 'post'] as Dept[]).map((d) => (
                        <option key={d} value={d}>
                          {DEPT_LABELS[d]}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.staff}
                      onChange={(e) =>
                        setCoworkRows((rows) =>
                          rows.map((r, idx) =>
                            idx === i ? { ...r, staff: e.target.value } : r,
                          ),
                        )
                      }
                      disabled={busy !== null || !row.dept}
                      className="flex-1 px-2 py-1.5 border border-stone-200 rounded text-sm bg-white focus:outline-none focus:border-accent disabled:opacity-50"
                    >
                      <option value="">— ผู้รับงาน —</option>
                      {staffOptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setCoworkRows((rows) => rows.filter((_, idx) => idx !== i))
                      }
                      disabled={busy !== null}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 text-stone-400 hover:text-red-700 disabled:opacity-50"
                      aria-label="ลบแถว"
                      title="ลบแถวนี้"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={submitCowork}
              disabled={busy !== null}
              className="flex-1 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'cowork' ? 'กำลังบันทึก...' : 'บันทึก co-work'}
            </button>
            <button
              type="button"
              onClick={cancelAction}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : actionMode === 'reassign' ? (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
          <label className="block text-xs font-medium text-stone-700 mb-1.5 flex items-center gap-1.5">
            <IconRefreshCw size={14} />
            ย้ายไปที่ <span className="text-stone-400 font-normal">(แผนกเดิม: {DEPT_LABELS[dept]})</span>
          </label>
          <select
            value={actionTarget}
            onChange={(e) => setActionTarget(e.target.value)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            autoFocus
          >
            <option value="">— เลือกผู้รับงาน —</option>
            {reassignTargets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.isVendor ? ' (vendor)' : ''}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={submitReassign}
              disabled={busy !== null || !actionTarget}
              className="flex-1 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy === 'reassign' ? 'กำลังย้าย...' : 'ยืนยันย้าย'}
            </button>
            <button
              type="button"
              onClick={cancelAction}
              disabled={busy !== null}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={moveToShipped}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <IconCheck size={16} />
            {busy === 'ship' ? 'กำลังส่ง...' : 'จัดส่งเสร็จ'}
          </button>
          {canForward && (
            <button
              type="button"
              onClick={() => startAction('forward')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-100 text-sky-800 text-sm font-medium hover:bg-sky-200 disabled:opacity-50"
            >
              <IconCornerUpRight size={16} />
              ส่งต่อ
            </button>
          )}
          {canReassign && (
            <button
              type="button"
              onClick={() => startAction('reassign')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-100 text-violet-800 text-sm font-medium hover:bg-violet-200 disabled:opacity-50"
            >
              <IconRefreshCw size={16} />
              ย้าย
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={onEdit}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-stone-100 text-stone-800 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              <IconPencil size={16} />
              แก้ไข
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={cancelJob}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
            >
              <IconAlertTriangle size={16} />
              {busy === 'cancel' ? 'กำลังยกเลิก...' : 'ยกเลิก (admin)'}
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={deleteJob}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-100 text-red-800 text-sm font-medium hover:bg-red-200 disabled:opacity-50"
            >
              <IconTrash size={16} />
              {busy === 'delete' ? 'กำลังลบ...' : 'ลบงาน'}
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      <p className="text-[11px] text-stone-400 mt-2">
        การกระทำส่งไปยังระบบหลัก (Apps Script) — มี audit log บันทึกอัตโนมัติ
      </p>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 bg-stone-50/40">
        {children}
      </div>
    </section>
  );
}


// Friendly labels for known detail keys (port of `lb` map in WP frontend ~line 1109)
const DETAIL_LABELS: Record<string, string> = {
  size: 'ขนาด',
  qty: 'จำนวน',
  paperCover: 'กระดาษปก',
  paperInner: 'กระดาษเนื้อใน',
  coverColor: 'สีปก',
  innerColor: 'สีเนื้อใน',
  plate: 'PLATE/Copy',
  plateSize: 'ขนาดเพลท',
  billPerSet: 'บิล/ชุด',
  setPerBook: 'ชุด/เล่ม',
  sheetPerBook: 'แผ่น/เล่ม',
  billColors: 'สีบิล',
  perf: 'ปรุ',
  runNo: 'หมายเลขรัน',
  binding: 'เข้าเล่ม',
  coating: 'เคลือบ',
  stamp: 'ปั๊ม/ไดคัท',
  forwardPrint: 'ส่งต่อพิมพ์',
  orderer: 'ผู้สั่งงาน',
  notes: 'หมายเหตุ',
  photobook: 'รายการ Photobook',
};

function DetailsTable({ details }: { details: Record<string, unknown> }) {
  // Filter empty + sort with known keys first
  const entries = Object.entries(details).filter(([, v]) => {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string' && v.trim() === '') return false;
    if (typeof v === 'boolean') return v === true; // hide false flags
    return true;
  });
  if (entries.length === 0) return <div className="px-3 py-2 text-sm text-stone-400">—</div>;
  return (
    <>
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-3 px-3 py-2 text-sm">
          <span className="text-stone-500 min-w-[100px] shrink-0">{DETAIL_LABELS[k] || k}</span>
          <span className="text-stone-900 break-words">
            {typeof v === 'object' ? <code className="text-xs">{JSON.stringify(v)}</code> : String(v)}
          </span>
        </div>
      ))}
    </>
  );
}

interface CoworkEntry {
  dept: string;
  staff: string;
}

/** Parse cowork field — accepts WP string[] (assumes print dept) and legacy
 *  v2 object form. Always returns {dept, staff}[]. */
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
