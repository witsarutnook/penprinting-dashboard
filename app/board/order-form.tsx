'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF, DEPT_LABELS, type Dept } from '@/lib/board';
import { bangkokTodayISO } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import {
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconFileText,
} from '@/lib/icons';

const DEPT_ORDER: Dept[] = ['graphic', 'print', 'post'];

interface OrderFormProps {
  open: boolean;
  onClose: () => void;
  /** Default orderer from the session — sales/admin name. */
  defaultOrderer: string;
}

interface SuccessInfo {
  orderId: number;
  jobId: number | null;
  pin: string;
  partial: boolean;
  warning?: string;
}

/** Order entry MVP — header fields + initial assignment. Photobook tab,
 *  templates, and edit mode are deferred to Phase 3.5.5b. */
export function OrderForm({ open, onClose, defaultOrderer }: OrderFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();

  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [dateDue, setDateDue] = useState('');
  const [dateIn, setDateIn] = useState('');
  const [price, setPrice] = useState('');
  const [orderer, setOrderer] = useState(defaultOrderer || '');
  const [dept, setDept] = useState<Dept>('graphic');
  const [staff, setStaff] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCustomer('');
    setDateDue('');
    setDateIn(bangkokTodayISO());
    setPrice('');
    setOrderer(defaultOrderer || '');
    setDept('graphic');
    setStaff('');
    setNotes('');
    setBusy(false);
    setError(null);
    setSuccess(null);
  }, [open, defaultOrderer]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    function onClick(e: MouseEvent) {
      if ((e.target as HTMLElement)?.tagName === 'DIALOG') onClose();
    }
    function onCancel(e: Event) {
      e.preventDefault();
      onClose();
    }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  function changeDept(next: Dept) {
    setDept(next);
    const stillValid = STAFF[next]?.some((s) => s.id === staff);
    if (!stillValid) setStaff('');
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    const body = {
      name: name.trim(),
      customer: customer.trim(),
      dateIn: dateIn || undefined,
      dateDue,
      price: price.trim() || undefined,
      orderer: orderer.trim(),
      assignDept: dept,
      assignStaff: staff,
      details: notes.trim() ? { notes: notes.trim() } : undefined,
    };

    try {
      const res = await fetch('/api/orders/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/orders/add');
      router.refresh();
      setSuccess({
        orderId: Number(data.orderId),
        jobId: data.jobId == null ? null : Number(data.jobId),
        pin: String(data.pin || ''),
        partial: !!data.partial,
        warning: data.warning,
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  const staffOptions = STAFF[dept] || [];

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[94vw]"
    >
      {success ? (
        <div className="flex flex-col max-h-[90vh]">
          <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              {success.partial ? (
                <IconAlertTriangle size={18} className="text-amber-600" />
              ) : (
                <IconCheck size={18} className="text-emerald-600" />
              )}
              {success.partial ? 'ใบสั่งบันทึกบางส่วน' : 'สร้างใบสั่งงานเสร็จ'}
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
          <div className="p-5 space-y-3">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-2 text-sm">
              <div>
                <span className="text-stone-600">เลขใบสั่ง:</span>{' '}
                <strong className="tabular-nums text-stone-900">#{success.orderId}</strong>
              </div>
              {success.jobId != null && (
                <div>
                  <span className="text-stone-600">Job ID:</span>{' '}
                  <strong className="tabular-nums text-stone-900">#{success.jobId}</strong>
                </div>
              )}
              <div>
                <span className="text-stone-600">PIN ลูกค้าใช้ track:</span>{' '}
                <strong className="tabular-nums text-stone-900">{success.pin}</strong>
              </div>
            </div>
            {success.warning && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
                <IconAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{success.warning}</span>
              </div>
            )}
            <p className="text-xs text-stone-500 flex items-start gap-1.5">
              <IconFileText size={13} className="flex-shrink-0 mt-0.5 text-stone-400" />
              <span>
                ฟีเจอร์เต็ม (Photobook tab, edit mode, templates, duplicate detection) ใน{' '}
                <a
                  href="https://app.penprinting.co/production-monitoring/"
                  className="underline hover:text-stone-700"
                >
                  ระบบ WP
                </a>
              </span>
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
              >
                สร้างใบสั่งใหม่
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark"
              >
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col max-h-[90vh]">
          <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <IconFileText size={18} />
              สร้างใบสั่งงาน
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
                autoFocus
                maxLength={200}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                placeholder="เช่น นามบัตร บริษัท ABC, โบรชัวร์ A4"
              />
            </Field>

            <Field label="ลูกค้า *">
              <input
                type="text"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                required
                maxLength={200}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="วันรับงาน">
                <input
                  type="date"
                  value={dateIn}
                  onChange={(e) => setDateIn(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
                />
              </Field>
              <Field label="กำหนดส่ง *">
                <input
                  type="date"
                  value={dateDue}
                  onChange={(e) => setDateDue(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="ราคา" hint="ใส่ตัวเลขหรือข้อความ — ปล่อยว่างได้">
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
                  placeholder="เช่น 1,500"
                />
              </Field>
              <Field label="ผู้สั่งงาน *">
                <input
                  type="text"
                  value={orderer}
                  onChange={(e) => setOrderer(e.target.value)}
                  required
                  maxLength={100}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="แผนกเริ่มต้น *">
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
              <Field label="ผู้รับงานเริ่มต้น *">
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

            <Field label="หมายเหตุ" hint="รายละเอียดเพิ่มเติม (ขนาด/กระดาษ/สี ฯลฯ) — บันทึกใน details">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y"
                placeholder="เช่น A4 200 แผ่น, อาร์ตการ์ด 260 แกรม, ปั๊มฟอยล์ทอง"
              />
            </Field>

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-[11px] text-stone-400">
              MVP — Photobook tab + edit + templates ใช้ใน WP
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark disabled:opacity-50"
              >
                {busy ? 'กำลังบันทึก...' : 'สร้างใบสั่งงาน'}
              </button>
            </div>
          </footer>
        </form>
      )}
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
