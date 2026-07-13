// lib/ai-quote/escalation-flex.ts
// Escalation hand-off → Flex card pushed to the staff LINE group (Phase 1b-B
// spec §4). Pure + total like slip-flex.ts: never throws, null-safe fields.
import { TRIGGER_LABEL, type TriggerType } from './customer-triggers';

const ACCENT = '#c8553d'; // Penprinting brand
const TEXT = '#2c2c2a';
const MUTED = '#888780';

export interface EscalationFlexInput {
  trigger: TriggerType;
  customerName: string | null;
  /** Webhook-verified sender id — LINE userId หรือ Messenger PSID. */
  channelUserId: string;
  channel: 'line' | 'messenger';
  lastUserText: string;
  lastQuote: { productType: string; unitPrice: number } | null;
  sessionId: number;
}

// Type A (hand-off) = amber alert · Type B (qualified, พร้อมสั่ง) = green
const HEADER: Record<'A' | 'B', { bg: string; fg: string; label: string }> = {
  A: { bg: '#fdf0e7', fg: '#b45309', label: '🔔 AI ส่งต่อลูกค้าให้ทีมงาน' },
  B: { bg: '#e1f5ee', fg: '#0f6e56', label: '🛒 ลูกค้าพร้อมสั่ง (จาก AI)' },
};

const PRODUCT_LABEL: Record<string, string> = { brochure: 'โบรชัวร์/ใบปลิว', book: 'หนังสือ', notebook: 'สมุด', namecard: 'นามบัตร' };

function kvRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 2 },
      { type: 'text', text: value, size: 'sm', color: TEXT, flex: 5, wrap: true },
    ],
  };
}

/** Build the staff-group Flex for an escalation. Complete message object —
 *  ready to pass to pushLine(LINE_STAFF_GROUP_ID, ...). */
export function buildEscalationFlex(input: EscalationFlexInput): Record<string, unknown> {
  const h = HEADER[input.trigger === 'order_intent' ? 'B' : 'A'];
  const who = input.customerName || input.channelUserId;
  const body: Record<string, unknown>[] = [
    kvRow('ลูกค้า', who),
    kvRow('เหตุผล', TRIGGER_LABEL[input.trigger]),
  ];
  if (input.channel === 'messenger') {
    body.push(kvRow('ช่องทาง', 'Facebook Messenger — ตอบต่อใน Page inbox'));
  }
  if (input.lastQuote) {
    body.push(kvRow(
      'ราคาล่าสุด',
      `${PRODUCT_LABEL[input.lastQuote.productType] ?? input.lastQuote.productType} · ~${input.lastQuote.unitPrice.toFixed(2)} บ./ชิ้น`,
    ));
  }
  if (input.lastUserText) {
    body.push(kvRow('ข้อความ', input.lastUserText.length > 120 ? input.lastUserText.slice(0, 120) + '…' : input.lastUserText));
  }
  return {
    type: 'flex',
    altText: `${h.label}: ${who}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: h.bg, paddingAll: '12px',
        contents: [{ type: 'text', text: h.label, weight: 'bold', size: 'md', color: h.fg, wrap: true }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', height: 'sm', color: ACCENT,
            action: { type: 'uri', label: 'เปิด /quote-leads', uri: 'https://dashboard.penprinting.co/quote-leads' },
          },
          { type: 'text', text: `lead #${input.sessionId} · Penprinting AI`, size: 'xxs', color: MUTED, align: 'center' },
        ],
      },
    },
  };
}
