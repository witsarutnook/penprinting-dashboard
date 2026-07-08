// tests/ai-quote-messenger-signature.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyMessengerSignature } from '@/lib/ai-quote/channels/messenger';

const SECRET = 'test_app_secret';
function sign(body: string, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyMessengerSignature (X-Hub-Signature-256)', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"object":"page","entry":[]}';
    expect(verifyMessengerSignature(body, sign(body), SECRET)).toBe(true);
  });
  it('rejects a tampered body', () => {
    const body = '{"object":"page","entry":[]}';
    expect(verifyMessengerSignature('{"object":"page","entry":[1]}', sign(body), SECRET)).toBe(false);
  });
  it('rejects a signature without the sha256= prefix', () => {
    const body = '{}';
    const bare = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(verifyMessengerSignature(body, bare, SECRET)).toBe(false);
  });
  it('rejects empty / malformed signature and missing secret', () => {
    expect(verifyMessengerSignature('{}', '', SECRET)).toBe(false);
    expect(verifyMessengerSignature('{}', 'sha256=zznothex', SECRET)).toBe(false);
    expect(verifyMessengerSignature('{}', sign('{}'), '')).toBe(false);
  });
  it('rejects when secret is wrong', () => {
    const body = '{}';
    expect(verifyMessengerSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });
});
