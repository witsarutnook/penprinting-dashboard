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
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import { usePendingMutations } from '@/components/board/pending-mutations';
import { OrderForm } from './order-form';
import {
  IconCheck,
  IconX,
  IconPencil,
  IconAlertTriangle,
  IconAlertCircle,
  IconInfo,
  IconCornerUpRight,
  IconRefreshCw,
  IconUser,
  IconUsers,
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
  const confirmDlg = useConfirm();
  const toast = useToast();
  const { hideJob, unhideJob, commit } = usePendingMutations();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editOrderOpen, setEditOrderOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [coworkOpen, setCoworkOpen] = useState(false);
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
    const ok = await confirmDlg.confirm({
      title: 'จัดส่งเสร็จ?',
      message: `ปิดงาน "${job.name}" และย้ายไป /shipped`,
      okLabel: 'จัดส่งเสร็จ',
      variant: 'default',
    });
    if (!ok) return;
    // Optimistic: hide card + show toast immediately. WP-style instant feedback.
    hideJob(job.id);
    toast.show(`กำลังจัดส่ง "${job.name}"...`);
    try {
      const res = await fetch('/api/jobs/move-to-shipped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, name: job.name, orderId: job.orderId }),
      });
      if (!res.ok) {
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `จัดส่งไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/move-to-shipped');
      toast.success(`จัดส่ง "${job.name}" เรียบร้อย`);
      commit(() => unhideJob(job.id));
    } catch (err) {
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
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

  // Safety net: if dragend never fires (browser quirk / unmount mid-drag),
  // the body[data-dragging] flag would stick and disable auto-sync forever.
  // Clear on unmount.
  useEffect(() => {
    return () => {
      if (document.body.dataset.dragging === '1') {
        delete document.body.dataset.dragging;
      }
    };
  }, []);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    if (!draggable) {
      e.preventDefault();
      return;
    }
    // If the user grabbed an interactive child (button / link / form input),
    // cancel the drag so the click can fire instead. Without this, even a
    // tiny mouse move while pressing a button kicks off a drag and the
    // onClick is silently swallowed — the bug user sees as "Quick-win
    // buttons หายหมด".
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, select, textarea, label')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData(`application/x-job-${dept}`, String(job.id));
    e.dataTransfer.setData('application/x-job-any', String(job.id));
    e.dataTransfer.setData('application/x-job-source-dept', dept);
    // Carry source staff so the drop handler can derive fromType correctly.
    // Without this, computeFromType(sourceDept, '') returns 'any' (only ship
    // is a valid target) and the client-side gate falsely rejects valid
    // cross-dept forwards (e.g. print:cut → post:bind).
    e.dataTransfer.setData('application/x-job-source-staff', String(job.staff || ''));
    // Full source snapshot so the drop handler can POST without a server-side
    // loadAllFresh round-trip (matches the modal-based forward path).
    e.dataTransfer.setData('application/x-job-snapshot', JSON.stringify({
      name: job.name,
      dept: dept,
      staff: job.staff,
      date: job.dateRaw,
      dateIn: job.dateInRaw,
      status: job.status,
      orderId: job.orderId,
      cowork: job.cowork,
    }));
    e.dataTransfer.setData('text/plain', String(job.id));
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
    // Tell auto-sync to back off while a card is being dragged
    document.body.dataset.dragging = '1';
  }
  function handleDragEnd() {
    setIsDragging(false);
    delete document.body.dataset.dragging;
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
                disabled={bulkMode}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-medium text-[12px] disabled:opacity-50"
                title="จัดส่งเสร็จ — ปิดงาน"
              >
                <IconCheck size={13} />
                จัดส่งเสร็จ
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
  const { recordForward } = useUndo();
  const toast = useToast();
  const { hideJob, unhideJob, addPendingInsert, removePendingInsert, commit } = usePendingMutations();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
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
    // Optimistic UX: hide source + inject phantom in destination column +
    // close modal + show toast immediately. Card "moves" instantly like WP.
    // forward clears cowork → phantom uses cleared cowork.
    const phantomTempId = addPendingInsert({
      job: { ...job, hasCowork: false, cowork: undefined },
      destDept: tgt.dept,
      destStaff: tgt.value,
    });
    hideJob(job.id);
    onClose();
    toast.show(`กำลังส่งต่อ "${job.name}" → ${tgt.label}...`);
    try {
      const res = await fetch('/api/jobs/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          targetDept: tgt.dept,
          targetStaff: tgt.value,
          note: note.trim() || undefined,
          srcJob: {
            name: job.name,
            dept: String(job.dept),
            staff: job.staff,
            date: job.dateRaw,
            dateIn: job.dateInRaw,
            orderId: job.orderId,
          },
        }),
      });
      if (!res.ok) {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `ส่งต่อไม่สำเร็จ — HTTP ${res.status}`);
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
      } else {
        toast.success(`ส่งต่อ "${job.name}" → ${tgt.label}`);
      }
      // commit() refreshes inside a transition and fires cleanup AFTER the
      // new SSR data has streamed in — phantom + hidden flag stay until
      // the real card is on screen, so the source row never bounces back.
      commit(() => {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
      });
    } catch (err) {
      removePendingInsert(phantomTempId);
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
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
            className="text-stone-400 hover:text-stone-700 w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
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
                autoFocus
                className="w-full px-3 py-2 border border-sky-300 rounded-lg text-sm bg-white focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
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
            className="px-4 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!target}
            className="px-5 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ส่งต่อ
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
        <ActionButtons
          job={job}
          sessionRole={sessionRole}
          onEdit={onEdit}
          onEditOrder={onEditOrder}
          onSuccess={onClose}
        />
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
  onEditOrder,
  onSuccess,
}: {
  job: BoardJob;
  sessionRole: string | null;
  onEdit: () => void;
  onEditOrder: () => void;
  onSuccess: () => void;
}) {
  const confirmDlg = useConfirm();
  const { recordForward } = useUndo();
  const toast = useToast();
  const { hideJob, unhideJob, addPendingInsert, removePendingInsert, commit } = usePendingMutations();
  const [error, setError] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<null | 'forward' | 'reassign'>(null);
  const [actionTarget, setActionTarget] = useState('');
  const isAdmin = sessionRole === 'admin';
  const fromType = computeFromType(String(job.dept), String(job.staff));
  const forwardTargets = fromType ? getVisibleTargets(fromType, isAdmin) : [];
  const canForward = forwardTargets.length > 0;
  // จัดส่งเสร็จ — only on the post:ship column (matches Card-level rule)
  const canShip = String(job.dept) === 'post' && job.staff === 'ship';

  // Same-dept reassign targets — exclude current staff and outsource/diecut_out for non-admin.
  const dept = job.dept as Dept;
  const reassignTargets = (STAFF[dept] || [])
    .filter((s) => s.id !== job.staff)
    .filter((s) => isAdmin || !RESTRICTED_TARGETS.has(s.id));
  const canReassign = reassignTargets.length > 0;

  async function moveToShipped() {
    setError(null);
    // Optimistic: hide + dismiss action sheet + toast.
    hideJob(job.id);
    onSuccess();
    toast.show(`กำลังจัดส่ง "${job.name}"...`);
    try {
      const res = await fetch('/api/jobs/move-to-shipped', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id, name: job.name, orderId: job.orderId }),
      });
      if (!res.ok) {
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `จัดส่งไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/move-to-shipped');
      toast.success(`จัดส่ง "${job.name}" เรียบร้อย`);
      commit(() => unhideJob(job.id));
    } catch (err) {
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  async function cancelJob() {
    const reason = await confirmDlg.prompt({
      title: `ยกเลิกงาน "${job.name}"`,
      message: 'ระบุเหตุผลการยกเลิก — งานจะถูกย้ายไปรายการยกเลิกพร้อมเหตุผลนี้',
      placeholder: 'เช่น ลูกค้าขอยกเลิก / ส่งซ้ำใหม่ / สเปคเปลี่ยน',
      okLabel: 'ยกเลิกงาน',
      variant: 'warn',
    });
    if (!reason || !reason.trim()) return;
    setError(null);
    // Optimistic: hide + dismiss + toast.
    hideJob(job.id);
    onSuccess();
    toast.show(`กำลังยกเลิก "${job.name}"...`);
    try {
      const res = await fetch('/api/jobs/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          name: job.name,
          dept: job.dept,
          staff: job.staff,
          orderId: job.orderId,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `ยกเลิกไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/cancel');
      toast.success(`ยกเลิก "${job.name}" — ${reason.trim()}`);
      commit(() => unhideJob(job.id));
    } catch (err) {
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  async function submitForward() {
    const target = forwardTargets.find((t) => t.value === actionTarget);
    if (!actionTarget || !target) {
      setError('กรุณาเลือกปลายทาง');
      return;
    }
    setError(null);
    // Snapshot for admin undo path
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
    // Optimistic: hide source + phantom-insert in destination + dismiss
    // action sheet + show toast. Forward clears cowork.
    const phantomTempId = addPendingInsert({
      job: { ...job, hasCowork: false, cowork: undefined },
      destDept: target.dept,
      destStaff: target.value,
    });
    hideJob(job.id);
    onSuccess();
    toast.show(`กำลังส่งต่อ "${job.name}" → ${target.label}...`);
    try {
      const res = await fetch('/api/jobs/forward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          targetDept: target.dept,
          targetStaff: target.value,
          srcJob: {
            name: job.name,
            dept: String(job.dept),
            staff: job.staff,
            date: job.dateRaw,
            dateIn: job.dateInRaw,
            orderId: job.orderId,
          },
        }),
      });
      if (!res.ok) {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `ส่งต่อไม่สำเร็จ — HTTP ${res.status}`);
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
      } else {
        toast.success(`ส่งต่อ "${job.name}" → ${target.label}`);
      }
      commit(() => {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
      });
    } catch (err) {
      removePendingInsert(phantomTempId);
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  async function submitReassign() {
    if (!actionTarget) {
      setError('กรุณาเลือกผู้รับงาน');
      return;
    }
    setError(null);
    const targetLabel =
      reassignTargets.find((s) => s.id === actionTarget)?.name || actionTarget;
    // Optimistic: hide source + phantom-insert in new staff column + dismiss
    // action sheet + toast. Reassign keeps cowork on the card.
    const phantomTempId = addPendingInsert({
      job,
      destDept: String(job.dept),
      destStaff: actionTarget,
    });
    hideJob(job.id);
    onSuccess();
    toast.show(`กำลังย้าย "${job.name}" → ${targetLabel}...`);
    try {
      const res = await fetch('/api/jobs/reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: job.id,
          targetStaff: actionTarget,
          srcJob: {
            name: job.name,
            dept: String(job.dept),
            staff: job.staff,
            date: job.dateRaw,
            dateIn: job.dateInRaw,
            status: job.status,
            orderId: job.orderId,
            cowork: job.cowork,
          },
        }),
      });
      if (!res.ok) {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
        const data = await res.json().catch(() => ({}));
        toast.error(data?.error || `ย้ายไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/reassign');
      toast.success(`ย้าย "${job.name}" → ${targetLabel}`);
      commit(() => {
        removePendingInsert(phantomTempId);
        unhideJob(job.id);
      });
    } catch (err) {
      removePendingInsert(phantomTempId);
      unhideJob(job.id);
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  function startAction(mode: 'forward' | 'reassign') {
    setError(null);
    setActionTarget('');
    setActionMode(mode);
  }

  function cancelAction() {
    setActionMode(null);
    setActionTarget('');
    setError(null);
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
              disabled={!actionTarget}
              className="flex-1 px-3 py-2 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ยืนยันส่งต่อ
            </button>
            <button
              type="button"
              onClick={cancelAction}
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
              disabled={!actionTarget}
              className="flex-1 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ยืนยันย้าย
            </button>
            <button
              type="button"
              onClick={cancelAction}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canShip && (
            <button
              type="button"
              onClick={moveToShipped}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconCheck size={16} />
              จัดส่งเสร็จ
            </button>
          )}
          {canForward && (
            <button
              type="button"
              onClick={() => startAction('forward')}
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
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-100 text-violet-800 text-sm font-medium hover:bg-violet-200 disabled:opacity-50"
            >
              <IconRefreshCw size={16} />
              ย้าย
            </button>
          )}
          {/* แก้ไข: admin only — both job spec edit + order spec edit
           *  reach admin-gated APIs (/api/jobs/update, /api/orders/update). */}
          {isAdmin && (
            <button
              type="button"
              onClick={job.orderId ? onEditOrder : onEdit}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 disabled:opacity-50"
              title={job.orderId
                ? `แก้ใบสั่งงาน #${job.orderId} (cascade ไป Job ที่เชื่อมอยู่)`
                : 'แก้ Job (งานไม่มีใบสั่งแม่)'}
            >
              <IconPencil size={16} />
              {job.orderId ? `แก้ใบสั่ง #${job.orderId}` : 'แก้ไข Job'}
            </button>
          )}
          {/* ยกเลิก: เก็บใน /cancelled — กู้คืนได้. (ลบถาวรเอาออกตามคำขอ —
           *  cancel ถือเป็น default ปลอดภัยพอ ไม่ต้องมีตัวเลือกลบจริง) */}
          {isAdmin && (
            <button
              type="button"
              onClick={cancelJob}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
              title="ย้ายไปรายการยกเลิก — กู้คืนได้ภายหลังจาก /cancelled"
            >
              <IconAlertTriangle size={16} />
              ยกเลิกงาน
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
