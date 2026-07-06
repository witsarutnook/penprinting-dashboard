// tests/ai-quote-db-line.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSession, createLineSession, countQuotes } from '@/lib/ai-quote/db';

describe('loadSession owner-check (M5 — 1b-B §5)', () => {
  beforeEach(() => resetMockPostgres());

  it('with lineUserId filters on channel=line AND line_user_id', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { lineUserId: 'U-A' });
    const call = sqlCalls[0];
    expect(call.text).toContain("channel = 'line'");
    expect(call.text).toContain('line_user_id =');
    expect(call.values).toContain('U-A');
  });
  it('returns null on owner mismatch (empty result — never leaks existence)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadSession(7, { lineUserId: 'U-B' })).toBeNull();
  });
  it('without lineUserId keeps the channel-only scope (staff route unchanged)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'dashboard' });
    expect(sqlCalls[0].text).not.toContain('line_user_id');
  });
});

describe('createLineSession / countQuotes', () => {
  beforeEach(() => resetMockPostgres());

  it("createLineSession inserts channel='line' + owner + display name", async () => {
    queueResult({ rows: [{ id: 9, channel: 'line', conversation: [], lead_status: 'ใหม่', line_user_id: 'U1', customer_name: 'คุณเอ', created_at: 't', updated_at: 't' }], rowCount: 1 });
    const s = await createLineSession('U1', 'คุณเอ');
    expect(s.id).toBe(9);
    expect(s.lineUserId).toBe('U1');
    const call = findCallContaining('INSERT INTO ai_quote_sessions');
    expect(call?.text).toContain("'line'");
    expect(call?.values).toContain('U1');
  });
  it('countQuotes returns the count (0 on empty)', async () => {
    queueResult({ rows: [{ count: 3 }], rowCount: 1 });
    expect(await countQuotes(9)).toBe(3);
    expect(await countQuotes(9)).toBe(0);   // queue exhausted → default empty
  });
});
