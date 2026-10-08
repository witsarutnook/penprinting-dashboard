/**
 * Typed read errors for the Postgres surface — kept in a dependency-free
 * module so routers and pages can `instanceof` them without importing
 * `@/lib/postgres` (which is `server-only` and opens the pool on demand).
 *
 * `lib/api-postgres` re-exports both, so existing
 * `import { PostgresReadError } from '@/lib/api-postgres'` sites keep working.
 */

export class PostgresReadError extends Error {
  constructor(reason: string) {
    super(`Postgres read failed: ${reason}`);
    this.name = 'PostgresReadError';
  }
}

/** The order row does not exist. A subclass of `PostgresReadError` so every
 *  catch that already treated "not found" as a read failure keeps its
 *  behaviour; callers that own a 404 (LINE /track, /api/track/lookup, print,
 *  tracking-card, /api/orders/raw) match on this class instead of the
 *  message text (audit H1, 2026-10-08). */
export class OrderNotFoundError extends PostgresReadError {
  readonly orderId: number;
  constructor(orderId: number | string) {
    super(`order ${orderId} not found in Postgres`);
    this.name = 'OrderNotFoundError';
    this.orderId = Number(orderId);
  }
}
