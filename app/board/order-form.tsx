'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF } from '@/lib/board';
import { bangkokTodayISO, dmyToISOInput } from '@/lib/jobs';
import { broadcastWrite } from '@/lib/auto-sync';
import {
  PB_SIZES, PB_BINDINGS, type PhotobookItem,
  type OrderFormData, emptyOrderForm, orderFormFromRaw, emptyPhotobookItem,
} from '@/lib/photobook';
import {
  IconX, IconCheck, IconAlertTriangle, IconAlertCircle, IconFileText, IconPlus,
} from '@/lib/icons';
import type { OrderSummary } from '@/lib/board';

interface OrderFormProps {
  open: boolean;
  onClose: () => void;
  defaultOrderer: string;
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

type TabKey = 'main' | 'post' | 'assign';

const SIZE_UNITS = ['ซม.', 'นิ้ว', 'มม.'];
const QTY_UNITS = ['แผ่น', 'ชุด', 'เล่ม'];
const PLATE_SIZES = ['ตัด 5', 'ตัด 4', 'ตัด 3'];
const COVER_COLORS = ['1สี', '2สี', '3สี', '4สี'];

export function OrderForm({ open, onClose, defaultOrderer, initial }: OrderFormProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const router = useRouter();
  const isEdit = !!initial;

  const [tab, setTab] = useState<TabKey>('main');
  const [data, setData] = useState<OrderFormData>(() => emptyOrderForm(defaultOrderer));
  const [extraBills, setExtraBills] = useState(false); // expand bills 4-6

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);

  // Initialize on open
  useEffect(() => {
    if (!open) return;
    if (initial) {
      const raw = initial.rawData || {};
      const next = orderFormFromRaw(raw, initial.orderer || defaultOrderer);
      // Override header from canonical OrderSummary fields (rawData might be stale)
      next.name = initial.name || '';
      next.customer = initial.customer || '';
      next.dateIn = dmyToISOInput(initial.dateIn);
      next.dateDue = dmyToISOInput(initial.dateDue);
      next.orderer = initial.orderer || defaultOrderer;
      // Determine assign vs forward from existing
      if (initial.assignDept === 'print') {
        next.assignStaff = '';
        next.forwardPrint = initial.assignStaff || '';
      } else {
        next.assignStaff = initial.assignStaff || '';
        next.forwardPrint = '';
      }
      setData(next);
      setExtraBills(next.billColors.slice(3).some((b) => b !== ''));
    } else {
      setData(emptyOrderForm(defaultOrderer));
      setExtraBills(false);
      setData((d) => ({ ...d, dateIn: bangkokTodayISO() }));
    }
    setTab('main');
    setBusy(false);
    setError(null);
    setSuccess(null);
    setDuplicate(null);
  }, [open, initial, defaultOrderer]);

