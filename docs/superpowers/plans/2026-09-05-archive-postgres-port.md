# §13 Archive Postgres Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/archive` ค้นใบสั่งงานทุกปีจาก Postgres แทน Apps Script `searchArchive` แล้วถอด Apps Script client ออกจาก dashboard ทั้งก้อน (§15 ขั้นแรก)

**Architecture:** ไฟล์ใหม่ `lib/archive-search.ts` = pure helpers (normalize / escape / state precedence) + query เดียว `searchArchiveOrders` (orders `ILIKE` + `LEFT JOIN LATERAL` สถานะล่าสุด + `COUNT(*) OVER()`). หน้า `/archive` เปลี่ยน data source เป็นฟังก์ชันนี้ แล้ว `lib/api.ts` เหลือเฉพาะ Postgres readers — ทุก `instanceof AppsScriptError` ถูกกวาดออก. Spec: [docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md](../specs/2026-09-05-archive-postgres-port-design.md)

**Tech Stack:** Next.js 15 App Router (server components) · `@vercel/postgres` `sql` tagged template · vitest + `tests/helpers/mock-postgres` · Tailwind 3

**Conventions repo นี้ (อ่านก่อนเริ่ม):**
- pre-commit hook รัน `type-check + lint + vitest` ทุก commit (~1-2 นาที) — commit ไม่ผ่าน = แก้ก่อน ห้าม `--no-verify`
- คำสั่ง `git`/`npm`/`npx` ถูก hook rewrite เป็น `rtk ...` อัตโนมัติ — output ถูกย่อ. ถ้าผลดูแปลก (เช่น "PASS (0)") ให้รันซ้ำด้วย `rtk proxy <คำสั่งเดิม>` เพื่อดู output ดิบ
- **เช็ค exit code ของ test แยกคำสั่ง** — ห้าม `vitest | grep && git commit` (grep กลืน exit code)
- ห้ามแตะ `.obsidian/` ใน workspace root
- ตอบ/เขียน doc เป็นภาษาไทย, เรียก user ว่า "คุณนุ๊ก"

**File map:**

| ไฟล์ | บทบาท |
|---|---|
| Create `lib/archive-search.ts` | normalize + escape + `searchArchiveOrders` + `archiveRowState` |
| Create `tests/archive-search.test.ts` | unit tests ทั้งไฟล์ข้างบน (mock Postgres) |
| Modify `app/archive/page.tsx` | data source → Postgres, ตารางเดียว + pill + ลิงก์ |
| Modify `app/shipped/page.tsx`, `app/cancelled/page.tsx` | L4 hint (ข้อความ + ลิงก์ admin) |
| Modify `lib/api.ts` | ลบ AS client (post/searchArchive/AppsScriptError/currentActor/getApiBase) |
| Modify 8 ไฟล์ที่ `instanceof AppsScriptError` | sweep + `/api/audit` map `PostgresReadError` → 503 |
| Modify docs (dashboard + workspace) | sweep สถานะ Apps Script + L4 closed |

---

### Task 1: `normalizeArchiveQuery` + `escapeLikePattern` (pure)

**Files:**
- Create: `lib/archive-search.ts`
- Create: `tests/archive-search.test.ts`

- [ ] **Step 1: Write the failing tests**

สร้าง `tests/archive-search.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  queueResult,
  resetMockPostgres,
  setConfigured,
  sqlCalls,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  normalizeArchiveQuery,
  escapeLikePattern,
} from '@/lib/archive-search';

describe('normalizeArchiveQuery', () => {
  it('returns null for empty / undefined / whitespace-only input', () => {
    expect(normalizeArchiveQuery(undefined)).toBeNull();
    expect(normalizeArchiveQuery(null)).toBeNull();
    expect(normalizeArchiveQuery('')).toBeNull();
    expect(normalizeArchiveQuery('   ')).toBeNull();
  });

  it('returns null when shorter than 2 characters after trim', () => {
    expect(normalizeArchiveQuery(' a ')).toBeNull();
    expect(normalizeArchiveQuery('ก')).toBeNull();
  });

  it('keeps exactly 2 characters', () => {
    expect(normalizeArchiveQuery('ab')).toBe('ab');
    expect(normalizeArchiveQuery('ใบ')).toBe('ใบ');
  });

  it('trims and collapses internal whitespace', () => {
    expect(normalizeArchiveQuery('  ใบปลิว   ซุปเปอร์ ')).toBe('ใบปลิว ซุปเปอร์');
    expect(normalizeArchiveQuery('a\t\nb')).toBe('a b');
  });
});

describe('escapeLikePattern', () => {
  it('escapes backslash, percent and underscore', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_b')).toBe('a\\_b');
    expect(escapeLikePattern('c\\d')).toBe('c\\\\d');
  });

  it('leaves normal text untouched', () => {
    expect(escapeLikePattern('ใบปลิว ซุปเปอร์')).toBe('ใบปลิว ซุปเปอร์');
  });
});

// keep imports used — later tasks add the searchArchiveOrders / archiveRowState suites
void queueResult; void resetMockPostgres; void setConfigured; void sqlCalls; void beforeEach;
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: FAIL — `Failed to resolve import "@/lib/archive-search"` (module ไม่มี). ถ้า output จาก rtk อ่านไม่ออก รัน `rtk proxy npx vitest run tests/archive-search.test.ts`

- [ ] **Step 3: Write the minimal implementation**

สร้าง `lib/archive-search.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/archive-search.ts tests/archive-search.test.ts
git commit -m "feat(archive): query normalizer + LIKE escaping for the Postgres archive search (§13)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: pre-commit hook เขียว (type-check + lint + 641 tests)

---

### Task 2: `searchArchiveOrders` — one round-trip query + mapping

**Files:**
- Modify: `lib/archive-search.ts`
- Modify: `tests/archive-search.test.ts`

- [ ] **Step 1: Write the failing tests**

ใน `tests/archive-search.test.ts` แก้ import ให้เพิ่ม `searchArchiveOrders` และ **ลบบรรทัด `void queueResult; ...` ท้ายไฟล์** แล้วต่อท้ายไฟล์ด้วย:

