// tests/ai-quote-log-export.test.ts
// One-shot read-only export of customer AI-quote sessions for the น้อง PP eval
// case set (2026-10-24). Retire the route after the pull (PATTERNS §2.5).
// Pins: contact redaction, no identity columns ever leave the DB layer,
// customer channels only, admin gate.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));
vi.mock('@/lib/route-helpers', () => ({ requireSession: vi.fn() }));

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { redactContact, parseExportChannel, loadQuoteLogExport } from '@/lib/ai-quote/log-export';
import { GET } from '@/app/api/admin/quote-log-export/route';

describe('redactContact', () => {
  it('masks Thai phone numbers in the common spellings', () => {
    expect(redactContact('โทร 081-234-5678 ค่ะ')).toBe('โทร [โทร] ค่ะ');
    expect(redactContact('0812345678')).toBe('[โทร]');
    expect(redactContact('02 123 4567')).toBe('[โทร]');
    expect(redactContact('+66 81 234 5678')).toBe('[โทร]');
  });
  it('masks emails, LINE user ids and bank-account-length digit runs', () => {
    expect(redactContact('ส่งที่ somchai.p@example.com')).toBe('ส่งที่ [อีเมล]');
    expect(redactContact('U0123456789abcdef0123456789abcdef')).toBe('[line-id]');
    expect(redactContact('โอนเข้า 123-4-56789-0')).toBe('โอนเข้า [เลขบัญชี]');
  });
  it('leaves prices, quantities and order ids alone', () => {
    const s = 'ใบละ 1.20 บาท รวม 12,000 บาท 10,000 ใบ ใบสั่งงาน 202605046 กล่องละ 100 ใบ';
    expect(redactContact(s)).toBe(s);
  });
});

describe('parseExportChannel', () => {
  it('absent or "customer" → both customer channels', () => {
    expect(parseExportChannel(null)).toEqual({ ok: true, channels: ['line', 'messenger'] });
    expect(parseExportChannel('customer')).toEqual({ ok: true, channels: ['line', 'messenger'] });
  });
  it('line / messenger → that channel only', () => {
    expect(parseExportChannel('line')).toEqual({ ok: true, channels: ['line'] });
    expect(parseExportChannel('messenger')).toEqual({ ok: true, channels: ['messenger'] });
  });
  it('staff channel or junk → not ok (the staff prompt is a different flow)', () => {
    expect(parseExportChannel('dashboard')).toEqual({ ok: false });
    expect(parseExportChannel('LINE')).toEqual({ ok: false });
    expect(parseExportChannel('')).toEqual({ ok: false });
  });
});

const sessionRow = {
  id: 7, channel: 'line', lead_status: 'ใหม่',
  conversation: [
    { role: 'user', text: 'นามบัตร โทร 0812345678', ts: '2026-10-01T01:00:00.000Z' },
    { role: 'assistant', text: 'ได้เลยค่ะ' },
  ],
  created_at: '2026-10-01T01:00:00.000Z', updated_at: '2026-10-01T01:05:00.000Z',
  // columns the loader must never select — present here to prove they are dropped
  line_user_id: 'U0123456789abcdef0123456789abcdef', customer_contact: '0812345678', customer_name: 'สมชาย',
};

describe('loadQuoteLogExport', () => {
  beforeEach(() => resetMockPostgres());

  it('three queries total (sessions, quotes, flags) — never one per session', async () => {
    queueResult({ rows: [sessionRow, { ...sessionRow, id: 8 }], rowCount: 2 });
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogExport(['line', 'messenger']);
    expect(sqlCalls).toHaveLength(3);
    expect(sqlCalls[0].text).toContain('ai_quote_sessions');
    expect(sqlCalls[0].values[0]).toEqual(['line', 'messenger']);
  });

  it('never selects identity columns, and the output carries none', async () => {
    queueResult({ rows: [sessionRow], rowCount: 1 });
    queueResult({ rows: [{ session_id: 7, product_type: 'namecard', spec: { qty: 100, sides: 2 }, unit_price: '3', created_at: '2026-10-01T01:04:00.000Z' }], rowCount: 1 });
    queueResult({ rows: [{ session_id: 7, turn_index: 1, note: 'ถามจำนวนซ้ำ โทรกลับ 081-234-5678' }], rowCount: 1 });
    const out = await loadQuoteLogExport(['line']);
    for (const col of ['line_user_id', 'customer_contact', 'customer_name']) {
      expect(sqlCalls[0].text).not.toContain(col);
    }
    const json = JSON.stringify(out);
    expect(json).not.toContain('line_user_id');
    expect(json).not.toContain('customerContact');
    expect(json).not.toContain('customerName');
    expect(json).not.toContain('สมชาย');
    expect(json).not.toContain('0812345678');
    expect(json).not.toContain('081-234-5678');
  });

  it('assembles turns (redacted), quotes and flags per session', async () => {
    queueResult({ rows: [sessionRow], rowCount: 1 });
    queueResult({ rows: [{ session_id: 7, product_type: 'namecard', spec: { qty: 100, sides: 2 }, unit_price: '3', created_at: '2026-10-01T01:04:00.000Z' }], rowCount: 1 });
    queueResult({ rows: [{ session_id: 7, turn_index: 1, note: 'ถามจำนวนซ้ำ' }], rowCount: 1 });
    const [s] = await loadQuoteLogExport(['line']);
    expect(s).toMatchObject({ id: 7, channel: 'line', leadStatus: 'ใหม่' });
    expect(s.turns).toEqual([
      { role: 'user', text: 'นามบัตร โทร [โทร]', ts: '2026-10-01T01:00:00.000Z' },
      { role: 'assistant', text: 'ได้เลยค่ะ', ts: undefined },
    ]);
    expect(s.quotes).toEqual([{ productType: 'namecard', spec: { qty: 100, sides: 2 }, unitPrice: 3, createdAt: '2026-10-01T01:04:00.000Z' }]);
    expect(s.flags).toEqual([{ turnIndex: 1, note: 'ถามจำนวนซ้ำ' }]);
  });

  it('no sessions → no quote/flag queries', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const out = await loadQuoteLogExport(['line']);
    expect(out).toEqual([]);
    expect(sqlCalls).toHaveLength(1);
  });
});

describe('GET /api/admin/quote-log-export', () => {
  beforeEach(() => { resetMockPostgres(); vi.mocked(requireSession).mockReset(); });

  it('non-admin → the requireSession response is returned as-is', async () => {
    vi.mocked(requireSession).mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await GET(new NextRequest('http://x/api/admin/quote-log-export'));
    expect(res.status).toBe(401);
    expect(sqlCalls).toHaveLength(0);
  });

  it('bad channel → 400 before any query', async () => {
    vi.mocked(requireSession).mockResolvedValue({ role: 'admin', user: 'nook' } as never);
    const res = await GET(new NextRequest('http://x/api/admin/quote-log-export?channel=dashboard'));
    expect(res.status).toBe(400);
    expect(sqlCalls).toHaveLength(0);
  });

  it('admin → 200 with exportedAt, count and redacted sessions', async () => {
    vi.mocked(requireSession).mockResolvedValue({ role: 'admin', user: 'nook' } as never);
    queueResult({ rows: [sessionRow], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    queueResult({ rows: [], rowCount: 0 });
    const res = await GET(new NextRequest('http://x/api/admin/quote-log-export'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(typeof body.exportedAt).toBe('string');
    expect(body.sessions[0].turns[0].text).toBe('นามบัตร โทร [โทร]');
    expect(JSON.stringify(body)).not.toContain('line_user_id');
  });
});
