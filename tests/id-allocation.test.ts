import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockPostgres,
  queueResult,
  setConfigured,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { mintJobId, mintJobIds, mintOrderId, IdAllocationError } from '@/lib/id-allocation';

/** Current Bangkok month as YYYYMM — mirrors the lib's bangkokYYYYMM(). */
function expectedYYYYMM(): number {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  return Number(s.slice(0, 7).replace('-', ''));
}

describe('mintJobId', () => {
  beforeEach(() => resetMockPostgres());

  it('throws IdAllocationError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(mintJobId()).rejects.toBeInstanceOf(IdAllocationError);
  });

  it('returns the id from the atomic UPDATE...RETURNING', async () => {
    queueResult({ rows: [{ id: '1051' }], rowCount: 1 });
    const id = await mintJobId();
    expect(id).toBe(1051);
    // The mint must be an atomic increment, not a read-then-write.
    expect(callsContaining('UPDATE counters SET value = value + 1')).toHaveLength(1);
  });

  it('throws when the nextId counter row is missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await expect(mintJobId()).rejects.toThrow(/counters\.nextId row missing/);
  });
});

describe('mintJobIds', () => {
  beforeEach(() => resetMockPostgres());

  it('returns [] for count <= 0 without touching Postgres', async () => {
    expect(await mintJobIds(0)).toEqual([]);
    expect(await mintJobIds(-3)).toEqual([]);
  });

  it('rejects a batch larger than 100', async () => {
    await expect(mintJobIds(101)).rejects.toBeInstanceOf(IdAllocationError);
  });

  it('returns N contiguous ids ending one below the bumped counter', async () => {
    // counter AFTER a +3 bump = 1054 → allocated [1051, 1052, 1053]
    queueResult({ rows: [{ value: '1054' }], rowCount: 1 });
    const ids = await mintJobIds(3);
    expect(ids).toEqual([1051, 1052, 1053]);
    expect(callsContaining('value + $1')).toHaveLength(1);
  });

  it('throws when the counter row is missing', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await expect(mintJobIds(2)).rejects.toThrow(/counters\.nextId row missing/);
  });
});

describe('mintOrderId', () => {
  beforeEach(() => resetMockPostgres());

  it('throws IdAllocationError when Postgres is not configured', async () => {
    setConfigured(false);
    await expect(mintOrderId()).rejects.toBeInstanceOf(IdAllocationError);
  });

  it('returns YYYYMM-prefixed id from the month counter + cross-check bump', async () => {
    queueResult({ rows: [], rowCount: 0 });          // INSERT ... ON CONFLICT DO NOTHING
    queueResult({ rows: [{ value: '7' }], rowCount: 1 }); // UPDATE ... RETURNING
    const id = await mintOrderId();
    expect(id).toBe(expectedYYYYMM() * 1000 + 7);
    // 9-digit format YYYYMMNNN — unchanged from getNextOrderId, so existing
    // QR codes / track links stay valid.
    expect(String(id)).toMatch(/^\d{9}$/);
  });

  it('keys the counter per-month and ensures the row exists first', async () => {
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [{ value: '1' }], rowCount: 1 });
    await mintOrderId();
    const key = `orderCounter_${expectedYYYYMM()}`;
    // Row-ensure INSERT runs before the bumping UPDATE.
    expect(callsContaining('INSERT INTO counters')).toHaveLength(1);
    expect(callsContaining('GREATEST')).toHaveLength(1);
    expect(callsContaining('INSERT INTO counters')[0].values).toContain(key);
  });
});