  // Sync native dialog
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
    function onCancel(e: Event) { e.preventDefault(); onClose(); }
    dlg.addEventListener('click', onClick);
    dlg.addEventListener('cancel', onCancel);
    return () => {
      dlg.removeEventListener('click', onClick);
      dlg.removeEventListener('cancel', onCancel);
    };
  }, [onClose]);

  // Patch helper
  function patch(p: Partial<OrderFormData>) {
    setData((d) => ({ ...d, ...p }));
  }
  function patchBillColor(idx: number, value: string) {
    setData((d) => {
      const next = d.billColors.slice();
      next[idx] = value;
      return { ...d, billColors: next };
    });
  }
  function togglePlateSize(s: string) {
    setData((d) => ({
      ...d,
      plateSize: d.plateSize.includes(s)
        ? d.plateSize.filter((x) => x !== s)
        : [...d.plateSize, s],
    }));
  }
  function setPbItem(i: number, p: Partial<PhotobookItem>) {
    setData((d) => ({
      ...d,
      photobookItems: d.photobookItems.map((it, idx) => (idx === i ? { ...it, ...p } : it)),
    }));
  }
  function addPbItem() {
    setData((d) => ({ ...d, photobookItems: [...d.photobookItems, emptyPhotobookItem()] }));
  }
  function removePbItem(i: number) {
    setData((d) => ({ ...d, photobookItems: d.photobookItems.filter((_, idx) => idx !== i) }));
  }

  // Progress: count of 9 required core fields filled
  const progress = useMemo(() => {
    const checks = [
      !!data.name.trim(), !!data.customer.trim(), !!data.dateDue,
      !!data.orderer.trim(), !!(data.assignStaff || data.forwardPrint),
      !!data.size.trim(), !!data.qty.trim(),
      !!data.paperCover.trim() || !!data.paperInner.trim(),
      data.plateOld || data.plateNew || data.copyprint || data.inkjet || data.digital,
    ];
    return { filled: checks.filter(Boolean).length, total: checks.length };
  }, [data]);

  async function submit(force = false, mode: 'submit' | 'draft' | 'print' = 'submit') {
    setError(null);
    setBusy(true);
    const body: Record<string, unknown> = { ...data };
    if (force) body.force = true;
    if (isEdit && initial) body.id = initial.id;
    if (mode === 'draft') (body as { status?: string }).status = 'draft';

    const path = isEdit ? '/api/orders/update' : '/api/orders/add';
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const respJson = await res.json().catch(() => ({}));
      setBusy(false);
      if (res.status === 409 && respJson?.error === 'duplicate') {
        setDuplicate({ duplicates: respJson.duplicates || [] });
        return;
      }
      if (!res.ok) {
        setError(respJson?.error || `HTTP ${res.status}`);
        return;
      }
      broadcastWrite(path);
      router.refresh();
      setSuccess({
        orderId: Number(respJson.orderId || initial?.id || 0),
        jobId: respJson.jobId == null ? null : Number(respJson.jobId),
        pin: String(respJson.pin || ''),
        partial: !!respJson.partial,
        warning: respJson.warning,
        isEdit,
        cascaded: respJson.cascaded,
      });
      if (mode === 'print') {
        // TODO: open print template after save (Phase 3.5.10)
      }
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    }
  }

  function reset() {
    if (!confirm('ล้างข้อมูลทั้งหมดในฟอร์ม?')) return;
    setData(emptyOrderForm(defaultOrderer));
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-4xl w-[96vw]"
    >
      {success ? (
        <SuccessView success={success} onClose={onClose} onCreateAnother={() => setSuccess(null)} isEdit={isEdit} />
      ) : duplicate ? (
        <DuplicateView duplicates={duplicate.duplicates} onCancel={() => setDuplicate(null)} onForce={() => { setDuplicate(null); submit(true); }} />
      ) : (
        <div className="flex flex-col max-h-[92vh]">
          {/* Header */}
          <header className="px-5 py-3 border-b border-stone-100 flex items-center justify-between flex-shrink-0">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <IconFileText size={18} />
              {isEdit ? `แก้ไขใบสั่งงาน #${initial?.id}` : 'สั่งงาน (รับใบสั่งงาน)'}
            </h2>
            <button type="button" onClick={onClose} aria-label="ปิด"
              className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100">
              <IconX size={20} />
            </button>
          </header>

          {/* Order type segment */}
          <div className="px-5 pt-4 flex-shrink-0">
            <div className="inline-flex rounded-lg bg-stone-100 p-1 text-sm">
              <button type="button" onClick={() => patch({ orderType: 'normal' })}
                className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md transition-colors ${
                  data.orderType === 'normal' ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                }`}>
                <IconFileText size={13} />
                งานทั่วไป
              </button>
              <button type="button" onClick={() => {
                  patch({ orderType: 'photobook' });
                  if (data.photobookItems.length === 0) addPbItem();
                }}
                className={`px-4 py-1.5 rounded-md transition-colors ${
                  data.orderType === 'photobook' ? 'bg-white text-stone-900 shadow-sm font-medium' : 'text-stone-500 hover:text-stone-700'
                }`}>
                Photobook
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-5 pt-3 flex-shrink-0">
            <div className="flex items-center gap-3 text-xs text-stone-600">
              <span>ความคืบหน้า</span>
              <div className="flex-grow h-1.5 bg-stone-100 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 transition-all"
                  style={{ width: `${(progress.filled / progress.total) * 100}%` }} />
              </div>
              <span className="tabular-nums font-semibold">{progress.filled}/{progress.total}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="border-b border-stone-100 flex-shrink-0 mt-3">
            <div className="flex px-5 gap-4 overflow-x-auto">
              <TabBtn active={tab === 'main'} onClick={() => setTab('main')} label="ข้อมูลหลัก" />
              {data.orderType === 'normal' && (
                <TabBtn active={tab === 'post'} onClick={() => setTab('post')} label="งานหลังพิมพ์" />
              )}
              <TabBtn active={tab === 'assign'} onClick={() => setTab('assign')} label="มอบหมาย + หมายเหตุ" />
            </div>
          </div>

          {/* Body */}
          <div className="flex-grow overflow-y-auto px-5 py-4 space-y-5">
            {tab === 'main' && (
              <MainTab
                data={data}
                patch={patch}
                togglePlateSize={togglePlateSize}
                onAddPbItem={addPbItem}
                onUpdatePbItem={setPbItem}
                onRemovePbItem={removePbItem}
              />
            )}
            {tab === 'post' && data.orderType === 'normal' && (
              <PostPressTab
                data={data}
                patch={patch}
                patchBillColor={patchBillColor}
                extraBills={extraBills}
                setExtraBills={setExtraBills}
              />
            )}
            {tab === 'assign' && (
              <AssignTab data={data} patch={patch} />
            )}

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                <IconAlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <footer className="px-5 py-3 border-t border-stone-200 bg-stone-50/60 flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
            <p className="text-[11px] text-stone-400">
              {isEdit ? 'แก้ชื่อ/วันที่ → cascade ไป jobs ที่ผูกอยู่' : 'แจ้งเตือนถ้าซ้ำกับใบสั่งที่ยังไม่ปิด'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={reset} disabled={busy}
                className="px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 disabled:opacity-50">
                รีเซ็ต
              </button>
              <button type="button" onClick={() => submit(false, 'submit')} disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark disabled:opacity-50">
                <IconCheck size={14} />
                {busy ? 'กำลังบันทึก...' : isEdit ? 'บันทึกการแก้ไข' : 'ส่งใบสั่งงาน'}
              </button>
            </div>
          </footer>
        </div>
      )}
    </dialog>
  );
}

// ─── Tab 1: ข้อมูลหลัก ─────────────────────────────────────

function MainTab({
  data, patch, togglePlateSize, onAddPbItem, onUpdatePbItem, onRemovePbItem,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
  togglePlateSize: (s: string) => void;
  onAddPbItem: () => void;
  onUpdatePbItem: (i: number, p: Partial<PhotobookItem>) => void;
  onRemovePbItem: (i: number) => void;
}) {
  const isPB = data.orderType === 'photobook';
  return (
    <>
      <Section title="ข้อมูลลูกค้า">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="ชื่องาน / ชื่อผลิตภัณฑ์ *">
            <input type="text" required value={data.name} onChange={(e) => patch({ name: e.target.value })}
              className={inputCls} maxLength={200} />
          </Field>
          <Field label="ชื่อลูกค้า *">
            <input type="text" required value={data.customer} onChange={(e) => patch({ customer: e.target.value })}
              className={inputCls} maxLength={200} />
          </Field>
          <Field label="วันที่รับสั่งงาน">
            <input type="date" value={data.dateIn} onChange={(e) => patch({ dateIn: e.target.value })}
              className={`${inputCls} tabular-nums`} />
          </Field>
          <Field label="วันกำหนดส่ง *">
            <input type="date" required value={data.dateDue} onChange={(e) => patch({ dateDue: e.target.value })}
              className={`${inputCls} tabular-nums`} />
          </Field>
        </div>
      </Section>

      {!isPB && (
        <>
          <Section title="รายละเอียดงาน">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="ขนาด">
                <div className="flex gap-2">
                  <input type="text" value={data.size} onChange={(e) => patch({ size: e.target.value })}
                    className={`${inputCls} flex-grow`} placeholder="เช่น A4 หรือ 21x29.7" />
                  <select value={data.sizeUnit} onChange={(e) => patch({ sizeUnit: e.target.value })}
                    className={`${inputCls} w-20`}>
                    {SIZE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="จำนวน">
                <div className="flex gap-2">
                  <input type="text" value={data.qty} onChange={(e) => patch({ qty: e.target.value })}
                    className={`${inputCls} flex-grow tabular-nums`} />
                  <select value={data.qtyUnit} onChange={(e) => patch({ qtyUnit: e.target.value })}
                    className={`${inputCls} w-20`}>
                    {QTY_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="กระดาษปก">
                <input type="text" value={data.paperCover} onChange={(e) => patch({ paperCover: e.target.value })}
                  className={inputCls} />
              </Field>
              <RadioRowField
                label="สีปก" name="coverColor" options={COVER_COLORS}
                value={data.coverColor} onChange={(v) => patch({ coverColor: v })}
              />
              <Field label="หมายเหตุสีปก">
                <input type="text" value={data.coverColorNote} onChange={(e) => patch({ coverColorNote: e.target.value })}
                  className={inputCls} />
              </Field>
              <Field label="กระดาษเนื้อใน">
                <input type="text" value={data.paperInner} onChange={(e) => patch({ paperInner: e.target.value })}
                  className={inputCls} />
              </Field>
              <RadioRowField
                label="สีเนื้อใน" name="innerColor" options={COVER_COLORS}
                value={data.innerColor} onChange={(v) => patch({ innerColor: v })}
              />
              <Field label="หมายเหตุสีเนื้อใน">
                <input type="text" value={data.innerColorNote} onChange={(e) => patch({ innerColorNote: e.target.value })}
                  className={inputCls} />
              </Field>
            </div>
          </Section>

          <Section title="PLATE / การพิมพ์">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">ประเภท PLATE</span>
                <div className="flex flex-wrap gap-3">
                  <CB checked={data.plateOld} onChange={(c) => patch({ plateOld: c })} label="เก่า" />
                  <CB checked={data.plateNew} onChange={(c) => patch({ plateNew: c })} label="ใหม่" />
                  <CB checked={data.copyprint} onChange={(c) => patch({ copyprint: c })} label="Copyprint" />
                  <CB checked={data.inkjet} onChange={(c) => patch({ inkjet: c })} label="Inkjet" />
                  <CB checked={data.digital} onChange={(c) => patch({ digital: c })} label="Print Digital" />
                </div>
              </div>
              <div>
                <span className="block text-xs font-medium text-stone-600 mb-1.5">ขนาด PLATE</span>
                <div className="flex flex-wrap gap-3">
                  {PLATE_SIZES.map((s) => (
                    <CB key={s} checked={data.plateSize.includes(s)} onChange={() => togglePlateSize(s)} label={s} />
                  ))}
                </div>
              </div>
            </div>
          </Section>
        </>
      )}

      {isPB && (
        <Section title="รายการ Photobook">
          <PhotobookEditor
            items={data.photobookItems}
            onAdd={onAddPbItem}
            onUpdate={onUpdatePbItem}
            onRemove={onRemovePbItem}
          />
        </Section>
      )}
    </>
  );
}

// ─── Tab 2: งานหลังพิมพ์ ──────────────────────────────────

function PostPressTab({
  data, patch, patchBillColor, extraBills, setExtraBills,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
  patchBillColor: (i: number, v: string) => void;
  extraBills: boolean;
  setExtraBills: (b: boolean) => void;
}) {
  return (
    <>
      <Section title="งานบิล">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="บิลต่อชุด"><input type="text" value={data.billPerSet} onChange={(e) => patch({ billPerSet: e.target.value })} className={inputCls} /></Field>
          <Field label="ชุดต่อเล่ม"><input type="text" value={data.setPerBook} onChange={(e) => patch({ setPerBook: e.target.value })} className={inputCls} /></Field>
          <Field label="แผ่นต่อเล่ม"><input type="text" value={data.sheetPerBook} onChange={(e) => patch({ sheetPerBook: e.target.value })} className={inputCls} /></Field>
        </div>
        <div className="mt-3">
          <span className="block text-xs font-medium text-stone-600 mb-1.5">สีบิล</span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Field key={i} label={`บิล ${i + 1}`}>
                <input type="text" value={data.billColors[i] || ''} onChange={(e) => patchBillColor(i, e.target.value)}
                  className={inputCls} />
              </Field>
            ))}
          </div>
          {!extraBills ? (
            <button type="button" onClick={() => setExtraBills(true)}
              className="text-xs text-accent hover:text-accent-dark font-medium mt-2 inline-flex items-center gap-1">
              <IconPlus size={11} />
              เพิ่มสีบิล (บิล 4-6)
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              {[3, 4, 5].map((i) => (
                <Field key={i} label={`บิล ${i + 1}`}>
                  <input type="text" value={data.billColors[i] || ''} onChange={(e) => patchBillColor(i, e.target.value)}
                    className={inputCls} />
                </Field>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <div>
            <CB checked={data.perf} onChange={(c) => patch({ perf: c })} label="ปรุ" />
            {data.perf && (
              <Field label="ตำแหน่งปรุ" className="mt-2">
                <input type="text" value={data.perfPos} onChange={(e) => patch({ perfPos: e.target.value })} className={inputCls} />
              </Field>
            )}
          </div>
          <div>
            <CB checked={data.runNo} onChange={(c) => patch({ runNo: c })} label="หมายเลขรัน" />
            {data.runNo && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Field label="รันเล่มที่"><input type="text" value={data.runBook} onChange={(e) => patch({ runBook: e.target.value })} className={inputCls} /></Field>
                <Field label="รันเลขที่"><input type="text" value={data.runNum} onChange={(e) => patch({ runNum: e.target.value })} className={inputCls} /></Field>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="เข้าเล่ม (Binding)">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <CB checked={data.glue} onChange={(c) => patch({ glue: c })} label="ไสกาว" />
          <CB checked={data.saddle} onChange={(c) => patch({ saddle: c })} label="มุงหลังคา" />
          <CB checked={data.sew} onChange={(c) => patch({ sew: c })} label="เย็บที่" />
          <CB checked={data.spine} onChange={(c) => patch({ spine: c })} label="กระดูกงู" />
          <CB checked={data.glueHead} onChange={(c) => patch({ glueHead: c })} label="กาวหัว" />
          <CB checked={data.glueSide} onChange={(c) => patch({ glueSide: c })} label="กาวข้าง" />
          <CB checked={data.sewHead} onChange={(c) => patch({ sewHead: c })} label="เย็บหัว" />
          <CB checked={data.sewSide} onChange={(c) => patch({ sewSide: c })} label="เย็บข้าง" />
          <CB checked={data.sewCorner} onChange={(c) => patch({ sewCorner: c })} label="เย็บมุม" />
          <CB checked={data.sewThread} onChange={(c) => patch({ sewThread: c })} label="เย็บด้าย" />
          <CB checked={data.sewSideTape} onChange={(c) => patch({ sewSideTape: c })} label="ติดเทปสัน" />
        </div>
      </Section>

      <Section title="เคลือบ / ปั๊ม (Coating & Stamping)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <span className="block text-xs font-medium text-stone-600 mb-1.5">เคลือบ</span>
            <div className="flex flex-wrap gap-3">
              <CB checked={data.coatGloss} onChange={(c) => patch({ coatGloss: c })} label="เงา" />
              <CB checked={data.coatMatte} onChange={(c) => patch({ coatMatte: c })} label="ด้าน" />
              <CB checked={data.coatUV} onChange={(c) => patch({ coatUV: c })} label="UV" />
              <CB checked={data.coatSpotUV} onChange={(c) => patch({ coatSpotUV: c })} label="SPOT UV" />
            </div>
          </div>
          <div>
            <span className="block text-xs font-medium text-stone-600 mb-1.5">ปั๊ม</span>
            <div className="flex flex-wrap gap-3">
              <CB checked={data.stampColor} onChange={(c) => patch({ stampColor: c })} label="ปั๊มสี" />
              <CB checked={data.emboss} onChange={(c) => patch({ emboss: c })} label="นูน" />
              <CB checked={data.diecut} onChange={(c) => patch({ diecut: c })} label="ส่งไดคัท" />
              <CB checked={data.diecutSelf} onChange={(c) => patch({ diecutSelf: c })} label="ไดคัทเอง" />
            </div>
          </div>
          <Field label="สีปั๊ม">
            <input type="text" value={data.stampColorNote} onChange={(e) => patch({ stampColorNote: e.target.value })}
              className={inputCls} disabled={!data.stampColor} />
          </Field>
        </div>
      </Section>
    </>
  );
}

// ─── Tab 3: มอบหมาย + หมายเหตุ ─────────────────────────────

function AssignTab({
  data, patch,
}: {
  data: OrderFormData;
  patch: (p: Partial<OrderFormData>) => void;
}) {
  return (
    <>
      <Section title="มอบหมายงาน">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="ผู้สั่งงาน *">
            <input type="text" value={data.orderer} onChange={(e) => patch({ orderer: e.target.value })}
              className={inputCls} required maxLength={100} />
          </Field>
          <Field label="มอบหมายกราฟฟิก">
            <select value={data.assignStaff}
              onChange={(e) => patch({ assignStaff: e.target.value, forwardPrint: '' })}
              className={inputCls}>
              <option value="">-- ไม่ระบุ --</option>
              {STAFF.graphic.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="ส่งต่อพิมพ์">
            <select value={data.forwardPrint}
              onChange={(e) => patch({ forwardPrint: e.target.value, assignStaff: '' })}
              className={inputCls}>
              <option value="">-- ไม่ระบุ --</option>
              {STAFF.print.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-[11px] text-stone-500 mt-2">
          * เลือกอย่างน้อย 1: มอบหมายกราฟฟิก หรือ ส่งต่อพิมพ์
        </p>
      </Section>

      <Section title="หมายเหตุเพิ่มเติม">
        <textarea value={data.notes} onChange={(e) => patch({ notes: e.target.value })} rows={5}
          className={`${inputCls} resize-y`} placeholder="รายละเอียดเพิ่มเติมที่อยากบอกฝ่ายผลิต..." />
      </Section>
    </>
  );
}

// ─── Photobook editor ─────────────────────────────────────

function PhotobookEditor({
  items, onAdd, onUpdate, onRemove,
}: {
  items: PhotobookItem[];
  onAdd: () => void;
  onUpdate: (i: number, p: Partial<PhotobookItem>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-stone-600">{items.length} เล่ม</span>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-dark">
          <IconPlus size={11} />
          เพิ่มเล่ม
        </button>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-stone-400 text-center py-4">
          ยังไม่มีเล่ม — กด &quot;เพิ่มเล่ม&quot; เพื่อใส่รายการ
        </p>
      ) : (
        items.map((it, i) => (
          <div key={i} className="rounded-xl border border-stone-200 bg-stone-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-stone-700">เล่มที่ {i + 1}</span>
              <button type="button" onClick={() => onRemove(i)}
                className="inline-flex items-center gap-0.5 text-xs text-stone-400 hover:text-red-700">
                <IconX size={11} />
                ลบ
              </button>
            </div>
            <RadioRowField label="ขนาด" name={`pb-size-${i}`} options={[...PB_SIZES]}
              value={it.size} onChange={(v) => onUpdate(i, { size: v })} />
            <RadioRowField label="เข้าเล่ม" name={`pb-bind-${i}`} options={[...PB_BINDINGS]}
              value={it.binding} onChange={(v) => onUpdate(i, { binding: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="จำนวนเล่ม">
                <input type="number" min={1} value={it.qty} onChange={(e) => onUpdate(i, { qty: e.target.value })}
                  className={`${inputCls} tabular-nums`} />
              </Field>
              <Field label="คำสั่งพิเศษ">
                <input type="text" value={it.special} onChange={(e) => onUpdate(i, { special: e.target.value })}
                  className={inputCls} />
              </Field>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Helpers (UI atoms) ───────────────────────────────────

const inputCls =
  'w-full px-3 py-2 border border-stone-200 rounded-lg text-sm bg-white focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50 disabled:bg-stone-50';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      <div className="rounded-xl border border-stone-100 bg-white p-3">{children}</div>
    </section>
  );
}

function Field({
  label, hint, children, className = '',
}: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-400 mt-1">{hint}</span>}
    </label>
  );
}

function CB({ checked, onChange, label }: { checked: boolean; onChange: (c: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-sm cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
      <span>{label}</span>
    </label>
  );
}

function RadioRowField({
  label, name, options, value, onChange,
}: {
  label: string; name: string; options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="block text-xs font-medium text-stone-600 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o;
          return (
            <label key={o}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs cursor-pointer border transition-colors ${
                active ? 'bg-accent/10 border-accent text-accent font-medium' : 'bg-white border-stone-200 text-stone-700 hover:border-stone-300'
              }`}>
              <input type="radio" name={name} checked={active} onChange={() => onChange(o)} className="sr-only" />
              {o}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick}
      className={`py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'text-sky-700 border-sky-500' : 'text-stone-500 border-transparent hover:text-stone-700'
      }`}>
      {label}
    </button>
  );
}

