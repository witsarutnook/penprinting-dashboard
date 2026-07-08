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
