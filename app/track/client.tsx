'use client';

import { useState } from 'react';

interface TrackResult {
  orderId: number;
  name: string;
  customerMasked: string;
  dateIn: string;
  dateDue: string;
  status: 'cancelled' | 'shipped' | 'in_progress' | 'received';
  statusLabel: string;
  step: string;
  currentDept: 'graphic' | 'print' | 'post' | null;
  daysHint: string;
  urgencyKey: string;
  shippedDate?: string;
  cancelReason?: string;
}

// Pill colors mirror WP `.badge-*` classes (page-track-order.php:276-282).
// Variant key resolved from urgencyKey + status:
//   cancelled → cancelled (gray)
//   shipped   → shipped   (green)
//   overdue   → overdue   (red)
//   in_progress / dept    → progress (blue)
//   received / pending    → normal   (amber)
const BADGE_COLOR: Record<string, { bg: string; text: string }> = {
  normal:    { bg: '#fef3c7', text: '#b45309' },
  progress:  { bg: '#dbeafe', text: '#1d4ed8' },
  overdue:   { bg: '#fee2e2', text: '#dc2626' },
  shipped:   { bg: '#dcfce7', text: '#059669' },
  cancelled: { bg: '#f3f4f6', text: '#6b7280' },
};

function badgeVariant(r: TrackResult): keyof typeof BADGE_COLOR {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'shipped') return 'shipped';
  if (r.urgencyKey === 'overdue') return 'overdue';
  if (r.status === 'in_progress') return 'progress';
  return 'normal';
}

export function TrackClient({ initialId }: { initialId: string }) {
  const [orderId, setOrderId] = useState(initialId);
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<TrackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (orderId.length < 3 || pin.length !== 4) {
      setError('เลขที่ใบสั่งงานหรือ PIN ไม่ถูกต้อง (PIN ต้องเป็นตัวเลข 4 หลัก)');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/track/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: orderId, pin }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เครือข่ายขัดข้อง');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
    setPin('');
  }

  if (result) return <ResultView result={result} onBack={reset} />;
  return <LookupForm
    orderId={orderId}
    pin={pin}
    error={error}
    busy={busy}
    onOrderIdChange={(v) => setOrderId(v.replace(/[^0-9]/g, ''))}
    onPinChange={(v) => setPin(v.replace(/[^0-9]/g, ''))}
    onSubmit={submit}
  />;
}

// ─── Lookup form (initial view) ─────────────────────────────────────

