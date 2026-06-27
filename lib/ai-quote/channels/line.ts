// lib/ai-quote/channels/line.ts
import 'server-only';
import crypto from 'node:crypto';
import type { InboundMessage } from './types';

interface LineSource { type?: string; userId?: string }
interface LineMessage { type?: string; text?: string; id?: string }
interface LineEvent {
  type?: string; replyToken?: string;
  source?: LineSource; message?: LineMessage; postback?: { data?: string };
}

/** Verify LINE webhook signature: base64(HMAC-SHA256(rawBody, secret)) === header.
 *  Constant-time compare; returns false on any malformed input (never throws). */
export function verifyLineSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
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
