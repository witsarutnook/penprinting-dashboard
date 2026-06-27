// lib/ai-quote/slip.ts
import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';

const THUNDER_BASE = process.env.THUNDER_API_URL ?? 'https://api.thunder.in.th/v2';

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type AllowedMedia = (typeof ALLOWED_MEDIA)[number];
function toAllowedMedia(s: string): AllowedMedia {
  return (ALLOWED_MEDIA as readonly string[]).includes(s) ? (s as AllowedMedia) : 'image/jpeg';
}

export interface ThunderVerifyResponse {
  success: boolean;
  message?: string;
  data?: {
    isDuplicate?: boolean;
    isAmountMatched?: boolean;
    isAccountMatched?: boolean;
    rawSlip?: {
      amount?: { amount?: number };
      sender?: { account?: { name?: { th?: string; en?: string } } };
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

/** Thunder result → Thai customer reply. Priority: duplicate > account-mismatch
 *  > unreadable > success. */
export function formatSlipReply(r: ThunderVerifyResponse): string {
  if (r.success && r.data) {
    if (r.data.isDuplicate) return 'สลิปนี้เคยส่งเข้ามาแล้วนะคะ 🙏 ถ้าเป็นการโอนใหม่ รบกวนแจ้งทีมงานเพิ่มเติมค่ะ';
    if (r.data.isAccountMatched === false) return 'ยอดโอนนี้ดูไม่ตรงบัญชีของร้านค่ะ 🙏 รบกวนตรวจสอบเลขบัญชีปลายทางอีกครั้งนะคะ';
    const amount = r.data.rawSlip?.amount?.amount;
    const sender = r.data.rawSlip?.sender?.account?.name?.th;
    const amountStr = typeof amount === 'number' ? amount.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : null;
    let msg = 'ได้รับสลิปแล้วค่ะ ✅';
    if (amountStr) msg += ` ยอด ${amountStr} บาท`;
    if (sender) msg += ` จากคุณ${sender}`;
    msg += ' — ขอบคุณค่ะ เดี๋ยวทีมงานตรวจสอบและดำเนินการต่อให้นะคะ 🙏';
    return msg;
  }
  return 'ขออภัยค่ะ ระบบอ่านสลิปไม่ได้ 🙏 รบกวนส่งรูปสลิปใหม่ให้ชัดเจน หรือรอทีมงานตรวจสอบให้นะคะ';
}

/** Cheap pre-filter: ask Haiku vision whether the image is a Thai bank/e-wallet
 *  transfer slip BEFORE spending a Thunder quota slot (Thunder counts every
 *  request incl. non-slips). Fail-safe = true on any error (a wasted quota slot
 *  is cheaper than dropping a real customer slip). client injected for tests. */
export async function isSlipImage(
  imageBase64: string,
  mediaType: string,
  deps: { client: Anthropic; model: string },
): Promise<boolean> {
  try {
    const res = await deps.client.messages.create({
      model: deps.model,
      max_tokens: 8,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: toAllowedMedia(mediaType), data: imageBase64 } },
          { type: 'text', text: 'รูปนี้เป็นสลิป/หลักฐานการโอนเงินของธนาคารไทยหรือ e-wallet ใช่ไหม ตอบแค่ "yes" หรือ "no" คำเดียว' },
        ],
      }],
    });
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim().toLowerCase();
    if (!text) return true; // empty/text-less response → fail-safe (don't drop a possible slip)
    return text.startsWith('yes') || text.startsWith('ใช่');
  } catch {
    return true; // fail-safe
  }
}
