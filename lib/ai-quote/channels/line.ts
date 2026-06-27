// lib/ai-quote/channels/line.ts
import 'server-only';
import crypto from 'node:crypto';
import type { ChannelAdapter, InboundMessage, QuickReply } from './types';

interface LineSource { type?: string; userId?: string }
interface LineMessage { type?: string; text?: string; id?: string }
interface LineEvent {
  type?: string; replyToken?: string;
  source?: LineSource; message?: LineMessage; postback?: { data?: string };
}

/** Verify LINE webhook signature: base64(HMAC-SHA256(rawBody, secret)) === header.
 *  Constant-time compare; returns false on any malformed input (never throws). */
export function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!rawBody || !signature || !secret) return false;
  let expected: Buffer;
  let got: Buffer;
  try {
    expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest();
    got = Buffer.from(signature, 'base64');
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}

/** Normalize a LINE webhook body → 1-on-1 text/image/postback messages.
 *  Ignores group/room sources and unsupported message types. Never throws. */
export function parseLineEvents(body: unknown): InboundMessage[] {
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: InboundMessage[] = [];
  for (const raw of events as LineEvent[]) {
    const src = raw?.source;
    if (!src || src.type !== 'user' || !src.userId) continue;   // 1-on-1 only
    const base = { channel: 'line' as const, channelUserId: src.userId, replyToken: raw.replyToken };
    if (raw.type === 'message' && raw.message?.type === 'text' && typeof raw.message.text === 'string') {
      out.push({ ...base, kind: 'text', text: raw.message.text });
    } else if (raw.type === 'message' && raw.message?.type === 'image' && raw.message.id) {
      out.push({ ...base, kind: 'image', imageMessageId: raw.message.id });
    } else if (raw.type === 'postback' && raw.postback?.data) {
      out.push({ ...base, kind: 'postback', postbackData: raw.postback.data });
    }
    // อื่นๆ (sticker/location/follow/...) → ทิ้ง
  }
  return out;
}

// ─── LINE I/O layer ───

const LINE_API = 'https://api.line.me/v2/bot';
const LINE_DATA_API = 'https://api-data.line.me/v2/bot';

function token(): string {
  const t = process.env.LINE_CHANNEL_TOKEN;
  if (!t) throw new Error('LINE_CHANNEL_TOKEN missing');
  return t;
}

/** ดึง bytes ของรูปจาก LINE content API → Blob (สำหรับ Thunder + base64 ให้ Haiku). */
export async function downloadLineImage(messageId: string): Promise<Blob> {
  const res = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error(`LINE content HTTP ${res.status}`);
  return res.blob();
}

function quickReplyPayload(qrs?: QuickReply[]) {
  if (!qrs?.length) return undefined;
  return { items: qrs.map((q) => ({ type: 'action', action: { type: 'message', label: q.label, text: q.text } })) };
}

/** ตอบกลับด้วย reply token (ฟรี). messages = text หรือ flex object. */
export async function replyLine(replyToken: string, message: string | object, qrs?: QuickReply[]): Promise<void> {
  const qrp = quickReplyPayload(qrs);
  const msg = typeof message === 'string'
    ? { type: 'text', text: message, ...(qrp ? { quickReply: qrp } : {}) }
    : message;
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [msg] }),
  });
  if (!res.ok) throw new Error(`LINE reply HTTP ${res.status}`);
}

/** Push by userId (เผื่อ reply token หมด / แจ้งทีหลัง). */
export async function pushLine(to: string, message: string | object): Promise<void> {
  const msg = typeof message === 'string' ? { type: 'text', text: message } : message;
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, messages: [msg] }),
  });
  if (!res.ok) throw new Error(`LINE push HTTP ${res.status}`);
}

/** Build the LINE ChannelAdapter (reply tries reply-token first, falls back to push). */
export function buildLineAdapter(secret: string): ChannelAdapter {
  return {
    verifySignature: (rawBody, sig) => verifyLineSignature(rawBody, sig, secret),
    parseEvents: parseLineEvents,
    downloadImage: (msg) => downloadLineImage(msg.imageMessageId!),
    reply: async (msg, message, qrs) => {
      try {
        if (msg.replyToken) { await replyLine(msg.replyToken, message, qrs); return; }
      } catch { /* token หมด/ใช้แล้ว → push */ }
      await pushLine(msg.channelUserId, message);
    },
    push: (id, text) => pushLine(id, text),
  };
}
