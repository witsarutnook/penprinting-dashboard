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
  message?: {
    is_echo?: boolean;
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { payload?: string };
}

/** Normalize a Meta Page webhook body → text/image/postback messages.
 *  Messenger is 1-on-1 by nature (no groups → sourceType always undefined).
 *  Echo events (page's own sends, incl. staff replying from Page inbox) are
 *  skipped — we also do NOT subscribe to message_echoes; this is defense in
 *  depth. quick_reply.payload beats message.text (title truncates at 20 chars).
 *  A text+attachment combo counts as text (spec: multi-turn image in AI mode
 *  is out of scope; slip images arrive alone). Never throws. */
export function parseMessengerEvents(body: unknown): InboundMessage[] {
  const b = body as { object?: string; entry?: Array<{ messaging?: unknown }> };
  if (b?.object !== 'page' || !Array.isArray(b.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of b.entry) {
    const messaging = entry?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const raw of messaging as MsgrMessaging[]) {
      const psid = raw?.sender?.id;
      if (!psid) continue;
      if (raw.message?.is_echo) continue;   // page's own message → never process
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