function LookupForm({
  orderId,
  pin,
  error,
  busy,
  onOrderIdChange,
  onPinChange,
  onSubmit,
}: {
  orderId: string;
  pin: string;
  error: string | null;
  busy: boolean;
  onOrderIdChange: (v: string) => void;
  onPinChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <>
      <div style={CARD}>
        <div style={{ padding: '28px 24px' }}>
          <div style={FORM_TITLE}>ตรวจสอบสถานะงาน</div>
          <div style={FORM_SUB}>ใส่เลขที่ใบสั่งงานและ PIN 4 หลัก ที่ระบุในใบสั่งงาน</div>

          {error && <div style={ERROR_BOX}>{error}</div>}

          <form onSubmit={onSubmit}>
            <Field label="เลขที่ใบสั่งงาน">
              <input
                type="text"
                value={orderId}
                onChange={(e) => onOrderIdChange(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                maxLength={12}
                required
                style={INPUT}
              />
            </Field>
            <Field label="PIN (4 หลัก)">
              <input
                type="text"
                value={pin}
                onChange={(e) => onPinChange(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                style={{
                  ...INPUT,
                  letterSpacing: '8px',
                  textAlign: 'center',
                  fontSize: 20,
                  fontWeight: 600,
                }}
              />
            </Field>
            <button type="submit" disabled={busy} style={SUBMIT}>
              {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบ'}
            </button>
          </form>
        </div>
      </div>
      <div style={FOOTER_NOTE}>
        PIN อยู่ข้างเลขที่ใบสั่งงาน · สแกน QR code เพื่อกรอกเลขให้อัตโนมัติ
      </div>
    </>
  );
}

// ─── Result view (after successful lookup) ─────────────────────────

function ResultView({ result, onBack }: { result: TrackResult; onBack: () => void }) {
  const variant = badgeVariant(result);
  const badge = BADGE_COLOR[variant];
  const isShipped = result.status === 'shipped';
  const isCancelled = result.status === 'cancelled';

  return (
    <>
      <div style={CARD}>
        {/* Header — cream BG to set off the white sections below */}
        <div style={STATUS_HEADER}>
          <div style={JOB_NAME}>{result.name}</div>
          <div style={ORDER_META}>
            <div>
              <span style={META_LABEL}>ลูกค้า:</span> {result.customerMasked}
            </div>
            <div>
              <span style={META_LABEL}>เลขที่:</span> #{result.orderId}
            </div>
          </div>
          <span
            style={{
              ...STATUS_BADGE,
              background: badge.bg,
              color: badge.text,
            }}
          >
            {result.statusLabel}
          </span>
          {result.daysHint && <span style={DAYS_HINT}>{result.daysHint}</span>}
        </div>

        {/* Date row */}
        <div style={INFO_ROW}>
          <InfoCell label="วันสั่ง" value={result.dateIn} />
          <InfoCell label="กำหนดส่ง" value={result.dateDue} />
        </div>

        {/* 6-step progress */}
        <div style={{ padding: '22px 24px' }}>
          <div style={PROGRESS_TITLE}>ขั้นตอน</div>
          <Steps
            currentDept={result.currentDept}
            isShipped={isShipped}
            isCancelled={isCancelled}
            shippedDate={result.shippedDate}
          />
        </div>

        {/* Cancellation reason (if any) */}
        {isCancelled && result.cancelReason && (
          <div style={REASON_BOX}>เหตุผล: {result.cancelReason}</div>
        )}

        {/* Contact */}
        <div style={CONTACT_BOX}>
          ติดต่อสอบถาม: <a href="tel:043220582" style={CONTACT_LINK}>043-220-582</a>
        </div>
      </div>

      <div style={BACK_BTN_WRAP}>
        <button type="button" onClick={onBack} style={BACK_BTN}>
          ← ตรวจสอบงานอื่น
        </button>
      </div>
    </>
  );
}

// ─── 6-step progress ─────────────────────────────────────────────

const DEPT_ORDER: Array<{ key: 'graphic' | 'print' | 'post'; thai: string; eng: string }> = [
  { key: 'graphic', thai: 'กราฟิกกำลังดำเนินการ', eng: 'Pre-press unit' },
  { key: 'print',   thai: 'อยู่ระหว่างพิมพ์',       eng: 'Printing in progress' },
  { key: 'post',    thai: 'ขั้นตอนหลังพิมพ์',      eng: 'Post-press unit' },
];

function Steps({
  currentDept,
  isShipped,
  isCancelled,
  shippedDate,
}: {
  currentDept: 'graphic' | 'print' | 'post' | null;
  isShipped: boolean;
  isCancelled: boolean;
  shippedDate?: string;
}) {
  const steps: React.ReactNode[] = [];

  // Step 1: รับใบสั่งงาน — always done
  steps.push(<Step key="received" state="done" thai="รับใบสั่งงาน" eng="Order received" />);

  if (isCancelled) {
    steps.push(
      <Step key="cancelled" state="cancelled" thai="ยกเลิกโดยโรงพิมพ์" eng="Order cancelled" />,
    );
    return <>{steps}</>;
  }

  // Steps 2-4: graphic / print / post — based on current dept
  const currentIdx = currentDept ? DEPT_ORDER.findIndex((d) => d.key === currentDept) : -1;
  DEPT_ORDER.forEach((d, idx) => {
    let state: StepState = 'pending';
    if (isShipped) {
      state = 'done';
    } else if (idx === currentIdx) {
      state = 'current';
    } else if (currentIdx > idx) {
      state = 'done';
    }
    steps.push(<Step key={d.key} state={state} thai={d.thai} eng={d.eng} />);
  });

  // Step 5: สินค้าพร้อมรับ — done only when shipped (no separate "ready" state)
  steps.push(
    <Step
      key="ready"
      state={isShipped ? 'done' : 'pending'}
      thai="สินค้าพร้อมรับ"
      eng="Ready for pick up"
    />,
  );

  // Step 6: จัดส่งเรียบร้อยแล้ว — done when shipped, with date if available
  const shipThai = isShipped && shippedDate
    ? `จัดส่งเรียบร้อยแล้ว (${shippedDate})`
    : 'จัดส่งเรียบร้อยแล้ว';
  steps.push(
    <Step
      key="shipped"
      state={isShipped ? 'done' : 'pending'}
      thai={shipThai}
      eng="Order complete"
    />,
  );

  return <>{steps}</>;
}

type StepState = 'done' | 'current' | 'pending' | 'cancelled';

const STEP_STYLE: Record<StepState, { iconBg: string; iconColor: string; thai: string; eng: string }> = {
  done:      { iconBg: '#dcfce7', iconColor: '#059669', thai: '#1a202c', eng: '#64748b' },
  current:   { iconBg: '#dbeafe', iconColor: '#1d4ed8', thai: '#1d4ed8', eng: '#3b82f6' },
  pending:   { iconBg: '#f1f5f9', iconColor: '#cbd5e0', thai: '#cbd5e0', eng: '#cbd5e0' },
  cancelled: { iconBg: '#fee2e2', iconColor: '#dc2626', thai: '#dc2626', eng: '#dc2626' },
};

const STEP_ICON: Record<StepState, string> = {
  done: '✓',
  current: '●',
  pending: '○',
  cancelled: '✕',
};

function Step({ state, thai, eng }: { state: StepState; thai: string; eng: string }) {
  const s = STEP_STYLE[state];
  const isCurrent = state === 'current';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '11px 0',
        borderBottom: '1px solid #f5f5f0',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          flexShrink: 0,
          background: s.iconBg,
          color: s.iconColor,
          fontWeight: 700,
        }}
      >
        {STEP_ICON[state]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            color: s.thai,
            fontWeight: state === 'done' ? 500 : isCurrent ? 600 : 400,
          }}
        >
          {thai}
        </div>
        <div
          style={{
            fontSize: 11,
            color: s.eng,
            opacity: state === 'pending' ? 0.7 : 1,
            marginTop: 1,
          }}
        >
          {eng}
        </div>
      </div>
    </div>
  );
}

// ─── Atoms ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label
        style={{
          display: 'block',
          fontSize: 13,
          fontWeight: 600,
          color: '#2d3748',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          color: '#a0aec0',
          fontSize: 11,
          fontWeight: 500,
          marginBottom: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      <span style={{ color: '#1a202c', fontWeight: 500, fontSize: 14 }}>{value || '-'}</span>
    </div>
  );
}

// ─── Style tokens (mirror WP page-track-order.php) ────────────────

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: 20,
  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  border: '1px solid #ebebeb',
  overflow: 'hidden',
};

