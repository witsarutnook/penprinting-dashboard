// tests/smoke-core.test.mjs — unit tests for the post-deploy smoke shared core.
// scripts/smoke-core.mjs is a TWIN FILE (identical copy in penprinting-calc)
// — dashboard is the tested source of truth for both copies.
import { describe, it, expect, vi } from 'vitest';
import {
  compareFields,
  buildFailMessage,
  withRetry,
  runChecks,
} from '../scripts/smoke-core.mjs';

describe('compareFields', () => {
  it('returns [] when every expected field matches', () => {
    expect(
      compareFields({ unitPrice: 2.4, mode: 'offset' }, { unitPrice: 2.4, mode: 'offset', extra: 1 }),
    ).toEqual([]);
  });

  it('catches a 0.01 price drift (exact compare, no tolerance)', () => {
    expect(compareFields({ unitPrice: 2.4 }, { unitPrice: 2.41 })).toEqual([
      { path: 'unitPrice', expected: 2.4, actual: 2.41 },
    ]);
  });

  it('compares nested objects with dot paths', () => {
    const diffs = compareFields(
      { finishing: { coat: { unit: 0.5 } } },
      { finishing: { coat: { unit: 0.6 } } },
    );
    expect(diffs).toEqual([{ path: 'finishing.coat.unit', expected: 0.5, actual: 0.6 }]);
  });

  it('reports undefined for a missing field', () => {
    expect(compareFields({ boxes: 3 }, {})).toEqual([
      { path: 'boxes', expected: 3, actual: undefined },
    ]);
  });

  it('compares array values by content, not reference', () => {
    expect(compareFields({ tags: [1, 2, 3] }, { tags: [1, 2, 3] })).toEqual([]);
    expect(compareFields({ tags: [1, 2] }, { tags: [1, 3] })).toEqual([
      { path: 'tags', expected: [1, 2], actual: [1, 3] },
    ]);
  });
});

describe('buildFailMessage', () => {
  it('includes repo, every failure, hint, and run url', () => {
    const msg = buildFailMessage({
      repo: 'penprinting-calc',
      failures: [
        { name: 'price:namecard-2s-lam', detail: 'totalPrice: expected 500, got 480' },
        { name: 'auth-fail-closed-401', detail: 'POST → 200 (expected 401)' },
      ],
      runUrl: 'https://github.com/x/y/actions/runs/1',
      hint: 'ถ้าตั้งใจเปลี่ยนราคา → อัปเดต scripts/smoke-baselines.json แล้ว push',
    });
    expect(msg).toContain('penprinting-calc');
    expect(msg).toContain('price:namecard-2s-lam');
    expect(msg).toContain('expected 500, got 480');
    expect(msg).toContain('auth-fail-closed-401');
    expect(msg).toContain('smoke-baselines.json');
    expect(msg).toContain('actions/runs/1');
  });
});

describe('withRetry', () => {
  it('returns the value once an attempt succeeds', async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n < 3) throw new Error('transient');
      return 'ok';
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error after attempts are exhausted', async () => {
    const fn = vi.fn(async () => {
      throw new Error('down');
    });
    await expect(withRetry(fn, { attempts: 3, delayMs: 0 })).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('runChecks', () => {
  it('collects every failure and never stops early', async () => {
    const failures = await runChecks(
      [
        { name: 'a', run: async () => {} },
        { name: 'b', run: async () => { throw new Error('boom-b'); } },
        { name: 'c', run: async () => { throw new Error('boom-c'); } },
      ],
      { attempts: 1, delayMs: 0 },
    );
    expect(failures).toEqual([
      { name: 'b', detail: 'boom-b' },
      { name: 'c', detail: 'boom-c' },
    ]);
  });
});
