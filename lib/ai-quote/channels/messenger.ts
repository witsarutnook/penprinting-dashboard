// lib/ai-quote/channels/messenger.ts
// Meta (Facebook Page) Messenger adapter — Phase 1c. Mirrors channels/line.ts:
// pure parse/verify helpers exported for tests, I/O layer + buildMessengerAdapter
// at the bottom. Spec: docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md
import 'server-only';
import crypto from 'node:crypto';
import type { ChannelAdapter, InboundMessage, QuickReply } from './types';

/** Verify Meta webhook signature: header `X-Hub-Signature-256` =
 *  'sha256=' + hex(HMAC-SHA256(rawBody, FB_APP_SECRET)). Constant-time compare;
 *  returns false on any malformed input (never throws). */
export function verifyMessengerSignature(rawBody: string, signature: string, appSecret: string): boolean {
  if (!rawBody || !signature || !appSecret) return false;
  if (!signature.startsWith('sha256=')) return false;
  let expected: Buffer;
  let got: Buffer;
  try {
    expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
    got = Buffer.from(signature.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

interface MsgrMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };   // echo: sender = Page → ลูกค้าอยู่ที่ recipient
  message?: {
    is_echo?: boolean;
    app_id?: number | string;    // echo: app ที่ส่งข้อความนั้น (ไม่มี = Page inbox)
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { payload?: string };
}

/** Normalize a Meta Page webhook body → text/image/postback/staff-echo messages.
 *  Messenger is 1-on-1 by nature (no groups → sourceType always undefined).
 *  Echo events (page's own sends): with opts.ourAppId set, an echo whose
 *  app_id ≠ ours (or missing — Page inbox) = staff replied → 'staff-echo'
 *  carrying the CUSTOMER psid (recipient); our own echoes are skipped.
 *  Without ourAppId ALL echoes are skipped (fail-safe: misclassifying our own
 *  echo as staff would kick the user out of AI mode on every bot reply).
 *  quick_reply.payload beats message.text (title truncates at 20 chars).
 *  A text+attachment combo counts as text (spec: multi-turn image in AI mode
 *  is out of scope; slip images arrive alone). Never throws. */
export function parseMessengerEvents(body: unknown, opts?: { ourAppId?: string }): InboundMessage[] {
  const b = body as { object?: string; entry?: Array<{ messaging?: unknown }> };
  if (b?.object !== 'page' || !Array.isArray(b.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of b.entry) {
    const messaging = entry?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const raw of messaging as MsgrMessaging[]) {
      if (raw?.message?.is_echo) {
        const appId = raw.message.app_id == null ? null : String(raw.message.app_id);
        const customer = raw.recipient?.id;
        if (opts?.ourAppId && customer && appId !== opts.ourAppId) {
          out.push({ channel: 'messenger', kind: 'staff-echo', channelUserId: customer });
        }
        continue;   // echo ของบอทเอง / ourAppId ไม่ตั้ง / ไม่มี recipient → ทิ้ง
      }
      const psid = raw?.sender?.id;
      if (!psid) continue;
      const base = { channel: 'messenger' as const, channelUserId: psid };
      const text = raw.message?.quick_reply?.payload ?? raw.message?.text;
      if (typeof text === 'string' && text) {
        out.push({ ...base, kind: 'text', text });
        continue;
      }
      const image = raw.message?.attachments?.find((a) => a?.type === 'image' && a?.payload?.url);
      if (image?.payload?.url) {
        out.push({ ...base, kind: 'image', imageMessageId: image.payload.url });
        continue;
      }
      if (raw.postback?.payload) {
        out.push({ ...base, kind: 'postback', postbackData: raw.postback.payload });
      }
      // อื่นๆ (sticker/audio/file/delivery/read) → ทิ้ง
    }
  }
  return out;
}

// ─── Messenger I/O layer (Meta Send API — Graph v23.0) ───

const GRAPH_API = 'https://graph.facebook.com/v23.0';

function pageToken(): string {
  const t = process.env.FB_PAGE_TOKEN;
  if (!t) throw new Error('FB_PAGE_TOKEN missing');
  return t;
}

/** Pure: generic quick replies → Messenger quick_replies payload. label →
 *  title (Messenger truncates display at 20 chars); text → payload (full text
 *  comes back via quick_reply.payload — parse prefers it over the title). */
export function messengerQuickReplies(qrs?: QuickReply[]) {
  if (!qrs?.length) return undefined;
  return qrs.map((q) => ({ content_type: 'text', title: q.label, payload: q.text }));
}

/** Pure: build the Send API request body. message = plain text (string) or a
 *  ready-made Messenger message object (e.g. buildSlipMessenger output). */
export function buildMessengerSendBody(
  psid: string, message: string | object, qrs?: QuickReply[],
): Record<string, unknown> {
  const quick_replies = messengerQuickReplies(qrs);
  const msg = typeof message === 'string'
    ? { text: message, ...(quick_replies ? { quick_replies } : {}) }
    : { ...(message as Record<string, unknown>), ...(quick_replies ? { quick_replies } : {}) };
  return { recipient: { id: psid }, messaging_type: 'RESPONSE', message: msg };
}

/** ส่งข้อความหา PSID — Messenger ไม่มี reply token, reply = push เสมอ. */
export async function sendMessenger(psid: string, message: string | object, qrs?: QuickReply[]): Promise<void> {
  const res = await fetch(`${GRAPH_API}/me/messages?access_token=${encodeURIComponent(pageToken())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMessengerSendBody(psid, message, qrs)),
  });
  if (!res.ok) throw new Error(`Messenger send HTTP ${res.status}`);
}

/** ดึง bytes ของรูปจาก attachment CDN URL (ไม่ต้อง auth). URL หมดอายุได้ —
 *  เรียกทันทีที่ webhook มาถึงเท่านั้น ห้าม defer. */
export async function downloadMessengerImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Messenger content HTTP ${res.status}`);
  return res.blob();
}

/** Best-effort profile lookup (display name for lead cards / escalation Flex).
 *  Returns null on ANY failure — must never block the reply path. */
export async function getMessengerProfile(psid: string): Promise<{ displayName: string } | null> {
  try {
    const res = await fetch(`${GRAPH_API}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageToken())}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { first_name?: string; last_name?: string };
    const name = [body.first_name, body.last_name].filter(Boolean).join(' ').trim();
    return name ? { displayName: name } : null;
  } catch {
    return null;
  }
}

/** Build the Messenger ChannelAdapter (reply == push — no reply-token concept).
 *  ourAppId (FB_APP_ID) enables echo classification → 'staff-echo' (HINT-1);
 *  omitted = every echo skipped (fail-safe). */
export function buildMessengerAdapter(appSecret: string, ourAppId?: string): ChannelAdapter {
  return {
    verifySignature: (rawBody, sig) => verifyMessengerSignature(rawBody, sig, appSecret),
    parseEvents: (body) => parseMessengerEvents(body, { ourAppId }),
    downloadImage: (msg) => downloadMessengerImage(msg.imageMessageId!),
    reply: (msg, message, qrs) => sendMessenger(msg.channelUserId, message, qrs),
    push: (id, text) => sendMessenger(id, text),
  };
}
