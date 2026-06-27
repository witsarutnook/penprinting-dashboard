// lib/ai-quote/channels/line.ts
import 'server-only';
import crypto from 'node:crypto';

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