const FORM_TITLE: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  marginBottom: 6,
  color: '#1a202c',
};

const FORM_SUB: React.CSSProperties = {
  fontSize: 13,
  color: '#718096',
  marginBottom: 24,
};

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  fontSize: 15,
  fontFamily: 'inherit',
  outline: 'none',
  background: '#fff',
  transition: 'border .2s, box-shadow .2s',
};

const SUBMIT: React.CSSProperties = {
  width: '100%',
  padding: 14,
  background: '#1a202c',
  color: '#fff',
  border: 'none',
  borderRadius: 12,
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginTop: 8,
  transition: 'background .2s',
};

const ERROR_BOX: React.CSSProperties = {
  background: '#fef2f2',
  color: '#dc2626',
  border: '1px solid #fecaca',
  borderRadius: 10,
  padding: '12px 16px',
  marginBottom: 16,
  fontSize: 13,
  fontWeight: 500,
};

const FOOTER_NOTE: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 11,
  color: '#a0aec0',
  marginTop: 20,
};

const STATUS_HEADER: React.CSSProperties = {
  padding: '28px 24px 24px',
  background: '#f5f5f0',
  borderBottom: '1px solid #ebebeb',
};

const JOB_NAME: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: '#1a202c',
  marginBottom: 6,
  lineHeight: 1.3,
  wordBreak: 'break-word',
};

const ORDER_META: React.CSSProperties = {
  fontSize: 13,
  color: '#718096',
  marginBottom: 18,
  lineHeight: 1.6,
};

const META_LABEL: React.CSSProperties = {
  color: '#a0aec0',
};

const STATUS_BADGE: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 18px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
};

const DAYS_HINT: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  fontSize: 12,
  color: '#718096',
  fontWeight: 500,
};

const INFO_ROW: React.CSSProperties = {
  padding: '18px 24px',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 14,
  borderBottom: '1px solid #ebebeb',
};

const PROGRESS_TITLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#a0aec0',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  marginBottom: 12,
};

const REASON_BOX: React.CSSProperties = {
  margin: '6px 24px 14px',
  padding: '12px 14px',
  background: '#fef2f2',
  borderRadius: 10,
  fontSize: 12,
  color: '#dc2626',
  lineHeight: 1.5,
};

const CONTACT_BOX: React.CSSProperties = {
  padding: '18px 24px',
  background: '#f5f5f0',
  fontSize: 13,
  color: '#4a5568',
  textAlign: 'center',
  borderTop: '1px solid #ebebeb',
};

const CONTACT_LINK: React.CSSProperties = {
  color: '#046bd2',
  textDecoration: 'none',
  fontWeight: 600,
};

const BACK_BTN_WRAP: React.CSSProperties = {
  textAlign: 'center',
  marginTop: 16,
};

const BACK_BTN: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 16px',
  color: '#718096',
  background: 'transparent',
  border: 'none',
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
