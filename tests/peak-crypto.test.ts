import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { PeakConfigError, decryptSecret, encryptSecret } from '@/lib/peak/crypto';

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

const ORIGINAL_ENV = process.env.PEAK_TOKEN_ENC_KEY;
afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.PEAK_TOKEN_ENC_KEY;
  else process.env.PEAK_TOKEN_ENC_KEY = ORIGINAL_ENV;
});

describe('encryptSecret / decryptSecret', () => {
  it('round-trips ASCII and Thai text', () => {
    for (const plain of ['eyJhbGciOi.abc-123_xyz', 'โทเค็นภาษาไทย ทดสอบ', '']) {
      expect(decryptSecret(encryptSecret(plain, KEY), KEY)).toBe(plain);
    }
  });

  it('output starts with v1. and has 4 base64url parts', () => {
    const blob = encryptSecret('hello', KEY);
    expect(blob.startsWith('v1.')).toBe(true);
    const parts = blob.split('.');
    expect(parts).toHaveLength(4);
    for (const p of parts.slice(1, 3)) expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(blob).not.toContain('hello');
  });

  it('two encryptions of the same text differ (random iv)', () => {
    expect(encryptSecret('same', KEY)).not.toBe(encryptSecret('same', KEY));
  });

  it('tampered ciphertext -> PeakConfigError', () => {
    const blob = encryptSecret('secret-value', KEY);
    const [v, iv, tag, ct] = blob.split('.');
    const buf = Buffer.from(ct, 'base64url');
    buf[0] ^= 0xff;
    const tampered = [v, iv, tag, buf.toString('base64url')].join('.');
    expect(() => decryptSecret(tampered, KEY)).toThrow(PeakConfigError);
  });

  it('wrong key / bad format -> PeakConfigError', () => {
    const blob = encryptSecret('secret-value', KEY);
    expect(() => decryptSecret(blob, OTHER_KEY)).toThrow(PeakConfigError);
    expect(() => decryptSecret('not-a-blob', KEY)).toThrow(PeakConfigError);
    expect(() => decryptSecret('v2.a.b.c', KEY)).toThrow(PeakConfigError);
  });

  it('key that is not 32 bytes -> PeakConfigError', () => {
    const short = randomBytes(16).toString('base64');
    expect(() => encryptSecret('x', short)).toThrow(PeakConfigError);
    expect(() => decryptSecret(encryptSecret('x', KEY), short)).toThrow(PeakConfigError);
  });

  it('uses PEAK_TOKEN_ENC_KEY from env; missing env -> PeakConfigError', () => {
    process.env.PEAK_TOKEN_ENC_KEY = KEY;
    const blob = encryptSecret('from-env');
    expect(decryptSecret(blob, KEY)).toBe('from-env');
    expect(decryptSecret(blob)).toBe('from-env');
    delete process.env.PEAK_TOKEN_ENC_KEY;
    expect(() => encryptSecret('x')).toThrow(PeakConfigError);
    expect(() => decryptSecret(blob)).toThrow(PeakConfigError);
  });

  it('error messages never contain the key or plaintext', () => {
    const blob = encryptSecret('PLAINTEXT-SENTINEL', KEY);
    const err = (() => {
      try {
        decryptSecret(blob, OTHER_KEY);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(err?.message).not.toContain('PLAINTEXT-SENTINEL');
    expect(err?.message).not.toContain(OTHER_KEY);
  });
});

import { it as itName, expect as expectName } from 'vitest';
itName('error class names are stable (survive minification)', async () => {
  expectName(new (await import('@/lib/peak/crypto')).PeakConfigError('m').name).toBe('PeakConfigError');
  expectName(new (await import('@/lib/peak/crypto')).PeakConfigError('m')).toBeInstanceOf(Error);
});

import { assertPeakKey } from '@/lib/peak/crypto';
itName('assertPeakKey validates the env key with the real loader', () => {
  const old = process.env.PEAK_TOKEN_ENC_KEY;
  try {
    delete process.env.PEAK_TOKEN_ENC_KEY;
    expectName(() => assertPeakKey()).toThrow(PeakConfigError);
    process.env.PEAK_TOKEN_ENC_KEY = 'c2hvcnQ=';
    expectName(() => assertPeakKey()).toThrow(PeakConfigError);
    process.env.PEAK_TOKEN_ENC_KEY = Buffer.alloc(32, 1).toString('base64');
    expectName(() => assertPeakKey()).not.toThrow();
  } finally {
    if (old === undefined) delete process.env.PEAK_TOKEN_ENC_KEY;
    else process.env.PEAK_TOKEN_ENC_KEY = old;
  }
});
