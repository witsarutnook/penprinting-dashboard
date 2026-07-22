import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { listLeads, loadConversation } from '@/lib/ai-quote/db';

/**
 * L-listleads-eager-conversation (audit 2026-07-21): listLeads used
 * `SELECT s.*` — every lead's full conversation JSONB (200 rows × up to 40
 * turns) rode the route response into the browser just to show ONE last
 * message per row. These tests pin the slim projection: lastMessage +
 * turnCount derive in SQL, the conversation column never leaves Postgres,
 * and the full transcript lazy-fetches per lead via loadConversation
 * (pattern PERF-H2: slim list + on-demand detail).
 */

describe('listLeads — slim projection', () => {
  beforeEach(() => resetMockPostgres());

  const slimRow = {
    id: 7,
    channel: 'line',
    line_user_id: 'U123',
    extracted_spec: null,
    customer_name: 'ลูกค้า',
    customer_contact: null,
    lead_status: 'ใหม่',
    assigned_to: null,
    converted_order_id: null,
    created_at: '2026-07-22T01:00:00Z',
    updated_at: '2026-07-22T02:00:00Z',
    last_message: 'ขอราคาโบรชัวร์',
    turn_count: 6,
    quote_count: 2,
  };

  it('never selects the conversation column wholesale (no s.*)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await listLeads();

    expect(sqlCalls[0].text).not.toContain('s.*');
    // lastMessage + turnCount are SQL-derived, not JS-derived from the blob.
    expect(sqlCalls[0].text).toContain('jsonb_array_length');
    expect(sqlCalls[0].text).toContain("->> 'text'");
  });

  it('maps lastMessage/turnCount/quoteCount and ships no conversation field', async () => {
    queueResult({ rows: [slimRow], rowCount: 1 });
    const rows = await listLeads();

    expect(rows).toHaveLength(1);
    expect(rows[0].lastMessage).toBe('ขอราคาโบรชัวร์');
    expect(rows[0].turnCount).toBe(6);
    expect(rows[0].quoteCount).toBe(2);
    expect(rows[0].customerName).toBe('ลูกค้า');
    // The whole point: the row must NOT carry the transcript.
    expect('conversation' in rows[0]).toBe(false);
  });

  it('empty conversation → lastMessage null, turnCount 0', async () => {
    queueResult({ rows: [{ ...slimRow, last_message: null, turn_count: 0 }], rowCount: 1 });
    const rows = await listLeads();

    expect(rows[0].lastMessage).toBeNull();
    expect(rows[0].turnCount).toBe(0);
  });
});

describe('loadConversation — on-demand transcript', () => {
  beforeEach(() => resetMockPostgres());

  it('selects only the conversation column of the one session', async () => {
    queueResult({ rows: [{ conversation: [{ role: 'user', text: 'สวัสดี' }] }], rowCount: 1 });
    const conv = await loadConversation(7);

    expect(conv).toEqual([{ role: 'user', text: 'สวัสดี' }]);
    expect(sqlCalls[0].text).toContain('SELECT conversation FROM ai_quote_sessions');
    expect(sqlCalls[0].values).toContain(7);
  });

  it('returns null when the session does not exist', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadConversation(999)).toBeNull();
  });

  it('returns [] for a session whose conversation is NULL', async () => {
    queueResult({ rows: [{ conversation: null }], rowCount: 1 });
    expect(await loadConversation(7)).toEqual([]);
  });
});
