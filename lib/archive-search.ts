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

export interface ArchiveOrderRow {
  id: number;
  name: string;
  customer: string;
  orderer: string;
  /** DD/MM/YYYY as stored — render through lib/jobs displayDate(). */
  dateIn: string;
  dateDue: string;
  price: string;
  status: string;
  /** Latest shipped row for this order (by shipped.id), null when never shipped. */
  shippedDate: string | null;
  /** Latest cancelled row for this order (by cancelled.id). */
  cancelledAt: string | null;
  cancelledReason: string | null;
}

export interface ArchiveSearchResult {
  rows: ArchiveOrderRow[];
  /** Matching rows in the whole table (COUNT(*) OVER()), not just the page. */
  total: number;
  /** true when total > rows.length — the page tells the user to narrow the query. */
  truncated: boolean;
}

interface ArchiveSqlRow {
  id: number | string;
  name: string | null;
  customer: string | null;
  orderer: string | null;
  date_in: string | null;
  date_due: string | null;
  price: string | null;
  status: string | null;
  shipped_date: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  total: number | string;
}

/** All-years order search. ONE round-trip: the window-function `total`
 *  rides along on every row, so no second COUNT query. Not cached — admin
 *  only, per-query, low traffic. */
export async function searchArchiveOrders(
  q: string,
  opts: { limit?: number } = {},
): Promise<ArchiveSearchResult> {
  if (!isPostgresConfigured()) throw new PostgresReadError('not configured');

  const limit = Math.min(
    ARCHIVE_MAX_LIMIT,
    Math.max(1, Math.floor(opts.limit ?? ARCHIVE_DEFAULT_LIMIT)),
  );
  const pattern = `%${escapeLikePattern(q)}%`;
  // All-digit query → also match the order id by prefix. Order ids are
  // YYYYMM*1000+seq, so "2025" finds every 2025 order and "202509" one month.
  const isNumeric = /^\d+$/.test(q);
  const idPrefix = isNumeric ? `${q}%` : '';

  const r = await sql<ArchiveSqlRow>`
    SELECT o.id, o.name, o.customer, o.orderer, o.date_in, o.date_due, o.price, o.status,
           s.shipped_date, c.cancelled_at, c.reason AS cancelled_reason,
           COUNT(*) OVER() AS total
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT shipped_date FROM shipped WHERE order_id = o.id ORDER BY id DESC LIMIT 1
    ) s ON TRUE
    LEFT JOIN LATERAL (
      SELECT cancelled_at, reason FROM cancelled WHERE order_id = o.id ORDER BY id DESC LIMIT 1
    ) c ON TRUE
    WHERE o.name ILIKE ${pattern} ESCAPE '\\'
       OR o.customer ILIKE ${pattern} ESCAPE '\\'
       OR o.orderer ILIKE ${pattern} ESCAPE '\\'
       OR (${isNumeric}::boolean AND o.id::text LIKE ${idPrefix})
    ORDER BY o.id DESC
    LIMIT ${limit}
  `;

  const rows: ArchiveOrderRow[] = r.rows.map((row) => ({
    id: Number(row.id),
    name: row.name ?? '',
    customer: row.customer ?? '',
    orderer: row.orderer ?? '',
    dateIn: row.date_in ?? '',
    dateDue: row.date_due ?? '',
    price: row.price ?? '',
    status: row.status ?? '',
    shippedDate: row.shipped_date ?? null,
    cancelledAt: row.cancelled_at ?? null,
    cancelledReason: row.cancelled_reason ?? null,
  }));
  const total = Number(r.rows[0]?.total ?? 0);
  return { rows, total, truncated: total > rows.length };
}
