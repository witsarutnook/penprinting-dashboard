// lib/ai-quote/channels/line.ts
import 'server-only';
import crypto from 'node:crypto';
import type { ChannelAdapter, InboundMessage, OutboundMessage, QuickReply } from './types';

interface LineSource { type?: string; userId?: string; groupId?: string; roomId?: string }
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

/** Normalize a LINE webhook body → text/image/postback messages.
 *  1-on-1 (user) sources get the full pipeline (slip/track/ai). Group/room sources
 *  emit text only (carrying groupId/roomId) so explicit commands work in shared chats
 *  (/groupid echoes the id, /track <id> shows a status card) — images/postback in
 *  groups are ignored. Unsupported types (sticker/location/...) dropped. Never throws. */
export function parseLineEvents(body: unknown): InboundMessage[] {
  const events = (body as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: InboundMessage[] = [];
  for (const raw of events as LineEvent[]) {
    const src = raw?.source;
    if (!src) continue;
    const isText = raw.type === 'message' && raw.message?.type === 'text' && typeof raw.message.text === 'string';

    if (src.type === 'group' && src.groupId) {
      if (isText) {
        out.push({
          channel: 'line', channelUserId: src.userId ?? '', kind: 'text',
          text: raw.message!.text!, replyToken: raw.replyToken,
          sourceType: 'group', groupId: src.groupId,
        });
      }
      continue;   // group → text only (for /groupid)
    }
    if (src.type === 'room' && src.roomId) {
      if (isText) {
        out.push({
          channel: 'line', channelUserId: src.userId ?? '', kind: 'text',
          text: raw.message!.text!, replyToken: raw.replyToken,
          sourceType: 'room', roomId: src.roomId,
        });
      }
      continue;   // room → text only (for /groupid)
    }

    if (src.type !== 'user' || !src.userId) continue;   // 1-on-1 only beyond this point
    const base = { channel: 'line' as const, channelUserId: src.userId, replyToken: raw.replyToken };
    if (isText) {
      out.push({ ...base, kind: 'text', text: raw.message!.text! });
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

/** Best-effort LINE profile lookup (display name for lead cards / escalation
 *  Flex). Returns null on ANY failure — must never block the reply path. */
export async function getLineProfile(userId: string): Promise<{ displayName: string } | null> {
  try {
    const res = await fetch(`${LINE_API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { displayName?: string };
    return body.displayName ? { displayName: body.displayName } : null;
  } catch {
    return null;
  }
}

function quickReplyPayload(qrs?: QuickReply[]) {
  if (!qrs?.length) return undefined;
  return { items: qrs.map((q) => ({ type: 'action', action: { type: 'message', label: q.label, text: q.text } })) };
}

/** LINE reply/push API รับได้สูงสุด 5 messages ต่อครั้ง. */
export const LINE_MAX_MESSAGES = 5;

/** Pure: shape the `messages` array for LINE reply/push. string → text message ·
 *  object → as-is · order kept · quickReply ติดตัวสุดท้ายเท่านั้น · เกิน 5 → เก็บ 4 ตัวแรก
 *  + ตัวสุดท้าย (ตัวสุดท้ายคือข้อความตอบ ต้องรอดเสมอ). Never mutates the inputs. */
export function buildLineMessages(
  message: OutboundMessage | OutboundMessage[], qrs?: QuickReply[],
): Record<string, unknown>[] {
  const list = Array.isArray(message) ? message : [message];
  const capped = list.length > LINE_MAX_MESSAGES
    ? [...list.slice(0, LINE_MAX_MESSAGES - 1), list[list.length - 1]]
    : list;
  const out = capped.map((m): Record<string, unknown> =>
    typeof m === 'string' ? { type: 'text', text: m } : (m as Record<string, unknown>));
  const qrp = quickReplyPayload(qrs);
  if (qrp && out.length) out[out.length - 1] = { ...out[out.length - 1], quickReply: qrp };
  return out;
}

/** ตอบกลับด้วย reply token (ฟรี). message = text / flex object / array (≤5, ดู buildLineMessages). */
export async function replyLine(
  replyToken: string, message: OutboundMessage | OutboundMessage[], qrs?: QuickReply[],
): Promise<void> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: buildLineMessages(message, qrs) }),
  });
  if (!res.ok) throw new Error(`LINE reply HTTP ${res.status}`);
}

/** Push by userId (เผื่อ reply token หมด / แจ้งทีหลัง). */
export async function pushLine(to: string, message: OutboundMessage | OutboundMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, messages: buildLineMessages(message) }),
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
      // group/room → push to the group/room id; 1-on-1 → push to the user id
      await pushLine(msg.groupId || msg.roomId || msg.channelUserId, message);
    },
    push: (id, message) => pushLine(id, message),
  };
}
