// tests/ai-quote-db-messenger.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSession, createMessengerSession } from '@/lib/ai-quote/db';

describe('loadSession owner-check — messenger channel (M5, 1c §2)', () => {
  beforeEach(() => resetMockPostgres());

  it('filters on channel AND line_user_id (PSID) in one WHERE', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'messenger', channelUserId: '24680' });
    const call = sqlCalls[0];
    expect(call.text).toContain('channel =');
    expect(call.text).toContain('line_user_id =');
    expect(call.values).toContain('messenger');
    expect(call.values).toContain('24680');
  });
  it('returns null on owner mismatch (never leaks existence)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadSession(7, { channel: 'messenger', channelUserId: 'someone-else' })).toBeNull();
  });
  it('channelUserId without channel fails CLOSED (channel = NULL never matches)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channelUserId: '24680' });
    expect(sqlCalls[0].values).toContain(null);
  });
});

describe('createMessengerSession', () => {
  beforeEach(() => resetMockPostgres());

  it("inserts channel='messenger' + PSID owner + contact 'Messenger'", async () => {
    queueResult({ rows: [{ id: 11, channel: 'messenger', conversation: [], lead_status: 'ใหม่', line_user_id: '24680', customer_name: 'John D', customer_contact: 'Messenger', created_at: 't', updated_at: 't' }], rowCount: 1 });
    const s = await createMessengerSession('24680', 'John D');
    expect(s.id).toBe(11);
    expect(s.channel).toBe('messenger');
    expect(s.lineUserId).toBe('24680');
    const call = findCallContaining('INSERT INTO ai_quote_sessions');
    expect(call?.text).toContain("'messenger'");
    expect(call?.text).toContain("'Messenger'");
    expect(call?.values).toContain('24680');
  });
});
