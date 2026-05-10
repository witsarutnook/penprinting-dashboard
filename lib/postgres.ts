import 'server-only';
// Side-effect import: must run BEFORE @vercel/postgres so its module-init
// code sees the normalised env vars (POSTGRES_*) regardless of which prefix
// Vercel's marketplace UI assigned (STORAGE_*, DATABASE_URL, etc).
import './postgres-env-alias';
import { sql, db, createPool } from '@vercel/postgres';

/**
 * Vercel Postgres connection (Powered by Neon).
 *
 * PoC scope (2026-05-10): single-table audit_log mirror to measure
 * Sheet vs Postgres latency before committing to full migration.
 *
 * Without POSTGRES_URL (after the alias), every helper here returns
 * `null` so dev / preview / fork builds don't crash. Production routes
 * that need the DB must check `isPostgresConfigured()` before calling sql.
 */

export const POSTGRES_AVAILABLE = Boolean(process.env.POSTGRES_URL);

export function isPostgresConfigured(): boolean {
  return POSTGRES_AVAILABLE;
}

export { sql, db, createPool };
