import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for Peak OAuth tokens at rest.
 * Blob format: 'v1.<iv>.<tag>.<ciphertext>' — base64url parts, random 12-byte iv.
 * Key: base64 of exactly 32 bytes, from PEAK_TOKEN_ENC_KEY unless passed.
 * Error messages never include the key, the plaintext or the blob.
 */
export class PeakConfigError extends Error {
  // explicit: constructor.name is mangled by production minification
  name = 'PeakConfigError';
}

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(keyB64?: string): Buffer {
  const raw = keyB64 ?? process.env.PEAK_TOKEN_ENC_KEY;
  if (!raw) throw new PeakConfigError('PEAK_TOKEN_ENC_KEY is not set');
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length !== 32) {
    throw new PeakConfigError('PEAK_TOKEN_ENC_KEY must be base64 of exactly 32 bytes');
  }
  return key;
}

/** Throws PeakConfigError unless PEAK_TOKEN_ENC_KEY is set and valid (real loader). */
export function assertPeakKey(): void {
  loadKey();
}

export function encryptSecret(plain: string, keyB64?: string): string {
  const key = loadKey(keyB64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join(
    '.',
  );
}

export function decryptSecret(blob: string, keyB64?: string): string {
  const key = loadKey(keyB64);
  const parts = typeof blob === 'string' ? blob.split('.') : [];
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new PeakConfigError('encrypted token has an unknown format');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ct = Buffer.from(parts[3], 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new PeakConfigError('encrypted token has an unknown format');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new PeakConfigError('encrypted token could not be decrypted (wrong key or tampered)');
  }
}