```ts
import { searchArchiveOrders } from '@/lib/archive-search';
import { PostgresReadError } from '@/lib/api-postgres';

/** One row in the shape the SQL returns (snake_case, pg strings). */
function sqlRow(over: Record<string, unknown> = {}) {
  return {
    id: '202503012',
    name: 'ใบปลิวซุปเปอร์',
    customer: 'ร้านค้า A',
    orderer: 'nook',
    date_in: '01/03/2025',
    date_due: '05/03/2025',
    price: '1500',
    status: 'sent',
    shipped_date: null,
    cancelled_at: null,
    cancelled_reason: null,
    total: '1',
    ...over,
  };
}

describe('searchArchiveOrders', () => {
  beforeEach(() => resetMockPostgres());

  it('throws PostgresReadError when Postgres is not configured (no SQL issued)', async () => {
    setConfigured(false);
    await expect(searchArchiveOrders('ใบปลิว')).rejects.toBeInstanceOf(PostgresReadError);
    expect(sqlCalls).toHaveLength(0);
  });

  it('issues exactly one query with an escaped %…% pattern and ESCAPE clause', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('ใบปลิว 100%_x');
    expect(sqlCalls).toHaveLength(1);
    const call = sqlCalls[0];
    expect(call.text).toContain("ESCAPE '\\'");
    expect(call.text).toContain('COUNT(*) OVER()');
    expect(call.text).toContain('LEFT JOIN LATERAL');
    // pattern bound 3× (name / customer / orderer) — every copy escaped
    const patterns = call.values.filter((v) => v === '%ใบปลิว 100\\%\\_x%');
    expect(patterns).toHaveLength(3);
  });

  it('adds the id-prefix arm only for all-digit queries', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('2025');
    expect(sqlCalls[0].values).toContain(true);
    expect(sqlCalls[0].values).toContain('2025%');

    resetMockPostgres();
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('ซุปเปอร์');
    expect(sqlCalls[0].values).toContain(false);
    expect(sqlCalls[0].values).toContain('');

    resetMockPostgres();
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('20 25'); // whitespace → not all-digit
    expect(sqlCalls[0].values).toContain(false);
  });

  it('binds LIMIT as a parameter — default 100, clamped to 1..500', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('ab');
    expect(sqlCalls[0].values).toContain(100);

    resetMockPostgres();
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('ab', { limit: 9999 });
    expect(sqlCalls[0].values).toContain(500);

    resetMockPostgres();
    queueResult({ rows: [], rowCount: 0 });
    await searchArchiveOrders('ab', { limit: 0 });
    expect(sqlCalls[0].values).toContain(1);
  });

  it('maps snake_case rows to ArchiveOrderRow with total from the window function', async () => {
    queueResult({
      rows: [
        sqlRow({ id: '202503012', total: '3', shipped_date: '10/03/2025' }),
        sqlRow({ id: '202502007', total: '3', cancelled_at: '02/02/2025', cancelled_reason: 'ลูกค้าเปลี่ยนใจ' }),
      ],
      rowCount: 2,
    });
    const r = await searchArchiveOrders('ใบปลิว', { limit: 2 });
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(true);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({
      id: 202503012,
      name: 'ใบปลิวซุปเปอร์',
      customer: 'ร้านค้า A',
      orderer: 'nook',
      dateIn: '01/03/2025',
      dateDue: '05/03/2025',
      price: '1500',
      status: 'sent',
      shippedDate: '10/03/2025',
      cancelledAt: null,
      cancelledReason: null,
    });
    expect(r.rows[1].cancelledAt).toBe('02/02/2025');
    expect(r.rows[1].cancelledReason).toBe('ลูกค้าเปลี่ยนใจ');
  });

  it('reports truncated=false when total equals the row count, and total=0 on no rows', async () => {
    queueResult({ rows: [sqlRow({ total: '1' })], rowCount: 1 });
    const r = await searchArchiveOrders('ใบปลิว');
    expect(r.total).toBe(1);
    expect(r.truncated).toBe(false);

    resetMockPostgres();
    queueResult({ rows: [], rowCount: 0 });
    const empty = await searchArchiveOrders('ไม่มี');
    expect(empty).toEqual({ rows: [], total: 0, truncated: false });
  });

  it('coerces null text columns to "" and keeps status nulls as ""', async () => {
    queueResult({ rows: [sqlRow({ name: null, customer: null, orderer: null, price: null, status: null })], rowCount: 1 });
    const r = await searchArchiveOrders('ab');
    expect(r.rows[0].name).toBe('');
    expect(r.rows[0].customer).toBe('');
    expect(r.rows[0].orderer).toBe('');
    expect(r.rows[0].price).toBe('');
    expect(r.rows[0].status).toBe('');
    expect(r.rows[0].shippedDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: FAIL — `searchArchiveOrders is not a function` / export missing (7 tests ใหม่แดง, 6 เดิมเขียว)

- [ ] **Step 3: Implement the query**

ใน `lib/archive-search.ts` **ลบ 3 บรรทัด `void sql; void isPostgresConfigured; void PostgresReadError;`** แล้วต่อท้ายไฟล์ด้วย:

```ts
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
```

หมายเหตุ: ใน JS template literal เขียน `ESCAPE '\\'` → SQL จริงได้ `ESCAPE '\'` (backslash ตัวเดียว) — test ข้างบนเช็คข้อความหลัง normalize แล้ว

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: PASS — 13 tests

- [ ] **Step 5: Commit**

```bash
git add lib/archive-search.ts tests/archive-search.test.ts
git commit -m "feat(archive): searchArchiveOrders — all-years ILIKE over orders + latest shipped/cancelled, one round-trip (§13)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `archiveRowState` — status precedence (pure)

**Files:**
- Modify: `lib/archive-search.ts`
- Modify: `tests/archive-search.test.ts`

- [ ] **Step 1: Write the failing tests**

ต่อท้าย `tests/archive-search.test.ts`:

```ts
import { archiveRowState } from '@/lib/archive-search';

