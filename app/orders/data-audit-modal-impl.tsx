'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { broadcastWrite } from '@/lib/auto-sync';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import { STAFF, DEPT_LABELS, type Dept } from '@/lib/board';
import { IconAlertCircle, IconAlertTriangle, IconCheck, IconPlus, IconTrash, IconX } from '@/lib/icons';
import type { OrphanOrder, DuplicateGroup, DuplicateRow } from './data-audit-modal';

/**
 * Heavy modal implementation — split into a separate chunk so the
 * /orders page-load bundle doesn't pay for it. Lazy-loaded by
 * `data-audit-modal.tsx` via `next/dynamic` when admin clicks the
 * "ตรวจสอบข้อมูล" button.
 */
export function DataAuditModalImpl({
  orphans,
  duplicates,
  isAdmin,
  onClose,
}: {
  orphans: OrphanOrder[];
  duplicates: DuplicateGroup[];
  isAdmin: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [recoverFor, setRecoverFor] = useState<OrphanOrder | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

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

  return (
    <dialog
      ref={dialogRef}
      className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[92vw]"
    >
      <div className="flex flex-col max-h-[85vh]">
        <div className="px-5 py-3 border-b border-stone-100 flex items-center justify-between gap-3 sticky top-0 bg-white">
          <div>
            <h2 className="text-base font-bold text-stone-900">ตรวจสอบข้อมูล</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              พบ orphan orders {orphans.length} รายการ · duplicate jobs {duplicates.length} กลุ่ม
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 w-7 h-7 flex items-center justify-center rounded hover:bg-stone-100"
            aria-label="ปิด"
          >
            <IconX size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-6 overflow-y-auto">
          {/* Orphans */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <IconAlertCircle size={14} className="text-red-600" />
              <h3 className="text-sm font-semibold text-red-700">
                Orphan orders ({orphans.length})
              </h3>
            </div>
            <p className="text-xs text-stone-500 mb-2">
              order status=&quot;สั่งแล้ว&quot; แต่ไม่มี job / shipped / cancelled — ใส่ row ใน jobs sheet
            </p>
            {orphans.length === 0 ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm text-emerald-700 inline-flex items-center gap-2">
                <IconCheck size={14} /> ไม่พบ orphan order
              </div>
            ) : (
              <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
                {orphans.map((o) => (
                  <div key={o.id} className="px-3 py-2.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-stone-900 truncate">
                        #{o.id} · {o.name || '-'}
                      </div>
                      <div className="text-xs text-stone-500 truncate">
                        {o.customer || '-'} · กำหนดส่ง {o.dateDue || '-'}
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setRecoverFor(o)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-dark flex-shrink-0"
                      >
                        <IconPlus size={12} />
                        สร้าง Job
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Duplicates */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <IconAlertTriangle size={14} className="text-amber-600" />
              <h3 className="text-sm font-semibold text-amber-700">
                Duplicate jobs ({duplicates.length} กลุ่ม)
              </h3>
            </div>
            <p className="text-xs text-stone-500 mb-2">
              orderId+name ซ้ำในตาราง jobs — ลบ row เก่า เก็บ row ใหม่ที่สุด
            </p>
            {duplicates.length === 0 ? (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm text-emerald-700 inline-flex items-center gap-2">
                <IconCheck size={14} /> ไม่พบ duplicate
              </div>
            ) : (
              <div className="border border-stone-200 rounded-lg divide-y divide-stone-100">
                {duplicates.map((g) => {
                  const newest = g.rows[0];
                  const olds = g.rows.slice(1);
                  return (
                    <div key={`${g.orderId}|${g.name}`} className="px-3 py-2.5">
                      <div className="text-sm font-semibold text-stone-900">
                        #{g.orderId} · {g.name || '-'}
                      </div>
                      <div className="text-xs text-stone-500 mt-0.5 mb-2">
                        มี {g.rows.length} rows · ใหม่สุด id={newest.id} ({DEPT_LABELS[newest.dept as Dept] || newest.dept}/{newest.staff})
                      </div>
                      {olds.map((j) => (
                        <DupRowItem
                          key={j.id}
                          job={j}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 text-sm hover:bg-stone-50"
          >
            ปิด
          </button>
        </div>
      </div>
      {recoverFor && (
        <RecoverOrphanDialog
          order={recoverFor}
          onClose={() => setRecoverFor(null)}
        />
      )}
    </dialog>
  );
}

/** Single dup-row line with delete button (per-row state). */
function DupRowItem({ job, isAdmin }: { job: DuplicateRow; isAdmin: boolean }) {
  const router = useRouter();
  const confirmDlg = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function remove() {
    const ok = await confirmDlg.confirm({
      title: `ลบ row id=${job.id}?`,
      message: `${DEPT_LABELS[job.dept as Dept] || job.dept} / ${job.staff}\nการลบจะส่งไป Apps Script ทันที — ไม่สามารถ undo`,
      okLabel: 'ลบ',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch('/api/jobs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: job.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || `ลบไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/delete');
      toast.success(`ลบ duplicate row id=${job.id}`);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 py-1.5 border-t border-dashed border-stone-200 first:border-t-0 first:pt-0">
      <div className="flex-1 text-xs text-stone-600">
        id={job.id} · {DEPT_LABELS[job.dept as Dept] || job.dept}/{job.staff}
      </div>
      {isAdmin && (
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          <IconTrash size={11} />
          ลบ row นี้
        </button>
      )}
    </div>
  );
}

/** Sub-dialog for orphan recovery — pick dept/staff, call /api/jobs/add. */
function RecoverOrphanDialog({
  order,
  onClose,
}: {
  order: OrphanOrder;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  // Preselect from order.assignDept/assignStaff if present
  const initial = order.assignDept && order.assignStaff
    ? `${order.assignDept}|${order.assignStaff}`
    : '';
  const [selected, setSelected] = useState(initial);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
    };
  }, []);

  // Build dept/staff options — graphic + print + post (matches WP recoverOrphanOrder)
  const depts: Dept[] = ['graphic', 'print', 'post'];
  const options: Array<{ value: string; label: string }> = [];
  for (const d of depts) {
    const list = STAFF[d] || [];
    for (const s of list) {
      options.push({ value: `${d}|${s.id}`, label: `${DEPT_LABELS[d] || d} / ${s.name}` });
    }
  }

  async function submit() {
    if (!selected) {
      toast.error('กรุณาเลือกขั้นตอนเริ่มต้น');
      return;
    }
    const [dept, staff] = selected.split('|');
    setBusy(true);
    onClose();
    toast.show(`กำลังสร้าง job สำหรับ #${order.id}...`);
    try {
      const res = await fetch('/api/jobs/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: order.name,
          // Server-side toISODate handles DD/MM/YYYY → ISO
          date: order.dateDue || '',
          dateIn: order.dateIn || '',
          dept,
          staff,
          orderId: order.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || `สร้าง job ไม่สำเร็จ — HTTP ${res.status}`);
        return;
      }
      broadcastWrite('/api/jobs/add');
      toast.success(`สร้าง job สำหรับ #${order.id} เรียบร้อย`);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="rounded-xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-md w-[92vw]"
    >
      <div className="flex flex-col">
        <div className="px-5 py-3 border-b border-stone-100">
          <h3 className="text-base font-bold text-stone-900">
            สร้าง Job สำหรับ #{order.id}
          </h3>
          <p className="text-xs text-stone-500 mt-0.5 truncate">
            {order.name} · ลูกค้า {order.customer || '-'}
          </p>
        </div>
        <div className="px-5 py-4">
          <label className="block text-sm font-medium text-stone-700 mb-2">
            เลือกขั้นตอนเริ่มต้น
          </label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={busy}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm disabled:opacity-50"
          >
            <option value="">— เลือกขั้นตอน —</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="px-5 py-3 border-t border-stone-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-700 text-sm hover:bg-stone-50 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !selected}
            className="px-4 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-dark disabled:opacity-50"
          >
            {busy ? 'กำลังสร้าง...' : 'สร้าง'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