function SuccessView({
  success, onClose, onCreateAnother, isEdit,
}: {
  success: SuccessInfo; onClose: () => void; onCreateAnother: () => void; isEdit: boolean;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center justify-between flex-shrink-0">
        <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
          {success.partial
            ? <IconAlertTriangle size={18} className="text-amber-600" />
            : <IconCheck size={18} className="text-emerald-600" />
          }
          {success.partial ? 'ใบสั่งบันทึกบางส่วน' : isEdit ? 'บันทึกการแก้ไขเรียบร้อย' : 'สร้างใบสั่งงานเสร็จ'}
        </h2>
        <button type="button" onClick={onClose} aria-label="ปิด"
          className="text-stone-400 hover:text-stone-700 w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100">
          <IconX size={20} />
        </button>
      </header>
      <div className="p-5 space-y-3">
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1.5 text-sm">
          <div><span className="text-stone-600">เลขใบสั่ง:</span>{' '}
            <strong className="tabular-nums text-stone-900">#{success.orderId}</strong></div>
          {success.jobId != null && (
            <div><span className="text-stone-600">Job ID:</span>{' '}
              <strong className="tabular-nums text-stone-900">#{success.jobId}</strong></div>
          )}
          {success.pin && (
            <div><span className="text-stone-600">PIN:</span>{' '}
              <strong className="tabular-nums text-stone-900">{success.pin}</strong></div>
          )}
          {success.cascaded != null && success.cascaded > 0 && (
            <div className="text-stone-600">อัปเดตชื่อ/วันที่ใน Kanban {success.cascaded} job</div>
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
            <button type="button" onClick={onCreateAnother}
              className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200">
              สร้างใบสั่งใหม่
            </button>
          )}
          <button type="button" onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark">
            เสร็จสิ้น
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateView({
  duplicates, onCancel, onForce,
}: {
  duplicates: Array<{ id: number; name: string; customer: string; dateIn: string }>;
  onCancel: () => void; onForce: () => void;
}) {
  return (
    <div className="flex flex-col max-h-[90vh]">
      <header className="px-5 py-3 border-b border-stone-200 flex items-center gap-2">
        <IconAlertTriangle size={18} className="text-amber-700" />
        <h2 className="text-base font-bold text-amber-700">พบใบสั่งงานคล้ายกัน</h2>
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
          <button type="button" onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200">
            ยกเลิก
          </button>
          <button type="button" onClick={onForce}
            className="flex-1 px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium hover:bg-amber-700">
            สร้างต่อ
          </button>
        </div>
      </div>
    </div>
  );
}
