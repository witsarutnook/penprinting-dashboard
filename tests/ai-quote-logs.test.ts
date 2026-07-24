// tests/ai-quote-logs.test.ts — data layer ของ /quote-logs
// Pin: single-query list (no N+1) + parameterized filters + flag snapshot
// from DB (not caller) + assistant-only + mergeTimeline placement.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, queueError, findCallContaining, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadQuoteLogSessions, loadQuoteLogDetail, flagTurn, mergeTimeline } from '@/lib/ai-quote/logs';
import type { QuoteLogQuote } from '@/lib/ai-quote/logs';

describe('loadQuoteLogSessions', () => {
  beforeEach(() => resetMockPostgres());

  it("channel='customer' binds ['line','messenger'] array param", async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({ channel: 'customer' });
    expect(
      sqlCalls[0].values.some((v: unknown) => Array.isArray(v) && v.includes('line') && v.includes('messenger')),
    ).toBe(true);
  });

  it('q filter uses parameterized ILIKE (no string concat)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({ q: 'รัฐกุล' });
    expect(sqlCalls[0].text).toContain('ILIKE');
    expect(sqlCalls[0].values).toContain('%รัฐกุล%');
  });

  it('aggregates counts in the single query (no N+1)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({});
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toContain('jsonb_array_length');
  });
});

describe('flagTurn', () => {
  beforeEach(() => resetMockPostgres());
  const conv = [
    { role: 'user', text: 'ขอราคาหนังสือ' },
    { role: 'assistant', text: 'เล่มละ 29.50 บาทค่ะ' },
  ];

  it('snapshots role+text from DB conversation (not caller input)', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 }); // load session
    queueResult({ rows: [{ id: 1 }], rowCount: 1 });              // insert
    const r = await flagTurn(7, 1, 'ราคาผิด', 'นุ๊ก');
    expect(r).toBe('ok');
    const ins = findCallContaining('INSERT INTO ai_quote_turn_flags')!;
    expect(ins).toBeDefined();
    expect(ins.values).toContain('เล่มละ 29.50 บาทค่ะ');
    expect(ins.values).toContain('assistant');
  });

  it('rejects a user-turn index', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    expect(await flagTurn(7, 0, null, 'นุ๊ก')).toBe('not-assistant');
  });

  it('rejects out-of-range index', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    expect(await flagTurn(7, 5, null, 'นุ๊ก')).toBe('not-assistant');
  });

  it('missing session → not-found', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await flagTurn(99, 1, null, 'นุ๊ก')).toBe('not-found');
  });

  it('duplicate (ON CONFLICT DO NOTHING rowCount 0) → duplicate', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    expect(await flagTurn(7, 1, null, 'นุ๊ก')).toBe('duplicate');
  });
});

// L-quotelog-detail-serial: after the session row (which gates the
// not-found early return), the quotes + flags queries are independent —
// they must fire in ONE parallel batch.
describe('loadQuoteLogDetail', () => {
  beforeEach(() => resetMockPostgres());

  it('fires quotes + flags in parallel after the session row', async () => {
    queueResult({ rows: [{ id: 7, channel: 'line', conversation: [] }], rowCount: 1 }); // session
    queueError(new Error('boom'));                                                      // quotes rejects
    queueResult({ rows: [], rowCount: 0 });                                             // flags (must still fire)

    await expect(loadQuoteLogDetail(7)).rejects.toThrow('boom');
    expect(findCallContaining('FROM ai_quote_turn_flags')).toBeDefined();
  });

  it('missing session → null without touching quotes/flags', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await loadQuoteLogDetail(999);
    expect(r).toBeNull();
    expect(sqlCalls).toHaveLength(1);
  });
});

describe('mergeTimeline', () => {
  const q = (iso: string): QuoteLogQuote => ({
    id: 1, productType: 'book', spec: {}, unitPrice: 29.5, createdAt: iso,
  });

  it('interleaves a quote after the last turn with ts <= quote time', () => {
    const turns = [
      { role: 'user' as const, text: 'a', ts: '2026-07-20T10:00:00Z' },
      { role: 'assistant' as const, text: 'b', ts: '2026-07-20T10:00:05Z' },
      { role: 'user' as const, text: 'c', ts: '2026-07-20T10:01:00Z' },
    ];
    const items = mergeTimeline(turns, [q('2026-07-20T10:00:03Z')]);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'quote', 'turn', 'turn']);
  });

  it('no turn has ts → all quotes go to the end', () => {
    const turns = [
      { role: 'user' as const, text: 'a' },
      { role: 'assistant' as const, text: 'b' },
    ];
    const items = mergeTimeline(turns, [q('2026-07-20T10:00:00Z')]);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'turn', 'quote']);
  });

  it('keeps quote order stable and drops nothing', () => {
    const turns = [{ role: 'user' as const, text: 'a', ts: '2026-07-20T10:00:00Z' }];
    const items = mergeTimeline(turns, [q('2026-07-20T10:00:01Z'), q('2026-07-20T10:00:02Z')]);
    expect(items.filter((i) => i.kind === 'quote')).toHaveLength(2);
  });
});
