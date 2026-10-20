// lib/ai-quote/intro-flex.ts
// น้อง PP entry UI: the welcome bubble with 6 product buttons (LINE Flex) /
// short text + 6 quick-reply chips (Messenger, no Flex), and the 3-button
// "which calendar?" bubble. Pure module — no I/O, no server-only; the webhook
// router imports it directly. Same Flex style as customer-jobs-flex.ts.
//
// Every button just SENDS PLAIN PRODUCT TEXT into the chat ("หนังสือ",
// "ปฏิทินแขวน"…), so the engine / prompt flow is untouched and persisted
// history stays text-only. Button labels carry an emoji; the text they send
// never does (the emoji-free text is what the model and logs see).
import type { QuickReply } from './channels/types';

const ACCENT = '#c8553d';
const SOFT = '#fdf0e7';
const MUTED = '#888780';
const INK = '#2c2c2a';

/** The 6 products น้อง PP can quote — order = button order (3 rows × 2). */
export const INTRO_PRODUCTS: ReadonlyArray<{ label: string; text: string }> = [
  { label: '📄 ใบปลิว/โบรชัวร์', text: 'ใบปลิว/โบรชัวร์' },
  { label: '📚 หนังสือ', text: 'หนังสือ' },
  { label: '📓 สมุด', text: 'สมุด' },
  { label: '🪪 นามบัตร', text: 'นามบัตร' },
  { label: '📅 ปฏิทิน', text: 'ปฏิทิน' },
  { label: '💳 บัตร PVC', text: 'บัตร PVC' },
];

/** Welcome text for channels without Flex (Messenger) and the Flex altText
 *  (LINE notification preview / clients that can't render Flex). */
export const INTRO_TEXT_SHORT =
  'สวัสดีค่ะ 🤖 น้อง PP ผู้ช่วยประเมินราคาของ Penprinting ค่ะ\n' +
  'เลือกชนิดงานด้านล่าง หรือพิมพ์สเปกมาเลย เช่น "ใบปลิว A4 1,000 ใบ"\n' +
  'พิมพ์ "ออก" เมื่อต้องการกลับไปคุยกับทีมงาน · ราคาประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ';

/** Messenger chips for the intro. Labels ≤20 code points (Messenger title cap). */
export const INTRO_QUICK_REPLIES: QuickReply[] = INTRO_PRODUCTS.map((p) => ({ label: p.label, text: p.text }));

type FlexButton = { label: string; text: string };

function primaryButton(b: FlexButton): Record<string, unknown> {
  return {
    type: 'button', style: 'primary', color: ACCENT, height: 'sm',
    action: { type: 'message', label: b.label, text: b.text },
  };
}

/** LINE welcome bubble: brand header, one line of copy, 3 rows × 2 product buttons, muted footer. */
export function buildIntroFlex(): Record<string, unknown> {
  const rows = [0, 2, 4].map((i) => ({
    type: 'box', layout: 'horizontal', spacing: 'sm', margin: 'sm',
    contents: INTRO_PRODUCTS.slice(i, i + 2).map(primaryButton),
  }));
  const muted = (text: string) => ({ type: 'text', text, size: 'xxs', color: MUTED, wrap: true, align: 'center' });
  return {
    type: 'flex',
    altText: INTRO_TEXT_SHORT,
    contents: {
      type: 'bubble', size: 'mega',
      header: {
        type: 'box', layout: 'vertical', paddingAll: 'lg', backgroundColor: SOFT, spacing: 'xs',
        contents: [
          { type: 'text', text: '🤖', size: 'xxl', align: 'center' },
          { type: 'text', text: 'น้อง PP', weight: 'bold', size: 'xl', color: ACCENT, align: 'center' },
          { type: 'text', text: 'ผู้ช่วยประเมินราคา Penprinting', size: 'xs', color: MUTED, align: 'center' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'lg', backgroundColor: '#ffffff',
        contents: [
          { type: 'text', text: 'สวัสดีค่ะ เลือกชนิดงานที่ต้องการขอราคาได้เลยค่ะ', size: 'sm', color: INK, wrap: true },
          ...rows,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'xs', backgroundColor: '#ffffff',
        contents: [
          muted('หรือพิมพ์สเปกงานมาเองได้เลยค่ะ'),
          muted('พิมพ์ "ออก" เมื่อต้องการกลับไปคุยกับทีมงาน'),
          muted('ราคาประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ'),
        ],
      },
    },
  };
}

/** The 3 popular calendar kinds. `label` = short button title; `text` = what the
 *  tap sends (names the product, so the engine reads "ปฏิทินแขวน", not just "แขวน"). */
export const CALENDAR_KINDS: ReadonlyArray<{ label: string; text: string }> = [
  { label: 'ปฏิทินจีน', text: 'ปฏิทินจีน' },
  { label: 'ตั้งโต๊ะ 6x8 นิ้ว', text: 'ปฏิทินตั้งโต๊ะ 6x8 นิ้ว' },
  { label: 'แขวน', text: 'ปฏิทินแขวน' },
];

/** Messenger chips for the calendar-kind question. Labels ≤20 code points. */
export const CALENDAR_KIND_QUICK_REPLIES: QuickReply[] = CALENDAR_KINDS.map((k) => ({ label: k.label, text: k.text }));

/** LINE small bubble: `bodyText` (the question) + the 3 kind buttons stacked. altText = bodyText. */
export function buildCalendarKindFlex(bodyText: string): Record<string, unknown> {
  return {
    type: 'flex',
    altText: bodyText,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', paddingAll: 'lg', backgroundColor: '#ffffff',
        contents: [{ type: 'text', text: bodyText, size: 'sm', color: INK, wrap: true }],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: 'md', spacing: 'sm', backgroundColor: '#ffffff',
        contents: CALENDAR_KINDS.map(primaryButton),
      },
    },
  };
}

/** The model (or the fast path) is asking which calendar kind — CALENDAR_KIND_ASK
 *  (customer-triggers.ts, interpolated into the customer prompt) carries this phrase. */
export function isCalendarKindAsk(reply: string): boolean {
  return /แบบที่นิยมมี 3 แบบ/.test(reply);
}

/** The customer tapped the 📅 ปฏิทิน intro button (sends "ปฏิทิน"; the emoji'd label is accepted too).
 *  Exact match only — "ปฏิทินแขวน" / "ทำปฏิทินไหม" belong to the engine. */
export function isCalendarButtonText(text: string): boolean {
  return /^(📅\s*)?ปฏิทิน$/.test(text.trim());
}