describe('archiveRowState', () => {
  const base = { status: 'sent', shippedDate: null, cancelledAt: null, cancelledReason: null };

  it('cancelled wins even when a shippedDate exists (mirrors track-status precedence)', () => {
    expect(
      archiveRowState({ ...base, shippedDate: '10/03/2025', cancelledAt: '11/03/2025', cancelledReason: 'ซ้ำ' }),
    ).toEqual({ kind: 'cancelled', label: 'ยกเลิก', detail: 'ซ้ำ' });
  });

  it('cancelled detail falls back to cancelledAt when there is no reason', () => {
    expect(archiveRowState({ ...base, cancelledAt: '11/03/2025' })).toEqual({
      kind: 'cancelled', label: 'ยกเลิก', detail: '11/03/2025',
    });
    expect(archiveRowState({ ...base, status: 'Cancelled ' })).toEqual({
      kind: 'cancelled', label: 'ยกเลิก', detail: null,
    });
  });

  it('shipped by row or by status', () => {
    expect(archiveRowState({ ...base, shippedDate: '10/03/2025' })).toEqual({
      kind: 'shipped', label: 'ส่งแล้ว', detail: '10/03/2025',
    });
    expect(archiveRowState({ ...base, status: 'shipped' })).toEqual({
      kind: 'shipped', label: 'ส่งแล้ว', detail: null,
    });
  });

  it('draft is case/whitespace-insensitive', () => {
    expect(archiveRowState({ ...base, status: 'Draft ' })).toEqual({ kind: 'draft', label: 'ร่าง', detail: null });
  });

  it('anything else is active', () => {
    expect(archiveRowState({ ...base, status: 'sent' })).toEqual({ kind: 'active', label: 'กำลังทำ', detail: null });
    expect(archiveRowState({ ...base, status: '' })).toEqual({ kind: 'active', label: 'กำลังทำ', detail: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: FAIL — `archiveRowState is not a function` (5 ใหม่แดง)

- [ ] **Step 3: Implement**

ต่อท้าย `lib/archive-search.ts`:

```ts
export type ArchiveStateKind = 'cancelled' | 'shipped' | 'draft' | 'active';

export interface ArchiveRowState {
  kind: ArchiveStateKind;
  label: string;
  /** Reason / date to show under the label (raw as stored — the page formats dates). */
  detail: string | null;
}

/** Status pill for one archive row. Precedence cancelled > shipped > draft >
 *  active, matching lib/track-status.ts (a cancelled order stays cancelled
 *  even if a stale shipped row survives). `status` is compared
 *  case/whitespace-insensitively — Sheet-era rows carry mixed casing. */
export function archiveRowState(
  row: Pick<ArchiveOrderRow, 'status' | 'shippedDate' | 'cancelledAt' | 'cancelledReason'>,
): ArchiveRowState {
  const status = row.status.trim().toLowerCase();
  if (row.cancelledAt || status === 'cancelled') {
    return { kind: 'cancelled', label: 'ยกเลิก', detail: row.cancelledReason || row.cancelledAt || null };
  }
  if (row.shippedDate || status === 'shipped') {
    return { kind: 'shipped', label: 'ส่งแล้ว', detail: row.shippedDate || null };
  }
  if (status === 'draft') {
    return { kind: 'draft', label: 'ร่าง', detail: null };
  }
  return { kind: 'active', label: 'กำลังทำ', detail: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run tests/archive-search.test.ts
```
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**

```bash
git add lib/archive-search.ts tests/archive-search.test.ts
git commit -m "feat(archive): archiveRowState — cancelled > shipped > draft > active pill precedence (§13)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `/archive` page reads Postgres

**Files:**
- Modify: `app/archive/page.tsx` (เขียนทับทั้งไฟล์)

- [ ] **Step 1: Replace the page**

เขียนทับ `app/archive/page.tsx` ทั้งไฟล์:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, verifySession } from '@/lib/auth';
import { displayDate } from '@/lib/jobs';
import { IconCheck, IconFolderOpen, IconFileText, IconPencil } from '@/lib/icons';
import { DashboardShell } from '@/components/dashboard-shell';
import {
  normalizeArchiveQuery,
  searchArchiveOrders,
  archiveRowState,
  type ArchiveOrderRow,
  type ArchiveSearchResult,
  type ArchiveStateKind,
} from '@/lib/archive-search';

export const metadata: Metadata = {
  title: 'ค้นข้อมูลเก่า',
};

interface SearchParams {
  q?: string;
}

/** All-years order search (§13). Postgres-only — the Apps Script
 *  `searchArchive` it replaced only scanned Sheet tabs that never existed. */
export default async function ArchivePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Admin-only (matches WP — searchArchive was admin-restricted in ROLE_REQUIREMENTS)
  const cookieStore = await cookies();
  const session = await verifySession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session || session.role !== 'admin') {
    redirect('/analytics');
  }

  const rawQuery = (searchParams.q || '').trim();
  const query = normalizeArchiveQuery(rawQuery);
  let result: ArchiveSearchResult | null = null;
  let errorMessage: string | null = null;

  if (query) {
    try {
      result = await searchArchiveOrders(query);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <DashboardShell user={session.user} role={session.role}>
      <header className="border-b border-stone-100 bg-white sticky top-0 z-20">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <h1 className="text-lg sm:text-xl font-bold text-stone-900">ค้นข้อมูลเก่า</h1>
          <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 hidden sm:inline">
            admin only
          </span>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-4 sm:py-6 max-w-6xl mx-auto">
        <SearchBox initial={rawQuery} />

        {errorMessage ? (
          <ErrorPanel message={errorMessage} />
        ) : rawQuery.length === 0 ? (
          <EmptyState />
        ) : !query ? (
          <Hint>กรุณาใส่คำค้นอย่างน้อย 2 ตัวอักษร</Hint>
        ) : !result ? null : result.rows.length === 0 ? (
          <Hint>ไม่พบผลลัพธ์สำหรับ &ldquo;{query}&rdquo;</Hint>
        ) : (
          <Results result={result} query={query} />
        )}

        <p className="text-xs text-stone-400 mt-6 text-right">
          ค้นจากใบสั่งงานทั้งหมดทุกปี — ไม่จำกัด 12 เดือนเหมือน /orders ·
          ค้น ชื่องาน / ลูกค้า / ผู้สั่ง / เลข id (ขึ้นต้น)
        </p>
      </div>
    </DashboardShell>
  );
}

// ─── Components ────────────────────────────────────────────

function SearchBox({ initial }: { initial: string }) {
  return (
    <form
      action="/archive"
      method="GET"
      className="bg-white rounded-xl border border-stone-200 p-3 mb-4 flex gap-2 items-center"
    >
      <input
        name="q"
        defaultValue={initial}
        autoFocus
        placeholder="ชื่องาน / ลูกค้า / ผู้สั่ง / เลข id — ขั้นต่ำ 2 ตัวอักษร"
        className="flex-grow px-3 py-2 border border-stone-200 rounded-md text-sm focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <button
        type="submit"
        className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:bg-accent-dark transition-colors"
      >
        ค้นหา
      </button>
    </form>
  );
}

const PILL_CLASS: Record<ArchiveStateKind, string> = {
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  shipped: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft: 'bg-stone-100 text-stone-600 border-stone-200',
  active: 'bg-amber-50 text-amber-800 border-amber-200',
};

function Results({ result, query }: { result: ArchiveSearchResult; query: string }) {
  return (
    <>
      <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <IconCheck size={14} className="flex-shrink-0" />
        <span>
          พบ <span className="font-semibold tabular-nums">{result.total}</span> รายการสำหรับ{' '}
          <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded">{query}</span>
          {result.truncated && (
            <span className="text-stone-500">
              {' '}
              (แสดง {result.rows.length} แรก — เพิ่มคำค้นให้เจาะจงเพื่อกรองให้แคบลง)
            </span>
          )}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">#</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ชื่องาน</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ลูกค้า</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ผู้สั่ง</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">รับงาน</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">กำหนดส่ง</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">ราคา</th>
                <th className="text-left px-3 py-2 font-medium whitespace-nowrap">สถานะ</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <ResultRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ResultRow({ row }: { row: ArchiveOrderRow }) {
  const state = archiveRowState(row);
  const detail = state.kind === 'shipped' && state.detail ? displayDate(state.detail) : state.detail;
  return (
    <tr className="border-t border-stone-100 hover:bg-stone-50/40 align-top">
      <td className="px-3 py-2 tabular-nums text-stone-500 whitespace-nowrap">{row.id}</td>
      <td className="px-3 py-2 text-stone-900 font-medium">{row.name || '—'}</td>
      <td className="px-3 py-2 text-stone-700">{row.customer || '—'}</td>
      <td className="px-3 py-2 text-stone-700">{row.orderer || '—'}</td>
      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{displayDate(row.dateIn)}</td>
      <td className="px-3 py-2 text-stone-700 whitespace-nowrap">{displayDate(row.dateDue)}</td>
      <td className="px-3 py-2 text-stone-700 tabular-nums whitespace-nowrap">{row.price || '—'}</td>
      <td className="px-3 py-2">
        <span
          className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium whitespace-nowrap ${PILL_CLASS[state.kind]}`}
        >
          {state.label}
        </span>
        {detail && (
          <div className="text-[11px] text-stone-500 mt-0.5 max-w-[16rem] truncate" title={detail}>
            {detail}
          </div>
        )}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Link
          href={`/orders/${row.id}/print`}
          className="inline-flex items-center gap-1 text-accent hover:underline mr-3"
        >
          <IconFileText size={13} />
          ใบสั่งงาน
        </Link>
        <Link
          href={`/orders/${row.id}/edit`}
          className="inline-flex items-center gap-1 text-stone-600 hover:underline"
        >
          <IconPencil size={13} />
          แก้ไข
        </Link>
      </td>
    </tr>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-xl border border-dashed border-stone-200 p-8 text-center">
      <div className="flex justify-center mb-2 text-stone-300">
        <IconFolderOpen size={36} />
      </div>
      <p className="text-sm text-stone-600">
        ค้นหาใบสั่งงานเก่าทุกปี — รวมทั้งที่{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">ส่งแล้ว</code>,{' '}
        <code className="text-xs bg-stone-100 px-1 rounded">ยกเลิก</code> และที่ยังทำอยู่
      </p>
      <p className="text-xs text-stone-400 mt-3">
        ใส่ชื่องาน, ชื่อลูกค้า, ผู้สั่ง หรือเลข id (เช่น 2025 = ทุกงานปี 2025) แล้วกดค้นหา
      </p>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-stone-200 p-6 text-center text-sm text-stone-500">
      {children}
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
      <h2 className="text-amber-900 font-semibold">ค้นหาไม่สำเร็จ</h2>
      <p className="text-sm text-amber-800 mt-2 font-mono">{message}</p>
    </div>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run:
```bash
npm run type-check
```
Expected: exit 0, ไม่มี error. (ไฟล์นี้ยังไม่ import อะไรจาก `lib/api.ts` แล้ว — `searchArchive` ใน lib/api.ts จะถูกลบใน Task 6)

- [ ] **Step 3: Local render check**

Run:
```bash
npm run build
```
Expected: build เขียว, route `/archive` แสดงเป็น `ƒ (Dynamic)` ใน route table

- [ ] **Step 4: Commit**

```bash
git add app/archive/page.tsx
git commit -m "feat(archive): /archive searches all-years orders in Postgres — single table + status pill + print/edit links (§13)

Replaces the Apps Script searchArchive call. That action only scanned Sheet
tabs named *_archive_* which were never created, so the page had returned
zero results since the port.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: L4 hint on `/shipped` + `/cancelled`

Spec §3 วางไว้ใน `FilterForm` ฝั่ง client — ตอนอ่านโค้ดพบว่า `/shipped` **มีปุ่ม "ค้นหาในประวัติ" → `/archive` อยู่แล้วที่ระดับ page** (แสดงทุก role ทั้งที่ /archive admin-only). ใช้จุดนั้นแทน = ไม่ต้อง thread `role` ลง client, UX intent เดิม (ข้อความ + ลิงก์เฉพาะ admin). Task นี้แก้ spec §3 ให้ตรงด้วย

**Files:**
- Modify: `app/shipped/page.tsx:29-38`
- Modify: `app/cancelled/page.tsx:1-10` (imports) + `:29-33` (content div)
- Modify: `docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md` §3

- [ ] **Step 1: `/shipped` — role-aware hint**

ใน `app/shipped/page.tsx` แทนที่ block นี้:

```tsx
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/archive"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
          >
            <IconFolder size={13} />
            ค้นหาในประวัติ
          </Link>
        </div>
```

ด้วย:

```tsx
        {/* L4-year-filter-shrinks-at-backfill-ageout (closed by design, §13):
            this page lists the last 12 months only, so the year dropdown
            shrinks as rows age out. Older rows live in /archive (admin). */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          {session.role === 'admin' && (
            <Link
              href="/archive"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
            >
              <IconFolder size={13} />
              ค้นข้อมูลเก่า
            </Link>
          )}
          <span>
            หน้านี้แสดงรายการ 12 เดือนล่าสุด — เก่ากว่านั้นค้นได้ที่ ค้นข้อมูลเก่า
            {session.role !== 'admin' && ' (admin)'}
          </span>
        </div>
```

- [ ] **Step 2: `/cancelled` — hint with link (page is admin-only already)**

ใน `app/cancelled/page.tsx` เพิ่ม import 2 บรรทัด (วางต่อจาก `import { cookies } from 'next/headers';`):

```tsx
import Link from 'next/link';
import { IconFolder } from '@/lib/icons';
```

แล้วแทนที่:

```tsx
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        <Suspense fallback={<CancelledSkeleton />}>
          <CancelledData />
        </Suspense>
      </div>
```

ด้วย:

```tsx
      <div className="px-4 sm:px-6 py-4 max-w-6xl mx-auto space-y-4">
        {/* L4-year-filter-shrinks-at-backfill-ageout (closed by design, §13) —
            12-month list; older cancellations are searchable in /archive. */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
          <Link
            href="/archive"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 text-stone-700 text-xs font-medium hover:bg-stone-200"
          >
            <IconFolder size={13} />
            ค้นข้อมูลเก่า
          </Link>
          <span>หน้านี้แสดงรายการ 12 เดือนล่าสุด — เก่ากว่านั้นค้นได้ที่ ค้นข้อมูลเก่า</span>
        </div>
        <Suspense fallback={<CancelledSkeleton />}>
          <CancelledData />
        </Suspense>
      </div>
```

- [ ] **Step 3: Amend spec §3**

ใน `docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md` แทนที่ทั้ง section `## 3. L4 hint — /shipped + /cancelled (D5)` (ถึงก่อน `## 4.`) ด้วย:

```markdown
## 3. L4 hint — `/shipped` + `/cancelled` (D5)

- **Implemented at page level** (amended 2026-09-05 ตอนเขียน plan): `/shipped` มีปุ่ม "ค้นหาในประวัติ" → `/archive` อยู่แล้วที่ [app/shipped/page.tsx](../../app/shipped/page.tsx) (แสดงทุก role ทั้งที่ `/archive` admin-only) → ใช้จุดนั้นแทน `FilterForm` ฝั่ง client: ไม่ต้อง thread `role` ลง `ShippedListClient`
  - admin: ปุ่ม "ค้นข้อมูลเก่า" (ลิงก์) + ข้อความ "หน้านี้แสดงรายการ 12 เดือนล่าสุด — เก่ากว่านั้นค้นได้ที่ ค้นข้อมูลเก่า"
  - role อื่น: ข้อความเดียวกัน + "(admin)" ไม่มีปุ่ม (กันคลิกแล้วโดน redirect งง)
- `/cancelled` เป็น admin-only อยู่แล้ว (page redirect role อื่น) → block เดียวกันแบบมีปุ่มเสมอ (เพิ่ม `Link` + `IconFolder` import)
- ปิด **L4-year-filter-shrinks-at-backfill-ageout** ใน AUDIT-BACKLOG: dropdown ปีจะเหลือ ~12 เดือนเมื่อ backfill age out (2027-05-18) **โดยมีคำอธิบาย+ทางไป** = ตรง intent ของ windowing design; ไม่แก้ shrink
```

- [ ] **Step 4: Type-check + lint**

Run:
```bash
npm run type-check && npm run lint
```
Expected: exit 0 (lint warning เดิม `lib/ai-quote/slip.ts:92` `_r` unused มีอยู่ก่อนแล้ว ไม่ใช่ของเรา)

- [ ] **Step 5: Commit**

```bash
git add app/shipped/page.tsx app/cancelled/page.tsx docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md
git commit -m "feat(lists): /shipped + /cancelled point past the 12-month window to /archive (closes L4 by design)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Remove the Apps Script client from `lib/api.ts` + sweep `AppsScriptError`

**Files:**
- Modify: `lib/api.ts` (header comment, class, getApiBase, currentActor, post, searchArchive, ArchiveSearchResult, final export)
- Modify: `app/analytics/page.tsx:5, 142-146, 240-244, 413-416`
- Modify: `app/orders/[id]/print/page.tsx:5, 8-10, 70`
- Modify: `app/orders/[id]/edit/page.tsx:4, 69`
- Modify: `app/orders/[id]/tracking-card/page.tsx:5, 35`
- Modify: `app/api/track/lookup/route.ts:2, 162`
- Modify: `app/api/orders/raw/[id]/route.ts:2, 52`
- Modify: `app/api/audit/route.ts:2, 47-49`
- Modify: `app/api/cron/morning-report/route.ts:25-26`

- [ ] **Step 1: `lib/api.ts` — header + class + getApiBase**

แทนที่บรรทัด 5-29 (จาก `/**` header ถึงปิด `getApiBase`):

```ts
/**
 * Apps Script client — narrowly used post-§12 by `/archive` only.
 * loadAll/loadOrder/getAuditByTarget read directly from Postgres now
 * (no Apps Script fallback). The Apps Script project still hosts
 * `searchArchive` until §13 ports archive tables to Postgres.
 */

class AppsScriptError extends Error {
  constructor(public action: string, public reason: string, public status?: number) {
    super(`Apps Script ${action} failed: ${reason}`);
    this.name = 'AppsScriptError';
  }
}

function getApiBase(): { url: string; token: string } {
  const url = process.env.APPS_SCRIPT_URL;
  const token = process.env.APPS_SCRIPT_TOKEN;
  if (!url || !token) {
    throw new AppsScriptError(
      'config',
      'APPS_SCRIPT_URL or APPS_SCRIPT_TOKEN env var missing — set in Vercel Settings → Environment Variables',
    );
  }
  return { url, token };
}
```

ด้วย:

```ts
/**
 * Dashboard read API — Postgres-only.
 *
 * Every reader here delegates to lib/api-postgres (or queries Postgres
 * directly under `unstable_cache`). The Apps Script client that used to
 * live in this file (`post()` + `searchArchive`, the last §12 survivor)
 * was retired 2026-09-05 (§13/§15): /archive reads lib/archive-search
 * and nothing in the dashboard talks to Apps Script any more. Errors from
 * Postgres surface as `PostgresReadError` (lib/api-postgres).
 */
```

- [ ] **Step 2: `lib/api.ts` — remove currentActor / post / searchArchive / final export**

ลบทุกอย่างตั้งแต่บรรทัด `/** Resolve the operator identity for audit logging. ...` (เดิม ~233) จนจบไฟล์ — คือ `currentActor`, `post`, `ArchiveSearchResult`, `searchArchive`, `export { AppsScriptError };`. ไฟล์ต้องจบที่ปิด `getAuditByTarget`:

```ts
export async function getAuditByTarget(
  jobId: number | string | null | undefined,
  orderId: number | string | null | undefined,
): Promise<{ entries: AuditEntry[] }> {
  const { getAuditByTargetFromPostgres } = await import('@/lib/api-postgres');
  return getAuditByTargetFromPostgres(jobId, orderId);
}
```

ยืนยัน:
```bash
grep -n "AppsScriptError\|APPS_SCRIPT\|currentActor\|searchArchive\|function post" lib/api.ts
```
Expected: ไม่มี match

- [ ] **Step 3: `app/analytics/page.tsx`**

บรรทัด 5:
```ts
import { loadAllWithAudit, AppsScriptError } from '@/lib/api';
```
→
```ts
import { loadAllWithAudit } from '@/lib/api';
```

สองจุด (เดิม ~142-146 และ ~240-244) ที่เป็น:
```ts
    errorMessage = err instanceof AppsScriptError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
```
→ ทั้งสองจุด:
```ts
    errorMessage = err instanceof Error ? err.message : String(err);
```

ErrorPanel (เดิม ~413-416):
```tsx
      <p className="text-xs text-amber-700 mt-4">
        ตรวจ env vars <code className="bg-amber-100 px-1">APPS_SCRIPT_URL</code> +{' '}
        <code className="bg-amber-100 px-1">APPS_SCRIPT_TOKEN</code> ใน Vercel — ครบ 3 environments หรือยัง?
      </p>
```
→
```tsx
      <p className="text-xs text-amber-700 mt-4">
        ตรวจ env var <code className="bg-amber-100 px-1">POSTGRES_URL</code> ใน Vercel (Storage → Neon) — ครบ 3 environments หรือยัง?
      </p>
```

- [ ] **Step 4: `app/orders/[id]/print/page.tsx`**

บรรทัด 5:
```ts
import { loadOrder, AppsScriptError } from '@/lib/api';
```
→
```ts
import { loadOrder } from '@/lib/api';
```

comment บรรทัด 8-10 ที่ขึ้นต้น `// "พิมพ์+สั่ง" pops this page open ...` — แก้ประโยค `loadOrder() is Postgres-first (with Apps Script fallback) so brand-new` → `loadOrder() reads Postgres directly so brand-new` (คงบรรทัดอื่นของ comment ไว้)

บรรทัด ~70:
```ts
    errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
```
→
```ts
    errorMessage = err instanceof Error ? err.message : String(err);
```

- [ ] **Step 5: `app/orders/[id]/edit/page.tsx`**

บรรทัด 4:
```ts
import { loadOrder, loadRecentOrdersSlim, AppsScriptError, type RecentOrderSlim } from '@/lib/api';
```
→
```ts
import { loadOrder, loadRecentOrdersSlim, type RecentOrderSlim } from '@/lib/api';
```

บรรทัด ~69 (ใน `else` ของ `if (err instanceof PostgresReadError && ...)`):
```ts
      errorMessage = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
```
→
```ts
      errorMessage = err instanceof Error ? err.message : String(err);
```

- [ ] **Step 6: `app/orders/[id]/tracking-card/page.tsx`**

บรรทัด 5:
```ts
import { loadOrder, AppsScriptError } from '@/lib/api';
```
→
```ts
import { loadOrder } from '@/lib/api';
```
บรรทัด ~35: เปลี่ยนเป็น `errorMessage = err instanceof Error ? err.message : String(err);` เหมือน Step 4

- [ ] **Step 7: `app/api/track/lookup/route.ts`**

บรรทัด 2:
```ts
import { loadOrder, AppsScriptError } from '@/lib/api';
```
→
```ts
import { loadOrder } from '@/lib/api';
```
บรรทัด ~162:
```ts
    const msg = err instanceof AppsScriptError ? err.message : err instanceof Error ? err.message : String(err);
```
→
```ts
    const msg = err instanceof Error ? err.message : String(err);
```
(status 502 + ข้อความ `ระบบเชื่อมต่อไม่ได้ — …` คงเดิม)

- [ ] **Step 8: `app/api/orders/raw/[id]/route.ts`**

บรรทัด 2:
```ts
import { loadOrder, AppsScriptError } from '@/lib/api';
```
→
```ts
import { loadOrder } from '@/lib/api';
```
บรรทัด ~52: เปลี่ยนเป็น `const msg = err instanceof Error ? err.message : String(err);` (status 502 คงเดิม)

- [ ] **Step 9: `app/api/audit/route.ts` — PostgresReadError → 503**

บรรทัด 2:
```ts
import { getAuditByTarget, AppsScriptError } from '@/lib/api';
```
→
```ts
import { getAuditByTarget } from '@/lib/api';
import { PostgresReadError } from '@/lib/api-postgres';
```

catch block (เดิม ~46-53):
```ts
  } catch (err) {
    if (err instanceof AppsScriptError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
```
→
```ts
  } catch (err) {
    // Postgres unreachable / not configured → 503 (service unavailable).
    // The only consumer (components/history-tab.tsx) checks res.ok and
    // shows json.error, so the exact status is informational.
    if (err instanceof PostgresReadError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
```

- [ ] **Step 10: `app/api/cron/morning-report/route.ts` comment**

ลบ 2 บรรทัดนี้ออกจาก doc comment (บรรทัด ~25-26):
```ts
 *  - `APPS_SCRIPT_URL` / `APPS_SCRIPT_TOKEN` — used only by the `loadAll()`
 *    Apps Script fallback when the Postgres mirror is stale
```

- [ ] **Step 11: Verify the invariant + full gates**

Run:
```bash
grep -rn "APPS_SCRIPT\|AppsScriptError" app lib components
```
Expected: **ไม่มี match เลย** (0 บรรทัด)

Run:
```bash
npm run type-check
```
Expected: exit 0

Run:
```bash
npm test
```
Expected: `Test Files 48 passed` · `Tests 653 passed` (635 เดิม + 18 ใหม่) — ดูตัวเลขจริงจาก output; เช็ค exit code = 0 แยก:
```bash
npm test >/dev/null 2>&1; echo "exit=$?"
```
Expected: `exit=0`

Run:
```bash
npm run build
```
Expected: build เขียว

- [ ] **Step 12: Commit**

```bash
git add lib/api.ts app/analytics/page.tsx "app/orders/[id]/print/page.tsx" "app/orders/[id]/edit/page.tsx" "app/orders/[id]/tracking-card/page.tsx" app/api/track/lookup/route.ts "app/api/orders/raw/[id]/route.ts" app/api/audit/route.ts app/api/cron/morning-report/route.ts
git commit -m "refactor(api): retire the Apps Script client — dashboard is Postgres-only (§15 step 1)

Removes post()/searchArchive/AppsScriptError/currentActor/getApiBase from
lib/api.ts and the instanceof AppsScriptError branches in 8 call sites
(each already had the generic Error fallback). /api/audit now maps
PostgresReadError to 503. grep APPS_SCRIPT across app/lib/components = 0,
so the two Vercel env vars can be removed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs sweep (dashboard repo + workspace)

Workspace root + `production-monitoring/` **ไม่ใช่ git repo** — แก้ไฟล์ตรงๆ ไม่ต้อง commit. ฝั่ง `penprinting-dashboard` commit ในขั้นสุดท้ายของ task

**Files:**
- Modify: `CLAUDE.md` (dashboard)
- Modify: `dashboard-v2.md`
- Modify: `migration-plan-apps-script-shrink.md`
- Modify: `AUDIT-BACKLOG.md`
- Modify: `../CLAUDE.md` (workspace)
- Modify: `../production-monitoring/monitoring.md`
- Modify: `../Tech-Roadmap-Status.md`
- Modify: `../.claude/commands/check-quota.md`

- [ ] **Step 1: dashboard `CLAUDE.md`**

(a) section `## Auth & sessions` — ลบ 2 บรรทัด:
```
- Service token `APPS_SCRIPT_TOKEN` (signed `api:admin:dashboard:<exp>:<hmac>`, 5y) — talks to Apps Script
- Limitation: audit actor = `admin:dashboard` for all v2 mutations (per-user signing is tech debt)
```

(b) ตาราง Routes — แถว `/archive`:
```
| `/archive` | admin | Search archived sheets |
```
→
```
| `/archive` | admin | ค้นใบสั่งงานทุกปีจาก Postgres (ไม่จำกัด 12 เดือน) — §13 2026-09-05 |
```

(c) section `## Env vars (Vercel project)` — ลบ 2 บรรทัด `APPS_SCRIPT_URL` + `APPS_SCRIPT_TOKEN` แล้วเพิ่มบรรทัดแรก:
```
- `POSTGRES_URL` — Neon (Vercel Storage) — source of truth ทุก read/write
```

(d) section `## Roadmap (current)` — เพิ่มท้าย:
```
- §13 Archive port ✅ (2026-09-05) — /archive อ่าน Postgres, Apps Script client ถอดแล้ว; §15 = คุณนุ๊กถอด env + archive deployment → ลบโปรเจกต์หลัง soak 7 วัน
```

(e) ตาราง Source-of-truth files — เพิ่มแถว:
```
| [lib/archive-search.ts](lib/archive-search.ts) | `/archive` all-years search (normalize / escape / `searchArchiveOrders` / `archiveRowState`) |
```

- [ ] **Step 2: `dashboard-v2.md`**

(a) `### Stack` บรรทัด:
```
- **Backend connection**: Apps Script Web App (HMAC-signed service token)
```
→
```
- **Backend connection**: Postgres (Neon via Vercel Storage) — Postgres-only ตั้งแต่ §12 (2026-05-28); Apps Script client ถอดออก 2026-09-05 (§13/§15)
```

(b) ตารางไฟล์: `| `app/archive/page.tsx` | Search archived sheets |` → `| `app/archive/page.tsx` | ค้นใบสั่งงานทุกปี (Postgres, lib/archive-search) |` และ `| `lib/api.ts` | Apps Script API wrapper (`loadAll`, `post`, per-action revalidatePath, per-user audit signing) |` → `| `lib/api.ts` | Postgres read API (`loadAll`, `loadOrder`, `getAuditByTarget`, coalesced `unstable_cache` + `LOAD_ALL_TAG`) |`

(c) section `### Apps Script service token` (3 bullets) — แทนที่ทั้ง section ด้วย:
```
### Apps Script service token — 🪦 retired 2026-09-05
- `APPS_SCRIPT_TOKEN` / `APPS_SCRIPT_URL` ไม่ถูกอ่านในโค้ดอีกแล้ว (§13/§15) — per-user audit signing ทำที่ Postgres write path (`audit_log.user_name`) ตั้งแต่ Phase 2
```

(d) ตาราง routes: `| `/archive` | admin only | Search archived sheets |` → `| `/archive` | admin only | ค้นใบสั่งงานทุกปีจาก Postgres — id prefix / ชื่องาน / ลูกค้า / ผู้สั่ง + สถานะ pill + ลิงก์ print/edit |`

(e) ตาราง roadmap: `| 3.4 — Archive port | ✅ | Search across archive sheets |` → `| 3.4 — Archive port | ✅ | Search across archive sheets → **§13 (2026-09-05): Postgres all-years search** |`

(f) `## 10. Version History` — แทรก entry ใหม่**บนสุด** (ต่อจาก blockquote):
```
### 📦 §13 Archive port — /archive ค้น Postgres ทุกปี + ถอด Apps Script client (2026-09-05, tests 635→653)
คุณนุ๊ก (`/session-start`) เลือก "§13 archive port". **ข้อค้นพบก่อนเริ่ม (ยืนยันจากของจริง)**: Google Sheet ไม่มี tab `*_archive_*` เลย + `/archive` บน prod ค้น "20" ได้ 0 → Apps Script `searchArchive` ไม่เคยคืนอะไรตั้งแต่ port; Postgres มีทุกแถวอยู่แล้ว → scope หดจาก "migrate Sheet archives 2-3 sessions" เหลือ data-source swap. Ship: (1) `lib/archive-search.ts` — `normalizeArchiveQuery` / `escapeLikePattern` / `searchArchiveOrders` (orders ILIKE name/customer/orderer + id prefix เมื่อตัวเลขล้วน, `LEFT JOIN LATERAL` shipped/cancelled ล่าสุด, `COUNT(*) OVER()` = 1 round-trip, LIMIT 100) / `archiveRowState` (cancelled > shipped > draft > active) (2) `/archive` ตารางเดียว + pill + ลิงก์ print/edit (3) L4 ปิด by design — `/shipped` + `/cancelled` บอกว่าแสดง 12 เดือน + ลิงก์ค้นข้อมูลเก่า (admin) (4) **ถอด AS client ทั้งก้อน** จาก lib/api.ts + sweep `instanceof AppsScriptError` 8 ไฟล์ + `/api/audit` map `PostgresReadError`→503 — `grep APPS_SCRIPT app lib components` = 0. Spec: [docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md](docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md). **Lesson**: roadmap §13 drift อีกเคส ([[roadmap-doc-drift]]) — plan เขียนจากสมมติฐานว่า archive tabs มีอยู่; ต้องเปิดของจริงก่อน scope
```
ใส่ commit hashes จริง (จาก `git log --oneline -6`) ท้าย entry ในรูป `commits: \`<hash1>\` → \`<hash6>\``

- [ ] **Step 3: `migration-plan-apps-script-shrink.md`**

section `## 12. หลัง §12 — งานเหลือ` — แทนที่ 3 bullets ด้วย:
```
- ~~**§13 — Port `/archive`** (2-3 sessions)~~ ✅ **DONE 2026-09-05 ใน 1 session** — ข้อค้นพบ: Sheet ไม่เคยมี tab `*_archive_*` (ระบบอายุ < 365 วันตอน freeze) → ไม่มีอะไรให้ migrate; `/archive` ค้น Postgres ทุกปีผ่าน `lib/archive-search.ts` แทน. Spec: `docs/superpowers/specs/2026-09-05-archive-postgres-port-design.md`
- ~~**§14 — Port LINE Webhook**~~ ✅ DONE — LINE OA ชี้ Vercel ตรงตั้งแต่ 2026-06-30, GAS + CF Worker decommissioned 2026-08-20
- **§15 — Full Apps Script shutdown** — โค้ดฝั่ง dashboard ตัดครบแล้ว 2026-09-05 (`grep APPS_SCRIPT` = 0). เหลือ user actions: (1) ถอด `APPS_SCRIPT_URL` + `APPS_SCRIPT_TOKEN` บน Vercel + Redeploy (2) Archive deployment + ลบ trigger ใน Apps Script editor (3) soak 7 วัน → ลบโปรเจกต์ AS · Sheet คงเป็น frozen archive ตลอดไป
```

- [ ] **Step 4: `AUDIT-BACKLOG.md`**

(a) L4 บรรทัด:
```
- [ ] **L4-year-filter-shrinks-at-backfill-ageout** — dropdown ปีบน /shipped //orders จะเหลือ ~12 เดือนเมื่อ backfill rows (imported_at 2026-05-18) age out **2027-05-18** โดยไม่มีคำอธิบายให้ user. Intended per windowing design — ผูก deadline นี้กับ §13 archive port (Apps Script `searchArchive` dependency สุดท้ายอยู่เส้นเดียวกัน).
```
→
```
- [x] ✅ **L4-year-filter-shrinks-at-backfill-ageout** (closed 2026-09-05 **by design** พร้อม §13, commit `<hash ของ Task 5>`) — dropdown ปีบน /shipped //cancelled จะเหลือ ~12 เดือนเมื่อ backfill rows age out 2027-05-18 = intended per windowing design; ตอนนี้ทั้งสองหน้าบอกว่า "แสดง 12 เดือนล่าสุด" + ลิงก์ "ค้นข้อมูลเก่า" (admin) ที่ค้น Postgres ทุกปี ([lib/archive-search.ts](lib/archive-search.ts)) — user มีคำอธิบาย+ทางไป ไม่แก้ shrink.
```
(ใส่ hash จริงจาก `git log --oneline`)

(b) section header เดิม `### Audit round 2026-08-03 — Low (open ×2 — L1 รอคุณนุ๊กตัดสิน · L4 ผูก §13; L2+L3 closed 2026-08-05)` → `### Audit round 2026-08-03 — Low ✅ CLOSED 4/4 (L2+L3 2026-08-05 · L1 2026-08-08 · L4 2026-09-05 by design)`

(c) header ด้านบนไฟล์ — เพิ่มย่อหน้า `Latest update` ใหม่ก่อน `Previous: **2026-09-02` และเปลี่ยนของเดิมเป็น `Previous:`:
```
> Latest update: **2026-09-05 (Mac session)** — **📦 §13 archive port (ไม่ใช่ audit round — คุณนุ๊กเลือกจาก /session-start)**: `/archive` เลิกเรียก Apps Script `searchArchive` (ซึ่งค้น Sheet tab `*_archive_*` ที่ไม่เคยมีอยู่ — หน้านี้คืน 0 ผลลัพธ์มาตลอด) → ค้น Postgres ทุกปีผ่าน `lib/archive-search.ts` + ถอด AS client ทั้งก้อนจาก lib/api.ts (§15 ขั้นแรก). ✅ **L4 ปิด by design** — /shipped + /cancelled บอกว่าแสดง 12 เดือน + ลิงก์ค้นข้อมูลเก่า. **Open: 0 audit item** (ครั้งแรกตั้งแต่ 2026-08-03). รายละเอียด: dashboard-v2.md version history 2026-09-05.
```

- [ ] **Step 5: workspace `../CLAUDE.md`**

(a) section `### ⚠️ Apps Script — สถานะจริง (audit 2026-07-22)` — บรรทัดแรก:
```
- **Dashboard Apps Script** — เหลือ dependency เดียว: action `searchArchive` (หน้า `/archive` ค้น sheet ปีเก่า) — ห้ามลบจนกว่าทำ §13 archive port to Postgres. write path / sync / heal ตัดหมดแล้ว (Phase 4.2 close-out ✅)
```
→
```
- **Dashboard Apps Script** — 🪦 **หมดหน้าที่ 2026-09-05 (§13)**: `/archive` ค้น Postgres ทุกปีแล้ว (`searchArchive` เคยค้น Sheet tab `*_archive_*` ที่ไม่เคยมีอยู่), dashboard ไม่มีโค้ดเรียก AS เหลือเลย (`grep APPS_SCRIPT` = 0). **Pending §15**: คุณนุ๊กถอด env `APPS_SCRIPT_URL`/`APPS_SCRIPT_TOKEN` บน Vercel + archive deployment → ลบโปรเจกต์หลัง soak 7 วัน (~2026-09-12). Source ยังอยู่ใน `production-monitoring/apps-script/dashboard/` เป็น reference
```

(b) ตาราง Deploy routing — แถว:
```
| `production-monitoring/google-apps-script.js` | Apps Script editor — Edit existing → New version (v2 เหลือใช้แค่ `searchArchive`) | User เท่านั้น |
```
→
```
| ~~`production-monitoring/google-apps-script.js`~~ | 🪦 **หมดหน้าที่ 2026-09-05** — dashboard ไม่เรียก Apps Script แล้ว (§13); ลบโปรเจกต์หลัง soak 7 วัน | — |
```

(c) ตาราง "อยากทำ X → ไปดู Y" แถว `| Apps Script ช้า / /track เงียบ | `/check-quota` |` → `| Apps Script ช้า / /track เงียบ | ~~`/check-quota`~~ — ไม่มี consumer แล้ว (2026-09-05); /track อยู่บน Vercel+Postgres |`

- [ ] **Step 6: `../production-monitoring/monitoring.md` header (บรรทัด 5)**

แทนที่ประโยคแรกของ blockquote บรรทัด 5:
```
> **สถานะ backend (update 2026-08-20):** Dashboard Apps Script เหลือ consumer เดียว = action `searchArchive` (หน้า /archive ของ v2) — **ห้ามลบจนกว่า port archive ไป Postgres**.
```
→
```
> **สถานะ backend (update 2026-09-05):** Dashboard Apps Script 🪦 **หมดหน้าที่แล้ว** — `/archive` ของ v2 ค้น Postgres ทุกปี (§13); `searchArchive` เคยค้น Sheet tab `*_archive_*` ที่ไม่เคยถูกสร้าง. Pending §15: ถอด env บน Vercel + archive deployment + ลบโปรเจกต์หลัง soak 7 วัน (~2026-09-12). Google Sheet = frozen historical archive ถาวร.
```
(ส่วนที่เหลือของ blockquote เรื่อง LINE-webhook คงเดิม)

- [ ] **Step 7: `../Tech-Roadmap-Status.md`**

(a) ตารางสรุปบรรทัด ~56 ที่ขึ้นต้น `| **4.3 Apps Script cleanup** |` — เปลี่ยนคอลัมน์สถานะเป็น `✅ code done 2026-09-05 (§13 archive port + AS client ถอด) · pending: user ถอด env + archive deployment → ลบโปรเจกต์หลัง soak ~2026-09-12`

(b) ตาราง Timeline — เพิ่มแถวก่อน `| ⏳ Future       | Phase 4.2 close-out ...`:
```
| **2026-09-05** | **§13 archive port** — `/archive` ค้น Postgres ทุกปี (พบว่า Sheet ไม่เคยมี archive tab → ไม่มีอะไร migrate) + ถอด Apps Script client ทั้งก้อนจาก dashboard (`grep APPS_SCRIPT` = 0). Phase 4.3 code-complete; เหลือ user actions §15 + soak 7 วัน |
```

(c) แถว `| ⏳ Future       | Phase 4.3 cleanup — drop Apps Script LINE webhook + audit cron + primary backend role |` → `| ⏳ ~2026-09-12 | Phase 4.3 close: ลบโปรเจกต์ Apps Script หลัง soak (LINE webhook ✅ 8/20 · audit cron ✅ §12 · backend role ✅ §13) |`

- [ ] **Step 8: `../.claude/commands/check-quota.md`**

แทรกหลัง frontmatter (ก่อนบรรทัด `ตรวจ quota ที่อาจชน...`):
```
> 🪦 **Update 2026-09-05**: Dashboard Apps Script **ไม่มี consumer แล้ว** — `/archive` ค้น Postgres (§13), `searchArchive` ถูกถอดจากโค้ด dashboard. runbook ข้างล่างเก็บไว้เป็น reference จนลบโปรเจกต์ AS หลัง soak (~2026-09-12) — หลังนั้นลบไฟล์นี้ได้
```
และ frontmatter `description:` → `ตรวจ quota Apps Script (🪦 ไม่มี consumer ตั้งแต่ 2026-09-05 — reference จนลบโปรเจกต์)`

- [ ] **Step 9: Commit (dashboard repo เท่านั้น)**

```bash
git add CLAUDE.md dashboard-v2.md migration-plan-apps-script-shrink.md AUDIT-BACKLOG.md
git commit -m "docs: §13 archive port — Apps Script retired from every live-path doc, L4 closed by design

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Push, post-deploy smoke, prod smoke, hand-off

**Files:**
- Modify: `NEXT-SESSION.md` (session entry — ทำหลัง smoke)

- [ ] **Step 1: Push**

```bash
git push origin main
```
Expected: push สำเร็จ, Vercel auto-deploy

- [ ] **Step 2: Wait for post-deploy smoke pinned to our sha**

```bash
SHA=$(git rev-parse HEAD); echo $SHA
gh run list -R witsarutnook/penprinting-dashboard --limit 15 --json headSha,name,status,conclusion,url,createdAt | jq -r --arg sha "$SHA" '.[] | select(.headSha==$sha) | "\(.name) \(.status) \(.conclusion) \(.url)"'
```
Expected: run ชื่อ post-deploy smoke ของ sha เรา `completed success`. ถ้ายังไม่โผล่/`in_progress` รอ 60-120s แล้วรันซ้ำ (ห้ามสรุปจาก run เก่าที่ sha ไม่ตรง — [[ci-wait-pin-headsha]])

- [ ] **Step 3: Prod smoke via Chrome (session admin ของคุณนุ๊ก)**

ใช้ Chrome MCP tab ที่เปิดอยู่ (dashboard.penprinting.co) — เช็คแต่ละข้อด้วย `get_page_text`:
1. `https://dashboard.penprinting.co/archive?q=2025` → banner "พบ N รายการ", แถวมี id ขึ้นต้น 2025, pill สถานะ, ลิงก์ ใบสั่งงาน/แก้ไข
2. `https://dashboard.penprinting.co/archive?q=<ชื่อลูกค้าที่รู้ว่ามีงานปีก่อน>` (เลือกจากผลข้อ 1) → เจอ
3. `https://dashboard.penprinting.co/archive?q=%25` → ไม่ระเบิด; ผลลัพธ์ = เฉพาะแถวที่มี "%" จริง (คาดว่า "ไม่พบผลลัพธ์") — พิสูจน์ escape
4. `https://dashboard.penprinting.co/archive?q=a` → hint "อย่างน้อย 2 ตัวอักษร"
5. กดลิงก์ "ใบสั่งงาน" ของแถวที่เก่าที่สุดในผลข้อ 1 → `/orders/<id>/print` เปิดได้ ไม่ 404
6. `https://dashboard.penprinting.co/shipped` → เห็นปุ่ม "ค้นข้อมูลเก่า" + ข้อความ 12 เดือน · `/cancelled` เช่นกัน
7. (optional ถ้ามี session role อื่น) `/archive` → redirect `/analytics`

- [ ] **Step 4: NEXT-SESSION.md session entry**

แทรก entry ใหม่บนสุดของ `NEXT-SESSION.md` (ต่อจากบรรทัด `> **อ่านไฟล์นี้ + ...**` และบรรทัดว่าง `>`) ตาม format เดิม:
```
> **Session 2026-09-05 (Mac) — 📦 §13 archive port: /archive ค้น Postgres ทุกปี + ถอด Apps Script client (§15 ขั้นแรก) — spec → plan → ship ใน session เดียว (tests 635→653 · commits `<hash แรก>`→`<hash สุดท้าย>` · deploy+smoke เขียว):** คุณนุ๊ก (`/session-start`) เลือก A "§13 archive port". **ข้อค้นพบก่อนออกแบบ (ยืนยันจากของจริงผ่าน Chrome)**: Google Sheet มีแค่ 8 tabs ไม่มี `*_archive_*` เลย + `/archive` prod ค้น "20" ได้ 0 → `searchArchive` ไม่เคยคืนอะไรตั้งแต่ port; Postgres มีทุกแถว (mirror เต็ม + เขียนตรงตั้งแต่ 5/18, audit_log 180 วันครอบอายุระบบ) → **ไม่มี Sheet archive ให้ migrate** — scope หดจาก 2-3 sessions เหลือ data-source swap. Decisions: D1 ค้นใบสั่งงานทุกปี+สถานะ · D2 ถอด AS client ทั้งก้อน + soak 7 วัน · D3 ILIKE (ไม่ tsvector — ตัดคำไทยไม่ได้) · D5 L4 ปิด by design. Ship: `lib/archive-search.ts` (18 tests) + `/archive` ตารางเดียว+pill+print/edit + hint /shipped //cancelled + lib/api.ts เหลือ Postgres readers (sweep `instanceof AppsScriptError` 8 ไฟล์, `/api/audit` → 503) — `grep APPS_SCRIPT app lib components` = 0. Docs กวาด 8 ไฟล์. **Lesson**: [[roadmap-doc-drift]] อีกเคส — §13 ใน plan เขียนจากสมมติฐาน "archive tabs มี" โดยไม่มีใครเปิด Sheet ดู; ก่อน scope งาน migration ต้องเปิดของจริง (มี tab/มีแถวมั้ย) ก่อนเสมอ
>
> ## ⏳ Pending (2026-09-05)
> 1. 🔑 **คุณนุ๊ก — Vercel env**: Settings → Environment Variables → ลบ `APPS_SCRIPT_URL` + `APPS_SCRIPT_TOKEN` (Production/Preview/Development) → **Redeploy** → Claude verify build เขียว + `/archive?q=2025` ยังค้นได้ (positive control)
> 2. 🗄 **คุณนุ๊ก — Apps Script editor** (scriptId ใน `production-monitoring/apps-script/dashboard/.clasp.json`): Deploy → Manage deployments → **Archive** web app deployment · Triggers → ลบ `archiveOldData` ถ้ามี · **ยังไม่ลบโปรเจกต์**
> 3. 👀 **soak ถึง ~2026-09-12**: ไม่มี Sentry error จาก /archive / print / edit ของ order เก่า → คุณนุ๊กลบโปรเจกต์ Apps Script = §15 จบ → Claude update workspace CLAUDE.md + monitoring.md + Tech-Roadmap ติ๊ก "ลบแล้ว"
> 4. 🔁 carryover 9/02 ยังค้าง: smoke /admin cards lost-update gate · ทีมลองรหัส admin · แจ้ง ksk ธีม ocean-blue · smoke `/demo` มือถือ · เขียน NFC จริง · ยืนยันที่อยู่ rathakul · ไล่แชท OA 8/27 · reissue LINE token (optional)
> 5. 💡 backlog: DB-backed paper prices (Neon) · growth path `/archive`: `pg_trgm` GIN index บน orders(name, customer) เมื่อ orders โตเป็นหมื่นแถว (query ไม่ต้องแก้)
>
> ---
```

- [ ] **Step 5: Commit + push docs**

```bash
git add NEXT-SESSION.md dashboard-v2.md AUDIT-BACKLOG.md
git commit -m "docs(session-end): §13 archive port shipped — Postgres all-years search, Apps Script client retired

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 6: Report to คุณนุ๊ก**

สรุปเป็นภาษาไทย: อะไร ship (commits + tests), smoke ผล, และ **pending user actions 3 ข้อ** (env → AS archive → soak/ลบ) พร้อมเหตุผลว่าทำไมต้องเรียงลำดับนี้ (rollback path)

---

## Self-review (ทำแล้ว 2026-09-05)

- **Spec coverage**: §1a/1b → Task 1-2 · §1c → Task 3 · §2 → Task 4 · §3 → Task 5 (page-level, spec amended ใน task) · §4 → Task 6 (ครบ 8 ไฟล์ + analytics hint + cron comment + audit 503) · §5 → Task 7 (9 ไฟล์ตามตาราง spec; `NEXT-SESSION` ใน Task 8) · §6 → tests ใน Task 1-3 + gates ใน Task 6 Step 11 · §7 → Task 8 · §8/Rollback → ไม่ต้องมี task
- **Type consistency**: `ArchiveOrderRow` (camelCase) ↔ `ArchiveSqlRow` (snake_case) map ใน Task 2 · `archiveRowState` รับ `Pick<ArchiveOrderRow, ...>` — page ส่ง `row` ทั้งก้อนได้ · `ArchiveStateKind` ใช้เป็น key ของ `PILL_CLASS` · `searchArchiveOrders(q, { limit })` signature ตรงกันทุก task
- **Placeholders**: hash ของ commit ใน docs = ใส่จาก `git log` จริง ณ เวลาทำ (ระบุไว้ทุกจุด) — ไม่มี TBD

## Amendments (2026-09-05, after Task 1-3 code review)
- Task 1: `normalizeArchiveQuery` also caps at `ARCHIVE_MAX_QUERY_LENGTH = 100` code points
- Task 2: `searchArchiveOrders` normalizes `q` itself and returns an empty result without SQL when null (`''` used to become `ILIKE '%%'`); `limit` NaN/non-finite → default; `''` in shipped/cancelled columns → null. Tests 18 → 25 (suite 653 → 660)
- Task 4 must use `ARCHIVE_MIN_QUERY_LENGTH` in the "อย่างน้อย N ตัวอักษร" hint instead of a hard-coded 2
