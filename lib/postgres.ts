import 'server-only';

/**
 * Vercel Postgres connection (Powered by Neon).
 *
 * PoC scope (2026-05-10): single-table audit_log mirror to measure
 * Sheet vs Postgres latency before committing to full migration.
 *
 * Env var aliasing — Vercel's marketplace UI lets users pick a custom
 * prefix when connecting Neon. The default is `STORAGE_*`, the legacy
 * "Vercel Postgres" branded one was `POSTGRES_*`, and a from-scratch
 * Neon connect can use just `DATABASE_URL`. We detect any of these and
 * normalise to `POSTGRES_URL` so `@vercel/postgres` (which hard-codes
 * the lookup) sees what it expects, without forcing the user to re-do
 * the Vercel UI dance.
 *
 * Without any of these env vars, every helper returns `null` so dev /
 * preview / fork builds don't crash. Production routes that need the
 * DB must check `isPostgresConfigured()` before calling sql.
 */

const ALIASES = [
  // Format: [target, ...sources] — first non-empty source wins.
  ['POSTGRES_URL', 'POSTGRES_URL', 'STORAGE_URL', 'DATABASE_URL'],
  ['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NON_POOLING', 'STORAGE_URL_NON_POOLING', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL'],
  ['POSTGRES_PRISMA_URL', 'POSTGRES_PRISMA_URL', 'STORAGE_PRISMA_URL', 'POSTGRES_URL'],
  ['POSTGRES_USER', 'POSTGRES_USER', 'STORAGE_USER'],
  ['POSTGRES_HOST', 'POSTGRES_HOST', 'STORAGE_HOST'],
  ['POSTGRES_PASSWORD', 'POSTGRES_PASSWORD', 'STORAGE_PASSWORD'],
  ['POSTGRES_DATABASE', 'POSTGRES_DATABASE', 'STORAGE_DATABASE'],
] as const;

for (const [target, ...sources] of ALIASES) {
  if (!process.env[target]) {
    for (const src of sources) {
      const v = process.env[src];
      if (v) {
        process.env[target] = v;
        break;
      }
    }
  }
}

// Import @vercel/postgres AFTER the alias copy — the package reads env
// vars at module init, so it has to see the normalised names already in
// place. (Dynamic require keeps the alias step authoritative.)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vercelPg = require('@vercel/postgres') as typeof import('@vercel/postgres');
export const sql = vercelPg.sql;
export const db = vercelPg.db;
export const createPool = vercelPg.createPool;

export const POSTGRES_AVAILABLE = Boolean(process.env.POSTGRES_URL);

export function isPostgresConfigured(): boolean {
  return POSTGRES_AVAILABLE;
}
