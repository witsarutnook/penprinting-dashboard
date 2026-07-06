// tests/ai-quote-line-mode.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  modeActive, hintAllowed, MODE_IDLE_MINUTES, HINT_GATE_HOURS,
  loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent,
} from '@/lib/ai-quote/line-mode';

const NOW = Date.parse('2026-07-06T10:00:00Z');
const min = (n: number) => n * 60_000;

describe('modeActive (lazy 30-min idle expiry — spec §1, no cron)', () => {
  it('true within the idle window', () => {
    expect(modeActive(new Date(NOW - min(29)).toISOString(), NOW)).toBe(true);
  });
  it('false once idle exceeds the window', () => {
    expect(modeActive(new Date(NOW - min(MODE_IDLE_MINUTES + 1)).toISOString(), NOW)).toBe(false);
  });
  it('false for null / unparsable timestamps (never throws)', () => {
    expect(modeActive(null, NOW)).toBe(false);
    expect(modeActive('not-a-date', NOW)).toBe(false);
  });
});

describe('hintAllowed (≤1 hint/user/24h — spec §2)', () => {
  it('true when never hinted', () => {
    expect(hintAllowed(null, NOW)).toBe(true);
  });
  it('false inside the 24h gate', () => {
    expect(hintAllowed(new Date(NOW - min(60)).toISOString(), NOW)).toBe(false);
  });
  it('true again after the gate lapses', () => {
    expect(hintAllowed(new Date(NOW - (HINT_GATE_HOURS + 1) * 3_600_000).toISOString(), NOW)).toBe(true);
  });
});

describe('mode DB fns (query shape pins)', () => {
  beforeEach(() => resetMockPostgres());

  it('loadLineMode maps snake_case row → LineModeRow', async () => {
    queueResult({ rows: [{ channel_user_id: 'U1', entered_at: 't1', last_activity_at: 't2', session_id: '7', rounds_no_quote: 2, last_hint_at: null }], rowCount: 1 });
    const r = await loadLineMode('U1');
    expect(r).toEqual({ channelUserId: 'U1', enteredAt: 't1', lastActivityAt: 't2', sessionId: 7, roundsNoQuote: 2, lastHintAt: null });
  });
  it('enterLineMode upserts and resets rounds but NOT last_hint_at', async () => {
    await enterLineMode('U1');
    const call = findCallContaining('ON CONFLICT (channel_user_id)');
    expect(call?.text).toContain('rounds_no_quote = 0');
    expect(call?.text).not.toContain('last_hint_at');
  });
  it('exitLineMode nulls mode fields but keeps last_hint_at', async () => {
    await exitLineMode('U1');
    const call = findCallContaining('entered_at = NULL');
    expect(call?.text).toContain('session_id = NULL');
    expect(call?.text).not.toContain('last_hint_at');
  });
  it('markHintSent upserts last_hint_at only', async () => {
    await markHintSent('U1');
    const call = findCallContaining('last_hint_at = NOW()');
    expect(call).toBeDefined();
    expect(call?.text).not.toContain('entered_at = NOW()');
  });
  it('touchLineMode COALESCEs optional fields', async () => {
    await touchLineMode('U1', { sessionId: 9 });
    const call = findCallContaining('last_activity_at = NOW()');
    expect(call?.text).toContain('COALESCE');
    expect(call?.values).toContain(9);
  });
});
