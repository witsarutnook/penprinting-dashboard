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
} from '@/lib/board';
import { JobForm } from './job-form';

const VENDOR_PURPLE = '#7c3aed';

/** Card with built-in detail modal (native <dialog>). */
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
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const urgencyColor = URGENCY_COLORS[job.urgency];

  function open() {
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }
  function startEdit() {
    dialogRef.current?.close();
    setEditOpen(true);
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

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="w-full text-left rounded-md border bg-white p-2 hover:shadow-sm transition-shadow"
        style={{
          borderColor: isVendorCol ? `${VENDOR_PURPLE}30` : '#e7e5e4',
          borderLeft: `3px solid ${urgencyColor}`,
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="text-[13px] font-medium text-stone-900 leading-snug flex-grow break-words">
            {job.name || <span className="text-stone-400">(ไม่มีชื่อ)</span>}
          </div>
          {job.hasCowork && (
            <span
              className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 whitespace-nowrap"
              title="มี co-work"
            >
              +CW
            </span>
          )}
        </div>
        {job.customer && (
          <div className="text-[11px] text-stone-500 mt-1 truncate" title={job.customer}>
            👤 {job.customer}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px]">
          <span
            className="px-1.5 py-0.5 rounded font-medium tabular-nums"
            style={{ background: urgencyColor + '20', color: urgencyColor }}
          >
            {URGENCY_LABELS[job.urgency]}
            {job.daysUntilDue !== null && job.urgency === 'overdue' && (
              <span className="ml-1">({job.daysUntilDue}d)</span>
            )}
            {job.daysUntilDue !== null && job.urgency === 'urgent' && (
              <span className="ml-1">(D-{job.daysUntilDue})</span>
            )}
          </span>
          <span className="text-stone-400 tabular-nums">{job.dateRaw}</span>
        </div>
        {job.orderId && (
          <div className="text-[10px] text-stone-400 mt-1 tabular-nums">
            #{job.id} · order {job.orderId}
          </div>
        )}
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-2xl p-0 m-auto bg-white shadow-2xl backdrop:bg-black/40 max-w-2xl w-[92vw]"
      >
        <DetailContent
          job={job}
          onClose={close}
          onEdit={startEdit}
          sessionRole={sessionRole}
        />
      </dialog>
      <JobForm initial={job} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}

// ─── Modal content ────────────────────────────────────────

function DetailContent({
  job,
  onClose,
  onEdit,
  sessionRole,
}: {
  job: BoardJob;
  onClose: () => void;
  onEdit: () => void;
  sessionRole: string | null;
}) {
  const urgencyColor = URGENCY_COLORS[job.urgency];
  const dept = job.dept as Dept;
  const deptLabel = DEPT_LABELS[dept] || job.dept;
  const staffDef = STAFF[dept]?.find((s) => s.id === job.staff);
  const staffName = staffDef?.name || job.staff;
  const cowork = parseCoworkArray(job.cowork);

  return (
    <div className="max-h-[90vh] overflow-y-auto">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-10 px-5 py-3 border-b border-stone-200 bg-white flex items-start justify-between gap-3"
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
              {deptLabel} · <span className="font-medium">{staffName}</span>
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
          className="text-stone-400 hover:text-stone-700 text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-stone-100 -mr-2 -mt-1"
          aria-label="ปิด"
        >
          ×
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-5">
        <Section title="ข้อมูลงาน">
          <KV label="วันรับงาน" value={job.dateInRaw} />
          <KV label="กำหนดเสร็จ" value={job.dateRaw} />
          <KV
            label="วันคงเหลือ"
            value={
              job.daysUntilDue === null
                ? '—'
                : job.daysUntilDue === 0
                  ? 'วันนี้'
                  : job.daysUntilDue < 0
                    ? `เกิน ${Math.abs(job.daysUntilDue)} วัน`
                    : `${job.daysUntilDue} วัน`
            }
          />
          {job.status && <KV label="สถานะ" value={job.status} />}
        </Section>

        {job.order && (
          <Section title="ข้อมูลใบสั่งงาน">
            <KV label="ลูกค้า" value={job.order.customer} />
            <KV label="วันรับ" value={job.order.dateIn} />
            <KV label="กำหนดส่ง" value={job.order.dateDue} />
            {job.order.price !== '' && job.order.price != null && (
              <KV label="ราคา" value={String(job.order.price)} />
            )}
            {job.order.orderer && <KV label="ผู้สั่งงาน" value={job.order.orderer} />}
            {job.order.status && <KV label="สถานะใบสั่ง" value={job.order.status} />}
          </Section>
        )}

        {job.order?.details && Object.keys(job.order.details).length > 0 && (
          <Section title="รายละเอียดงาน">
            <DetailsTable details={job.order.details} />
          </Section>
        )}

        {cowork.length > 0 && (
          <Section title="Co-work">
            <ul className="text-sm text-stone-700 space-y-1">
              {cowork.map((cw, i) => (
                <li key={i}>
                  • <span className="text-stone-500">{cw.dept}</span> /{' '}
                  <span className="font-medium">{cw.staff}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <ActionButtons job={job} sessionRole={sessionRole} onEdit={onEdit} onSuccess={onClose} />

        <div className="rounded-lg bg-stone-50 border border-stone-200 px-3 py-2 text-xs text-stone-600">
          ℹ️ ฟีเจอร์ที่ยังไม่มี (ส่งต่อ • co-work) ใช้ใน{' '}
          <a
            href="https://app.penprinting.co/production-monitoring/"
            className="underline hover:text-stone-800"
          >
            ระบบเดิม (WP)
          </a>
        </div>
      </div>
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
  const [busy, setBusy] = useState<null | 'ship' | 'delete' | 'cancel'>(null);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = sessionRole === 'admin';

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

  return (
    <section>
      <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
        การดำเนินการ
      </h3>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={moveToShipped}
          disabled={busy !== null}
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'ship' ? 'กำลังส่ง...' : '✅ จัดส่งเสร็จ'}
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={onEdit}
            disabled={busy !== null}
            className="px-3 py-2 rounded-lg bg-stone-100 text-stone-800 text-sm font-medium hover:bg-stone-200 disabled:opacity-50"
          >
            ✏️ แก้ไข
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={cancelJob}
            disabled={busy !== null}
            className="px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm font-medium hover:bg-amber-200 disabled:opacity-50"
          >
            {busy === 'cancel' ? 'กำลังยกเลิก...' : '⚠️ ยกเลิก (admin)'}
          </button>
        )}
        <button
          type="button"
          onClick={deleteJob}
          disabled={busy !== null}
          className="px-3 py-2 rounded-lg bg-red-100 text-red-800 text-sm font-medium hover:bg-red-200 disabled:opacity-50"
        >
          {busy === 'delete' ? 'กำลังลบ...' : '🗑 ลบงาน'}
        </button>
      </div>
      {error && (
        <div className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          ❌ {error}
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

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 px-3 py-2 text-sm">
      <span className="text-stone-500 min-w-[100px] shrink-0">{label}</span>
      <span className="text-stone-900 break-words">{value || '—'}</span>
    </div>
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

function parseCoworkArray(cowork: unknown): CoworkEntry[] {
  if (!Array.isArray(cowork)) return [];
  return cowork
    .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
    .map((c) => ({
      dept: String(c.dept || ''),
      staff: String(c.staff || ''),
    }))
    .filter((c) => c.staff);
}
