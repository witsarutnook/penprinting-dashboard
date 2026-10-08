import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queueResult, resetMockPostgres } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadOrderFromPostgres } from '@/lib/api-postgres';
import { OrderNotFoundError, PostgresReadError } from '@/lib/postgres-errors';

/**
 * Audit H1 (2026-10-08): `loadOrder` THROWS when the order row is missing —
 * it never resolves `{ order: null }`. Every caller that branched on
 * `!order` (LINE /track, /api/track/lookup, print, tracking-card,
 * /api/orders/raw) was dead code, so a mistyped order id reached the
 * generic 502 / "no reply" path instead of the not-found copy. The fix is
 * a typed error so callers can tell "no such order" from "Postgres down"
 * without matching on message text.
 */
describe('loadOrderFromPostgres — order row missing', () => {
  beforeEach(() => resetMockPostgres());

  it('orderOnly: throws OrderNotFoundError carrying the id (still a PostgresReadError for existing catch sites)', async () => {
    queueResult({ rows: [], rowCount: 0 });

    const err = await loadOrderFromPostgres(202609999, { orderOnly: true }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OrderNotFoundError);
    expect(err).toBeInstanceOf(PostgresReadError);
    expect((err as OrderNotFoundError).orderId).toBe(202609999);
  });

  it('full shape: the same typed error when the order row is missing', async () => {
    queueResult({ rows: [], rowCount: 0 }); // orders — jobs/shipped/cancelled default to empty

    await expect(loadOrderFromPostgres(202609999)).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});
