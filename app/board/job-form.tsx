'use client';

import { useEffect, useRef, useState } from 'react';
import { STAFF, DEPT_LABELS, type Dept, type BoardJob } from '@/lib/board';
import { dmyToISOInput, bangkokTodayISO } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import { useToast } from '@/components/toast-provider';
import { usePendingMutations } from '@/components/board/pending-mutations';
import { IconX, IconPencil, IconPlus, IconAlertCircle } from '@/lib/icons';

const DEPT_ORDER: Dept[] = ['graphic', 'print', 'post'];

interface JobFormProps {
  /** Pre-fill values for edit mode. Omit to add a new job. */
  initial?: BoardJob | null;
  /** Default dept when adding (e.g. opening from a column header — Phase 3.5.6). */
  defaultDept?: Dept;
  defaultStaff?: string;
  open: boolean;
  onClose: () => void;
}

/** Native <dialog> add/edit job modal — used in `/board` page + card detail. */
export function JobForm({ initial, defaultDept, defaultStaff, open, onClose }: JobFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const toast = useToast();
  const { commit } = usePendingMutations();
  const isEdit = !!initial;

  const [name, setName] = useState('');
  const [dateDue, setDateDue] = useState('');
  const [dateIn, setDateIn] = useState('');
  const [dept, setDept] = useState<Dept>('graphic');
  const [staff, setStaff] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Auditor M2 (2026-05-08): submit-in-flight guard. The optimistic-close
  // refactor (3cb4501) closes the modal immediately on submit, but if
  // the user double-taps faster than the close animation we'd POST
  // twice — `/api/jobs/add` has no idempotency on (name, dept, staff)
  // for orderless jobs so we'd end up with duplicate rows. Ref-based
  // guard so re-renders don't reset it; cleared on `open` toggle.
  const submittedRef = useRef(false);

  // (Re)initialize fields whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name || '');
      setDateDue(dmyToISOInput(initial.dateRaw));
      setDateIn(dmyToISOInput(initial.dateInRaw));
      setDept((initial.dept as Dept) || 'graphic');
      setStaff(initial.staff || '');
      setOrderId(initial.orderId ? String(initial.orderId) : '');
    } else {
      setName('');
      setDateDue('');
      setDateIn(bangkokTodayISO());
      setDept(defaultDept || 'graphic');
      setStaff(defaultStaff || '');
      setOrderId('');
    }
    setError(null);
    submittedRef.current = false;
  }, [open, initial, defaultDept, defaultStaff]);

  // Open/close native dialog in sync with prop.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  // Backdrop click closes (matches card.tsx pattern).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'DIALOG') onClose();
    }
    dlg.addEventListener('click', onClick);
    return () => dlg.removeEventListener('click', onClick);
  }, [onClose]);

  // ESC key dispatches a 'cancel' event on <dialog> — wire it to onClose so
  // parent state stays in sync (otherwise next open() races with stale state).
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onCancel(e: Event) {
      e.preventDefault();
      onClose();
    }
    dlg.addEventListener('cancel', onCancel);
    return () => dlg.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const staffOptions = STAFF[dept] || [];

  function changeDept(next: Dept) {
    setDept(next);
    // If current staff isn't valid in the new dept, reset.
    const stillValid = STAFF[next]?.some((s) => s.id === staff);
    if (!stillValid) setStaff('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Re-entry guard (auditor M2). If a previous submit is in flight
    // (modal mid-close), drop the second call entirely — toast already
    // showed "กำลังบันทึก" so the UX feels right.
    if (submittedRef.current) return;
    submittedRef.current = true;
    setError(null);
    // Snapshot prop + state values BEFORE closing the modal. Once `open`
    // flips, the parent may reopen the form with a DIFFERENT job (Job-A
    // save → user opens Job-B); the in-flight fetch's later callbacks
    // would otherwise reference whatever `initial?.id` resolves to on
    // the current closure scope, which is correct for behavior but UX-
    // confusing when the toast pops with Job-A's id while user is
    // staring at Job-B's form. Explicit snapshot keeps toasts pinned to
    // the row that was actually saved. (Auditor M3 finding.)
    const jobName = name.trim();
    const editId = isEdit ? initial?.id ?? null : null;

    const path = isEdit ? '/api/jobs/update' : '/api/jobs/add';
    const body: Record<string, unknown> = {
      name: jobName,
      date: dateDue,
      dateIn: dateIn || undefined,
      dept,
      staff,
      orderId: orderId ? Number(orderId) : undefined,
    };
    if (isEdit && initial) {
      body.id = initial.id;
      body.status = initial.status || 'pending';
      // Preserve cowork — form doesn't edit it (Phase 3.5.7).
      if (initial.cowork) body.cowork = initial.cowork;
    }

    // Close modal immediately + fire the write in the background.
    // Sidebar/bottom-nav pulsing dot lights up via commit() until the
    // SSR re-render lands the updated card. Matches CoworkDialog
    // pattern in card.tsx — no more 300-500ms modal-still-open lag.
    onClose();
    toast.show(isEdit ? `กำลังบันทึกงาน #${editId}...` : `กำลังเพิ่มงาน "${jobName}"...`);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || `บันทึกไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite(path);
      toast.success(isEdit ? `บันทึก #${editId} เรียบร้อย` : `เพิ่ม "${jobName}" เรียบร้อย`);
      commit(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-lg w-[92vw]"
    >
      <form onSubmit={onSubmit} className="flex flex-col max-h-[90vh]">
        <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
            {isEdit ? <IconPencil size={18} /> : <IconPlus size={18} />}
            {isEdit ? `แก้ไขงาน #${initial?.id}` : 'เพิ่มงานใหม่'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100"
            aria-label="ปิด"
          >
            <IconX size={20} />
          </button>
        </header>

        <div className="flex-grow overflow-y-auto p-5 space-y-4">
          <Field label="ชื่องาน *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus={!isEdit}
              maxLength={200}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="กำหนดส่ง *">
              <input
                type="date"
                value={dateDue}
                onChange={(e) => setDateDue(e.target.value)}
                required
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
              />
            </Field>
            <Field label="วันรับงาน">
              <input
                type="date"
                value={dateIn}
                onChange={(e) => setDateIn(e.target.value)}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="แผนก *">
              <select
                value={dept}
                onChange={(e) => changeDept(e.target.value as Dept)}
                required
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                {DEPT_ORDER.map((d) => (
                  <option key={d} value={d}>
                    {DEPT_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ผู้รับงาน *">
              <select
                value={staff}
                onChange={(e) => setStaff(e.target.value)}
                required
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="">— เลือก —</option>
                {staffOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isVendor ? ' (vendor)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="เลขที่ใบสั่งงาน (ถ้ามี)" hint="ใส่เพื่อเชื่อมกับใบสั่งเดิม — ลูกค้าจะแสดงอัตโนมัติบนการ์ด">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm tabular-nums focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </Field>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-3">
          <p className="text-[11px] text-stone-400">
            บันทึกผ่าน Apps Script — มี audit log อัตโนมัติ
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark"
            >
              {isEdit ? 'บันทึกการแก้ไข' : 'เพิ่มงาน'}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}
