import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { PostgresReadError } from '@/lib/api-postgres';

/**
 * /archive search — all-years order lookup straight from Postgres.
 *
 * Replaces the Apps Script `searchArchive` action (§13, 2026-09-05). That
 * action only ever scanned Sheet tabs named `*_archive_*`, which were never
 * created (the system is younger than the 365-day archive rule and the Sheet
 * froze 2026-05-18), so the page had returned nothing since the port.
 * Postgres holds every order ever mirrored or written; the 12-month
 * `LIST_WINDOW` in lib/board-delta.ts is a read-side window only — this
 * module deliberately ignores it.
 *
 * Search is `ILIKE` over the explicit `orders` columns (name / customer /
 * orderer) plus an id-prefix arm for all-digit queries ("2025" → every order
 * of 2025). No tsvector: Thai has no word boundaries, so substring match is
 * the behaviour users expect.
 */

export const ARCHIVE_MIN_QUERY_LENGTH = 2;
export const ARCHIVE_DEFAULT_LIMIT = 100;
export const ARCHIVE_MAX_LIMIT = 500;

/** Trim + collapse whitespace. Returns null when the query is too short to
 *  search (the page shows the "อย่างน้อย 2 ตัวอักษร" hint). Not escaped —
 *  this is the string the user sees echoed back in the results banner. */
export function normalizeArchiveQuery(raw: string | null | undefined): string | null {
  const q = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (Array.from(q).length < ARCHIVE_MIN_QUERY_LENGTH) return null;
  return q;
}

/** Escape LIKE metacharacters so user input never becomes a wildcard.
 *  Pairs with `ESCAPE '\'` in the SQL below. */
export function escapeLikePattern(q: string): string {
  return q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Silence unused-import lint until Task 2 wires the query.
void sql;
void isPostgresConfigured;
void PostgresReadError;
