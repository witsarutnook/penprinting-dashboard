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
