'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF, DEPT_LABELS, type Dept } from '@/lib/board';
import { bangkokTodayISO, dmyToISOInput } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import {
  PB_SIZES,
  PB_BINDINGS,
  type PhotobookItem,
  emptyPhotobookItem,
} from '@/lib/photobook';
import {
  IconX,
  IconCheck,
  IconAlertTriangle,
  IconAlertCircle,
  IconFileText,
  IconPlus,
} from '@/lib/icons';
import type { OrderSummary } from '@/lib/board';

const DEPT_ORDER: Dept[] = ['graphic', 'print', 'post'];

interface OrderFormProps {
  open: boolean;
  onClose: () => void;
  defaultOrderer: string;
  /** Edit mode — prefill values from existing order summary (denormalized
   *  into BoardJob.order so we can render edit without a refetch). */
  initial?: OrderSummary | null;
}

interface SuccessInfo {
  orderId: number;
  jobId: number | null;
  pin: string;
  partial: boolean;
  warning?: string;
  isEdit: boolean;
  cascaded?: number;
}

interface DuplicateInfo {
  duplicates: Array<{ id: number; name: string; customer: string; dateIn: string }>;
}

export function OrderForm({ open, onClose, defaultOrderer, initial }: OrderFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();
  const isEdit = !!initial;

  const [orderType, setOrderType] = useState<'normal' | 'photobook'>('normal');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');
  const [dateDue, setDateDue] = useState('');
  const [dateIn, setDateIn] = useState('');
  const [price, setPrice] = useState('');
  const [orderer, setOrderer] = useState(defaultOrderer || '');
  const [dept, setDept] = useState<Dept>('graphic');
  const [staff, setStaff] = useState('');
  const [notes, setNotes] = useState('');
  const [photobookItems, setPhotobookItems] = useState<PhotobookItem[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const raw = (initial.rawData || {}) as Record<string, unknown>;
      const details = (initial.details || {}) as Record<string, unknown>;
      const isPB = String(raw.orderType || '') === 'photobook';
      setOrderType(isPB ? 'photobook' : 'normal');
      setName(String(initial.name || ''));
      setCustomer(String(initial.customer || ''));
      setDateDue(dmyToISOInput(initial.dateDue));
      setDateIn(dmyToISOInput(initial.dateIn));
      setPrice(String(initial.price ?? ''));
      setOrderer(String(initial.orderer || defaultOrderer));
      setDept((initial.assignDept as Dept) || 'graphic');
      setStaff(String(initial.assignStaff || ''));
      setNotes(String(details.notes || ''));
      const pbItems = Array.isArray(details.photobook) ? (details.photobook as PhotobookItem[]) : [];
      setPhotobookItems(pbItems.length ? pbItems : isPB ? [emptyPhotobookItem()] : []);
    } else {
      setOrderType('normal');
      setName('');
      setCustomer('');
      setDateDue('');
      setDateIn(bangkokTodayISO());
      setPrice('');
      setOrderer(defaultOrderer || '');
      setDept('graphic');
      setStaff('');
      setNotes('');
      setPhotobookItems([]);
    }
    setBusy(false);
    setError(null);
    setSuccess(null);
    setDuplicate(null);
  }, [open, initial, defaultOrderer]);

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

  function switchType(next: 'normal' | 'photobook') {
    setOrderType(next);
    if (next === 'photobook' && photobookItems.length === 0) {
      setPhotobookItems([emptyPhotobookItem()]);
    }
  }

  function updatePbItem(i: number, patch: Partial<PhotobookItem>) {
    setPhotobookItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addPbItem() {
    setPhotobookItems((arr) => [...arr, emptyPhotobookItem()]);
  }
  function removePbItem(i: number) {
    setPhotobookItems((arr) => arr.filter((_, idx) => idx !== i));
  }

  async function submit(force = false) {
    setError(null);
    setBusy(true);

    const body: Record<string, unknown> = {
      name: name.trim(),
      customer: customer.trim(),
      dateIn: dateIn || undefined,
      dateDue,
      price: price.trim() || undefined,
      orderer: orderer.trim(),
      assignDept: dept,
      assignStaff: staff,
      notes: notes.trim() || undefined,
      orderType,
    };
    if (orderType === 'photobook') body.photobookItems = photobookItems;
    if (isEdit && initial) body.id = initial.id;
    if (force) body.force = true;

    const path = isEdit ? '/api/orders/update' : '/api/orders/add';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (res.status === 409 && data?.error === 'duplicate') {
        setDuplicate({ duplicates: data.duplicates || [] });
        return;
      }
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite(path);
      router.refresh();
      setSuccess({
        orderId: Number(data.orderId || (initial?.id ?? 0)),
        jobId: data.jobId == null ? null : Number(data.jobId),
        pin: String(data.pin || ''),
        partial: !!data.partial,
        warning: data.warning,
        isEdit,
        cascaded: data.cascaded,
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  const staffOptions = STAFF[dept] || [];

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[94vw]"
    >
      {success ? (
        <SuccessView success={success} onClose={onClose} onCreateAnother={() => setSuccess(null)} isEdit={isEdit} />
      ) : duplicate ? (
        <DuplicateView
          duplicates={duplicate.duplicates}
          onCancel={() => setDuplicate(null)}
          onForce={() => {
            setDuplicate(null);
            submit(true);
          }}
        />
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col max-h-[90vh]">
          <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <IconFileText size={18} />
              {isEdit ? `แก้ไขใบสั่งงาน #${initial?.id}` : 'สร้างใบสั่งงาน'}
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

          {/* Order type segment */}
          <div className="px-5 pt-4">
            <div className="inline-flex rounded-lg bg-stone-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => switchType('normal')}
                className={`px-4 py-1.5 rounded-md transition-colors ${
                  orderType === 'normal'
                    ? 'bg-white text-stone-900 shadow-sm font-medium'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                งานทั่วไป
              </button>
              <button
                type="button"
                onClick={() => switchType('photobook')}
                className={`px-4 py-1.5 rounded-md transition-colors ${
                  orderType === 'photobook'
                    ? 'bg-white text-stone-900 shadow-sm font-medium'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                Photobook
              </button>
            </div>
          </div>

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
              <Field label="ราคา">
                <input
                  type="text"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 tabular-nums"
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

            {orderType === 'normal' ? (
              <Field label="หมายเหตุ" hint="รายละเอียด ขนาด/กระดาษ/สี ฯลฯ">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 resize-y"
                />
              </Field>
            ) : (
              <PhotobookRepeater
                items={photobookItems}
                onAdd={addPbItem}
                onUpdate={updatePbItem}
                onRemove={removePbItem}
              />
            )}

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-3 flex-shrink-0">
            <p className="text-[11px] text-stone-400">
              {isEdit ? 'แก้ชื่อ/วันที่ → cascade ไป jobs ที่ผูกอยู่' : 'แจ้งเตือนถ้าซ้ำกับใบสั่งที่ยังไม่ปิด'}
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
                {busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'สร้างใบสั่งงาน'}
              </button>
            </div>
          </footer>
        </form>
      )}
    </dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function PhotobookRepeater({
  items,
  onAdd,
  onUpdate,
  onRemove,
}: {
  items: PhotobookItem[];
  onAdd: () => void;
  onUpdate: (i: number, patch: Partial<PhotobookItem>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-stone-700">
          รายการ Photobook ({items.length} เล่ม)
        </label>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-dark"
        >
          <IconPlus size={12} />
          เพิ่มเล่ม
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-4">
          ยังไม่มีเล่ม — กด &quot;เพิ่มเล่ม&quot; เพื่อใส่รายการ
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((it, i) => (
            <div
              key={i}
              className="rounded-xl border border-stone-200 bg-stone-50/40 p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-700">เล่มที่ {i + 1}</span>
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  className="inline-flex items-center gap-0.5 text-xs text-stone-400 hover:text-red-700"
                >
                  <IconX size={11} />
                  ลบ
                </button>
              </div>
              <RadioGroup
                label="ขนาด"
                name={`pb-size-${i}`}
                options={PB_SIZES as readonly string[]}
                value={it.size}
                onChange={(v) => onUpdate(i, { size: v })}
              />
              <RadioGroup
                label="เข้าเล่ม"
                name={`pb-binding-${i}`}
                options={PB_BINDINGS as readonly string[]}
                value={it.binding}
                onChange={(v) => onUpdate(i, { binding: v })}
              />
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="block text-[11px] text-stone-600 mb-1">จำนวนเล่ม</span>
                  <input
                    type="number"
                    min={1}
                    value={it.qty}
                    onChange={(e) => onUpdate(i, { qty: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-sm tabular-nums focus:outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] text-stone-600 mb-1">คำสั่งพิเศษ</span>
                  <input
                    type="text"
                    value={it.special}
                    onChange={(e) => onUpdate(i, { special: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RadioGroup({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: readonly string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="block text-[11px] text-stone-600 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o;
          return (
            <label
              key={o}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                active
                  ? 'bg-accent/10 border-accent text-accent font-medium'
                  : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
              }`}
            >
              <input
                type="radio"
                name={name}
                checked={active}
                onChange={() => onChange(o)}
                className="sr-only"
              />
              {o}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SuccessView({
  success,
  onClose,
  onCreateAnother,
  isEdit,
}: {
  success: SuccessInfo;
  onClose: () => void;
  onCreateAnother: () => void;
  isEdit: boolean;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
          {success.partial ? (
            <IconAlertTriangle size={18} className="text-amber-600" />
          ) : (
            <IconCheck size={18} className="text-emerald-600" />
          )}
          {success.partial
            ? 'ใบสั่งบันทึกบางส่วน'
            : isEdit
              ? 'บันทึกการแก้ไขเรียบร้อย'
              : 'สร้างใบสั่งงานเสร็จ'}
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
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1.5 text-sm">
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
          {success.pin && (
            <div>
              <span className="text-stone-600">PIN ลูกค้าใช้ track:</span>{' '}
              <strong className="tabular-nums text-stone-900">{success.pin}</strong>
            </div>
          )}
          {success.cascaded != null && success.cascaded > 0 && (
            <div className="text-stone-600">
              อัปเดตชื่อ/วันที่ใน Kanban {success.cascaded} job
            </div>
          )}
        </div>
        {success.warning && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 flex items-start gap-2">
            <IconAlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{success.warning}</span>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          {!isEdit && (
            <button
              type="button"
              onClick={onCreateAnother}
              className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
            >
              สร้างใบสั่งใหม่
            </button>
          )}
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
  );
}

function DuplicateView({
  duplicates,
  onCancel,
  onForce,
}: {
  duplicates: Array<{ id: number; name: string; customer: string; dateIn: string }>;
  onCancel: () => void;
  onForce: () => void;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-bold text-amber-700 flex items-center gap-2">
          <IconAlertTriangle size={18} />
          พบใบสั่งงานคล้ายกัน
        </h2>
      </header>
      <div className="p-5 space-y-3">
        <p className="text-sm text-stone-700">
          มีใบสั่งงานชื่อและลูกค้าเดียวกันที่ยังไม่ปิด — ยืนยันว่าจะสร้างใบใหม่อีกใบไหม?
        </p>
        <ul className="rounded-lg border border-amber-200 bg-amber-50/50 divide-y divide-amber-100 text-sm">
          {duplicates.map((d) => (
            <li key={d.id} className="px-3 py-2">
              <div className="font-medium text-stone-900">
                #{d.id} <span className="text-stone-500">— {d.name}</span>
              </div>
              <div className="text-xs text-stone-500 mt-0.5">
                ลูกค้า: {d.customer}
                {d.dateIn && <span className="ml-2 tabular-nums">รับ {d.dateIn}</span>}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={onForce}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700"
          >
            สร้างต่อ
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}
