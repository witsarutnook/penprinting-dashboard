import 'server-only';

/**
 * Side-effect module — runs ONCE at process start to copy known
 * Postgres-flavoured env vars into the names `@vercel/postgres` expects.
 *
 * Imported by `lib/postgres.ts` BEFORE the `@vercel/postgres` import so
 * that the package's module-init code sees the normalised env vars.
 *
 * Vercel marketplace lets users pick a custom prefix when connecting
 * Neon. Default is `STORAGE_*`, the legacy "Vercel Postgres" branded
 * one was `POSTGRES_*`, and a from-scratch Neon connect can use
 * `DATABASE_URL`. We detect any of these and normalise → `POSTGRES_*`.
 */

const ALIASES: readonly (readonly [string, ...string[]])[] = [
  // [target, ...sources] — first non-empty source wins
  ['POSTGRES_URL', 'POSTGRES_URL', 'STORAGE_URL', 'DATABASE_URL'],
  ['POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NON_POOLING', 'STORAGE_URL_NON_POOLING', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL'],
  ['POSTGRES_PRISMA_URL', 'POSTGRES_PRISMA_URL', 'STORAGE_PRISMA_URL', 'POSTGRES_URL'],
  ['POSTGRES_USER', 'POSTGRES_USER', 'STORAGE_USER'],
  ['POSTGRES_HOST', 'POSTGRES_HOST', 'STORAGE_HOST'],
  ['POSTGRES_PASSWORD', 'POSTGRES_PASSWORD', 'STORAGE_PASSWORD'],
  ['POSTGRES_DATABASE', 'POSTGRES_DATABASE', 'STORAGE_DATABASE'],
];

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
