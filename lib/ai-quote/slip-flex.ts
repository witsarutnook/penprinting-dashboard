// lib/ai-quote/slip-flex.ts
// Slip-verify result → LINE Flex card (Penprinting theme). Pure + total: never throws,
// every field access is null-safe. altText reuses formatSlipReply (notification + fallback
// text when a device can't render Flex). Mirrors the buildOrderFlex pattern in track-flex.ts.
import { formatSlipReply, type ThunderVerifyResponse, type ThunderParty } from './slip';

type State = 'success' | 'duplicate' | 'mismatch' | 'unreadable';

// status header colors — Penprinting palette, NOT Thunder branding
const HEADER: Record<State, { bg: string; fg: string; label: string }> = {
  success:    { bg: '#e1f5ee', fg: '#0f6e56', label: '✅ สลิปถูกต้อง' },
  duplicate:  { bg: '#faeeda', fg: '#854f0b', label: '⚠️ สลิปนี้เคยส่งแล้ว' },
  mismatch:   { bg: '#fcebeb', fg: '#a32d2d', label: '❌ บัญชีปลายทางไม่ตรง' },
  unreadable: { bg: '#f1efe8', fg: '#444441', label: 'อ่านสลิปไม่ได้' },
};

const ACCENT = '#c8553d'; // Penprinting brand
const TEXT = '#2c2c2a';
const MUTED = '#888780';
const SEP = { type: 'separator', margin: 'md', color: '#eceae4' } as const;

type Party = ThunderParty;

/** Mirror formatSlipReply priority exactly so the card + its altText always agree. */
function classify(r: ThunderVerifyResponse): State {
  if (r.success && r.data) {
    if (r.data.isDuplicate) return 'duplicate';
    if (r.data.isAccountMatched === false) return 'mismatch';
    return 'success';
  }
  return 'unreadable';
}

function fmtAmount(n?: number): string | null {
  if (typeof n !== 'number' || !isFinite(n)) return null;
  return '฿' + n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const date = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return date + ' · ' + time + ' น.';
}

function partyName(p?: Party): string {
  return p?.account?.name?.th || p?.account?.name?.en || '-';
}
function bankName(p?: Party): string | undefined {
  return p?.bank?.name || p?.bank?.nameTh || p?.bank?.nameEn; // Thunder v2 / legacy dual-read
}
function partySub(p?: Party): string {
  return [bankName(p), p?.account?.number].filter(Boolean).join(' · ');
}

function partyRow(label: string, p?: Party): Record<string, unknown> {
  const value: Record<string, unknown>[] = [
    { type: 'text', text: partyName(p), size: 'sm', color: TEXT, align: 'end', wrap: true },
  ];
  const sub = partySub(p);
  if (sub) value.push({ type: 'text', text: sub, size: 'xxs', color: MUTED, align: 'end', wrap: true });
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 0 },
      { type: 'box', layout: 'vertical', spacing: 'none', contents: value },
    ],
  };
}

function kvRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 0 },
      { type: 'text', text: value, size: 'xs', color: MUTED, align: 'end', wrap: true },
    ],
  };
}

function amountBlock(amount: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'vertical', spacing: 'none',
    contents: [
      { type: 'text', text: 'ยอดโอน', size: 'xs', color: MUTED },
      { type: 'text', text: amount, size: 'xxl', weight: 'bold', color: TEXT },
    ],
  };
}

function notice(text: string): Record<string, unknown> {
  return { type: 'text', text, size: 'sm', color: '#5f5e5a', wrap: true };
}

/** Build the LINE Flex message for a slip-verify result. Returns a complete
 *  `{ type:'flex', altText, contents:{ type:'bubble' } }` ready to pass to reply(). */
export function buildSlipFlex(result: ThunderVerifyResponse): Record<string, unknown> {
  const state = classify(result);
  const h = HEADER[state];
  const raw = result.data?.rawSlip;
  const amount = fmtAmount(raw?.amount?.amount);
  const body: Record<string, unknown>[] = [];

  if (state === 'success') {
    if (amount) body.push(amountBlock(amount));
    const date = fmtDate(raw?.date ?? raw?.transDate); // Thunder v2 / legacy dual-read
    if (date) body.push({ type: 'text', text: date, size: 'xs', color: MUTED });
    body.push({ ...SEP });
    body.push(partyRow('ผู้โอน', raw?.sender));
    body.push(partyRow('ผู้รับ', raw?.receiver));
    if (raw?.transRef) body.push(kvRow('เลขที่รายการ', String(raw.transRef)));
  } else if (state === 'duplicate') {
    if (amount) body.push(amountBlock(amount));
    const sender = partyName(raw?.sender);
    if (sender !== '-') body.push({ type: 'text', text: 'จาก ' + sender, size: 'sm', color: MUTED });
    body.push({ ...SEP });
    body.push(notice('ถ้าเป็นการโอนใหม่ รบกวนแจ้งทีมงานเพิ่มเติมนะคะ 🙏'));
  } else if (state === 'mismatch') {
    if (amount) body.push(amountBlock(amount));
    body.push({ ...SEP });
    // D4: never expose the mistaken destination account — just tell the customer to recheck
    body.push(notice('ยอดนี้ดูไม่ตรงบัญชีของร้านค่ะ 🙏 รบกวนตรวจสอบเลขบัญชีปลายทางอีกครั้งนะคะ'));
  } else {
    body.push(notice('ระบบอ่านสลิปไม่ออกค่ะ 🙏 รบกวนส่งรูปสลิปใหม่ให้ชัดเจน หรือรอทีมงานตรวจสอบให้นะคะ'));
  }

  return {
    type: 'flex',
    altText: formatSlipReply(result),
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: h.bg, paddingAll: '12px',
        contents: [{ type: 'text', text: h.label, weight: 'bold', size: 'md', color: h.fg, wrap: true }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box', layout: 'horizontal', paddingAll: '10px',
        contents: [{ type: 'text', text: '✓ ตรวจสอบอัตโนมัติ · Penprinting', size: 'xxs', color: ACCENT, align: 'center' }],
      },
    },
  };
}
