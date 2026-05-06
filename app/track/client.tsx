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
  daysHint: string;
  urgencyKey: string;
  shippedDate?: string;
  cancelReason?: string;
}

const STATUS_COLOR: Record<string, { bg: string; text: string; ring: string }> = {
  cancelled:    { bg: '#fef2f2', text: '#b91c1c', ring: '#fca5a5' },
  shipped:      { bg: '#ecfdf5', text: '#047857', ring: '#6ee7b7' },
  in_progress:  { bg: '#eff6ff', text: '#1e40af', ring: '#93c5fd' },
  received:     { bg: '#fefce8', text: '#854d0e', ring: '#fde68a' },
};

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
    if (orderId.length < 6 || pin.length !== 4) {
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

  if (result) {
    const color = STATUS_COLOR[result.status] || STATUS_COLOR.received;
    return (
      <div
        style={{
          background: '#fff', borderRadius: 14,
          border: '1px solid #e5e7eb', padding: 24,
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
        }}
      >
        <div style={{ marginBottom: 16, fontSize: 12, color: '#9ca3af' }}>
          เลขที่ใบสั่งงาน <b style={{ color: '#111' }}>#{result.orderId}</b>
        </div>
        <h2 style={{ fontSize: 18, color: '#111', margin: '0 0 4px', fontWeight: 700 }}>
          {result.name}
        </h2>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
          ลูกค้า: {result.customerMasked}
        </p>
        <div
          style={{
            background: color.bg,
            color: color.text,
            border: `1px solid ${color.ring}`,
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              width: 10, height: 10, borderRadius: '50%',
              background: color.text, flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{result.statusLabel}</div>
            {result.daysHint && (
              <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
                {result.daysHint}
              </div>
            )}
          </div>
        </div>

        <Row label="ขั้นตอนปัจจุบัน" value={result.step} />
        <Row label="วันที่รับงาน" value={result.dateIn} />
        <Row label="กำหนดส่ง" value={result.dateDue} />
        {result.shippedDate && <Row label="วันที่จัดส่ง" value={result.shippedDate} accent="#047857" />}
        {result.cancelReason && <Row label="เหตุผลการยกเลิก" value={result.cancelReason} accent="#b91c1c" />}

        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 18, width: '100%',
            padding: '10px 16px', borderRadius: 8,
            background: '#f3f4f6', color: '#374151',
            border: 'none', fontWeight: 500, fontSize: 14, cursor: 'pointer',
          }}
        >
          ตรวจใบสั่งอื่น
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: '#fff', borderRadius: 14,
        border: '1px solid #e5e7eb', padding: 24,
        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)',
      }}
    >
      <Field label="เลขที่ใบสั่งงาน" hint="เช่น 202604077">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={orderId}
          onChange={(e) => setOrderId(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="กรอกเลขที่ใบสั่งงาน"
          autoComplete="off"
          required
          style={inputStyle}
        />
      </Field>
      <Field label="PIN (4 หลัก)" hint="ดูได้จากใบสั่งงาน หรือสอบถามทางร้าน">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="••••"
          autoComplete="off"
          required
          style={{
            ...inputStyle,
            textAlign: 'center',
            letterSpacing: '8px',
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            fontSize: 18,
          }}
        />
      </Field>
      {error && (
        <div
          style={{
            marginTop: 12, padding: '10px 12px',
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, color: '#b91c1c', fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 16, width: '100%',
          padding: '12px 16px', borderRadius: 8,
          background: '#1e3a8a', color: '#fff',
          border: 'none', fontWeight: 600, fontSize: 15,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสถานะ'}
      </button>
      <p style={{ marginTop: 12, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
        เพื่อความปลอดภัย จำกัดการตรวจสอบ 15 ครั้งต่อชั่วโมง
      </p>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px',
  borderRadius: 8, border: '1px solid #d6d3d1',
  fontSize: 15, fontFamily: 'inherit',
  outline: 'none', transition: 'border-color 0.15s',
};

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: '#374151' }}>
        {label}
      </label>
      {children}
      {hint && (
        <p style={{ marginTop: 4, fontSize: 11, color: '#9ca3af' }}>{hint}</p>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '8px 0', borderTop: '1px solid #f3f4f6',
        fontSize: 14,
      }}
    >
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ fontWeight: 500, color: accent || '#111', textAlign: 'right' }}>{value}</span>
    </div>
  );
}
