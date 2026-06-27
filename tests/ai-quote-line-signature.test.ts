// tests/ai-quote-line-signature.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyLineSignature } from '@/lib/ai-quote/channels/line';

const SECRET = 'test_channel_secret';
function sign(body: string, secret = SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyLineSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(body, sign(body), SECRET)).toBe(true);
  });
  it('rejects a tampered body', () => {
    const body = '{"events":[]}';
    const sig = sign(body);
    expect(verifyLineSignature('{"events":[1]}', sig, SECRET)).toBe(false);
  });
  it('rejects an empty / malformed signature', () => {
    expect(verifyLineSignature('{}', '', SECRET)).toBe(false);
    expect(verifyLineSignature('{}', 'not-base64!!', SECRET)).toBe(false);
  });
  it('rejects when secret is wrong', () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });
});
