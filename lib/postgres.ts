import 'server-only';
import { sql, db, createPool } from '@vercel/postgres';

/**
 * Vercel Postgres connection (Powered by Neon).
 *
 * PoC scope (2026-05-10): single-table audit_log mirror to measure
 * Sheet vs Postgres latency before committing to full migration.
 *
 * Vercel Storage → Connect Postgres auto-injects:
 *   POSTGRES_URL              — pooled connection (Edge + serverless)
 *   POSTGRES_PRISMA_URL       — pooled with pgbouncer (for Prisma)
 *   POSTGRES_URL_NON_POOLING  — direct connection (for migrations)
 *   POSTGRES_USER / HOST / PASSWORD / DATABASE — broken-out parts
 *
 * Without those env vars, every helper here returns `null` so dev /
 * preview / fork builds don't crash. Production routes that need the
 * DB must check `isPostgresConfigured()` before calling sql.
 */

export const POSTGRES_AVAILABLE = Boolean(process.env.POSTGRES_URL);

export function isPostgresConfigured(): boolean {
  return POSTGRES_AVAILABLE;
}

export { sql, db, createPool };
