// lib/ai-quote/slip.ts
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';

const THUNDER_BASE = process.env.THUNDER_API_URL ?? 'https://api.thunder.in.th/v2';

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMedia = (typeof ALLOWED_MEDIA)[number];
function toAllowedMedia(s: string): AllowedMedia {
  return (ALLOWED_MEDIA as readonly string[]).includes(s) ? (s as AllowedMedia) : 'image/jpeg';
}

export interface ThunderParty {
  account?: { name?: { th?: string; en?: string }; number?: string };
  // bank: Thunder v2 uses { id, name, short }; Remedy/legacy used { nameTh, nameEn } — read both
  bank?: { id?: string; name?: string; short?: string; nameTh?: string; nameEn?: string };
}

export interface ThunderVerifyResponse {
  success: boolean;
  message?: string;
  data?: {
    isDuplicate?: boolean;
    isAmountMatched?: boolean;
    isAccountMatched?: boolean;
    rawSlip?: {
      transRef?: string;
      date?: string;       // Thunder v2 field name
      transDate?: string;  // legacy/Remedy alias — dual-read
      amount?: { amount?: number; local?: { amount?: number } };
      sender?: ThunderParty;
      receiver?: ThunderParty;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  error?: { code: string; message: string };
}

/** Verify a Thai bank slip image via Thunder v2 (multipart). matchAmount optional
 *  — Penprinting slips are unsolicited (no known expected amount), so we verify
 *  authenticity + whitelisted receiving account + duplicate, and report the read
 *  amount. Field name MUST be "image". Bearer THUNDER_API_KEY. */
export async function verifyBankSlipImage(
  image: Blob,
  opts: { matchAmount?: number; matchAccount?: boolean } = {},
): Promise<ThunderVerifyResponse> {
  const key = process.env.THUNDER_API_KEY;
  if (!key) return { success: false, error: { code: 'NO_KEY', message: 'THUNDER_API_KEY missing' } };
  const fd = new FormData();
  fd.append('image', image);
  fd.append('matchAccount', String(opts.matchAccount ?? true));
  fd.append('checkDuplicate', 'true');
  if (typeof opts.matchAmount === 'number') fd.append('matchAmount', String(opts.matchAmount));
  let res: Response;
  try {
    res = await fetch(`${THUNDER_BASE}/verify/bank`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd,
    });
  } catch (e) {
    return { success: false, error: { code: 'NETWORK', message: e instanceof Error ? e.message : 'fetch failed' } };
  }
  try { return (await res.json()) as ThunderVerifyResponse; }
  catch { return { success: false, error: { code: 'INVALID_RESPONSE', message: `HTTP ${res.status}` } }; }
}

/** Thunder result → LINE notification/altText for the slip-verify Flex card.
 *  Single generic line for every state — the Flex card itself carries the
 *  per-state detail; this string is only the push-notification preview + the
 *  fallback shown when a device can't render Flex. */
export function formatSlipReply(_r: ThunderVerifyResponse): string {
  return 'อัพเดทผลการตรวจสอบสลิป';
}

/** Pre-filter verdict + the model's raw answer (trimmed, lowercased) — the
 *  answer is persisted to slip_checks.prefilter_answer so a silent drop is
 *  always attributable (2026-07-23 incident: a real bill-payment slip was
 *  dropped 3× with zero evidence of what the model actually said). */
export interface SlipPrefilter { pass: boolean; answer: string | null }

/** Cheap pre-filter: ask Haiku vision whether the image is a Thai bank/e-wallet
 *  transfer slip BEFORE spending a Thunder quota slot (Thunder counts every
 *  request incl. non-slips). Fail-safe = pass on any error (a wasted quota slot
 *  is cheaper than dropping a real customer slip). client injected for tests. */
export async function isSlipImage(
  imageBase64: string,
  mediaType: string,
  deps: { client: Anthropic; model: string },
): Promise<SlipPrefilter> {
  try {
    const res = await deps.client.messages.create({
      model: deps.model,
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: toAllowedMedia(mediaType), data: imageBase64 } },
          { type: 'text', text: [
            'คุณเป็นตัวกรองรูปก่อนส่งให้ระบบตรวจสลิปอัตโนมัติ',
            'รูปนี้เป็น "สลิป/หลักฐานทำรายการทางการเงิน" ของธนาคารไทย, PromptPay หรือ e-wallet (เช่น TrueMoney, ShopeePay) ใช่หรือไม่?',
            'ให้นับว่า "ใช่" กับสลิปทุกประเภท ไม่ใช่แค่การโอนเงิน — รวมถึง สลิปโอนเงิน, จ่ายบิล/ชำระบิล (เช่น "จ่ายบิลสำเร็จ"), สแกนจ่าย QR/พร้อมเพย์, เติมเงิน, และหลักฐานการชำระเงินอื่นๆ',
            'สังเกตจากองค์ประกอบ เช่น โลโก้/ชื่อธนาคาร, ยอดเงิน, วันเวลา, เลขที่รายการ, ชื่อผู้โอน-ผู้รับ, หรือ QR ตรวจสอบสลิป แม้รูปจะเบลอหรือถ่ายจอ',
            'ตอบ "no" เฉพาะรูปที่ไม่ใช่สลิปการเงินชัดเจน (เช่น รูปสินค้า, รูปงานออกแบบ, อาหาร, สติกเกอร์, เอกสารทั่วไป)',
            'ตอบเป็นคำเดียว: "yes" หรือ "no" ถ้าไม่แน่ใจ ให้ตอบ "yes"',
          ].join('\n') },
        ],
      }],
    });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim().toLowerCase();
    if (!text) return { pass: true, answer: '' }; // empty/text-less response → fail-safe (don't drop a possible slip)
    // fail-safe: pass everything EXCEPT an explicit refusal — keeps real slips
    // (incl. "รูปนี้เป็นสลิป" / "น่าจะใช่") from being silently dropped.
    // Refusal = the word "no" / "ไม่ใช่" / bare "ไม่" ONLY. A prefix match on
    // "ไม่"/"no" used to read hedges — "ไม่แน่ใจ", "not sure" — as refusals and
    // silently drop real slips (2026-07-23): unsure must fall through to pass,
    // matching the prompt's own "ถ้าไม่แน่ใจ ให้ตอบ yes" instruction.
    const refused = /^no\b/.test(text) || text.startsWith('ไม่ใช่') || text === 'ไม่';
    return { pass: !refused, answer: text };
  } catch {
    return { pass: true, answer: null }; // fail-safe
  }
}
