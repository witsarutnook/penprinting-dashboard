/**
 * Shared mock for `next/cache`. Passthrough `unstable_cache` that records
 * each wrapper registration (keyParts + opts) and every invocation, so tests
 * can pin (a) that a loader is routed THROUGH a cache wrapper with the right
 * tags/revalidate, and (b) that other paths bypass it — without simulating
 * Next's actual cache semantics (that's the platform's contract).
 *
 * Usage in a test file:
 *   import { findCacheRegistration, resetCacheCalls } from './helpers/mock-next-cache';
 *   vi.mock('next/cache', () => import('./helpers/mock-next-cache'));
 *
 * Registrations happen once at module load of the code under test and are
 * intentionally NOT reset between tests — only the per-wrapper `calls` are
 * (call `resetCacheCalls()` in beforeEach).
 */

export interface CacheRegistration {
  keyParts: string[];
  opts: { tags?: string[]; revalidate?: number | false };
  /** Arguments of each invocation of the wrapped function. */
  calls: unknown[][];
}

const registrations: CacheRegistration[] = [];

export function unstable_cache<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  keyParts?: string[],
  opts?: { tags?: string[]; revalidate?: number | false },
): (...args: A) => Promise<R> {
  const reg: CacheRegistration = { keyParts: keyParts ?? [], opts: opts ?? {}, calls: [] };
  registrations.push(reg);
  return (...args: A) => {
    reg.calls.push(args);
    return fn(...args);
  };
}

export function revalidateTag(): void {}
export function revalidatePath(): void {}

// Test-side helpers ─────────────────────────────────────────────────

export function findCacheRegistration(key: string): CacheRegistration | undefined {
  return registrations.find((r) => r.keyParts.includes(key));
}

export function resetCacheCalls(): void {
  for (const r of registrations) r.calls.length = 0;
}
