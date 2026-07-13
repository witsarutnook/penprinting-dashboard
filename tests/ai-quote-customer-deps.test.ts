// tests/ai-quote-customer-deps.test.ts — shared CustomerAiDeps wiring (follow-up 7/10)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import type Anthropic from '@anthropic-ai/sdk';
import {
  rateLimitKey, lineHintEnabled, messengerHintEnabled, normalizeFbAppId,
  buildCustomerAiDeps,
} from '@/lib/ai-quote/customer-deps';

const anthropic = {} as unknown as Anthropic;
const noopCreate = async () => ({ id: 1, customerName: null });

describe('hint flag composition (pure — route-level convention)', () => {
  it('lineHintEnabled: only the exact string "true" enables', () => {
    expect(lineHintEnabled('true')).toBe(true);
    expect(lineHintEnabled('TRUE')).toBe(false);
    expect(lineHintEnabled('false')).toBe(false);
    expect(lineHintEnabled('')).toBe(false);
    expect(lineHintEnabled(undefined)).toBe(false);
  });

  it('messengerHintEnabled: flag AND FB_APP_ID — fail-closed without the echo signal (HINT-1)', () => {
    expect(messengerHintEnabled('true', '890064264151011')).toBe(true);
    // no FB_APP_ID → echoes can't be classified → hint must stay off
    expect(messengerHintEnabled('true', undefined)).toBe(false);
    expect(messengerHintEnabled('true', '')).toBe(false);
    expect(messengerHintEnabled('false', '890064264151011')).toBe(false);
    expect(messengerHintEnabled(undefined, '890064264151011')).toBe(false);
  });
});

describe('normalizeFbAppId (HINT-1 I1 — whitespace would break echo classification)', () => {
  it('trims padding and maps empty/blank to undefined', () => {
    expect(normalizeFbAppId(' 890064264151011\n')).toBe('890064264151011');
    expect(normalizeFbAppId('890064264151011')).toBe('890064264151011');
    expect(normalizeFbAppId('')).toBeUndefined();
    expect(normalizeFbAppId('   ')).toBeUndefined();
    expect(normalizeFbAppId(undefined)).toBeUndefined();
  });
});

describe('rateLimitKey — prefixes are live counter state, changing one resets a channel', () => {
  it('keeps the historical per-channel prefixes', () => {
    expect(rateLimitKey('line', 'U123')).toBe('ai-quote-line:U123');
    expect(rateLimitKey('messenger', '999')).toBe('ai-quote-msgr:999');
  });
});

describe('buildCustomerAiDeps channel wiring', () => {
  beforeEach(() => resetMockPostgres());

  const build = (channel: 'line' | 'messenger', hintEnabled = false) =>
    buildCustomerAiDeps({
      channel, hintEnabled, createSessionForUser: noopCreate,
      anthropic, quoteUrl: 'https://calc.example', quoteToken: 'tok',
    });

  it('loadSessionForUser scopes the M5 owner-check to its own channel', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await build('messenger').loadSessionForUser(7, 'PSID-1');
    expect(sqlCalls[0].text).toContain('channel =');
    expect(sqlCalls[0].values).toContain('messenger');
    expect(sqlCalls[0].values).toContain('PSID-1');

    queueResult({ rows: [], rowCount: 0 });
    await build('line').loadSessionForUser(7, 'U-A');
    expect(sqlCalls[1].values).toContain('line');
    expect(sqlCalls[1].values).toContain('U-A');
  });

  it('passes hintEnabled through and injects the channel session creator', async () => {
    expect(build('line', true).hintEnabled).toBe(true);
    expect(build('messenger', false).hintEnabled).toBe(false);
    expect(await build('line').createSessionForUser('U-A')).toEqual({ id: 1, customerName: null });
  });
});
