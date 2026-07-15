// tests/ai-quote-customer-deps.test.ts — shared CustomerAiDeps wiring (follow-up 7/10)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import type Anthropic from '@anthropic-ai/sdk';
import {
  rateLimitKey, lineHintEnabled, messengerHintEnabled, normalizeFbAppId,
  buildCustomerAiDeps, ceilTo05, roundOutcomeForCustomer,
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

// คุณนุ๊ก 2026-07-15: customer-facing prices ceil to the next 0.05 step (never
// down, floor 0.05) and the model must never see the full-precision number —
// rounding happens on the tool result BEFORE the model reads it. Staff flows
// (quote-assistant/FAB) wire runComputeQuote directly and keep exact numbers.
describe('customer price rounding (ceil to 0.05)', () => {
  it('ceilTo05 rounds up to the next 0.05 step with a 0.05 floor', () => {
    expect(ceilTo05(1.17625)).toBe(1.2);   // the real case from the screenshot
    expect(ceilTo05(0.98)).toBe(1);
    expect(ceilTo05(3.53)).toBe(3.55);
    expect(ceilTo05(54.98)).toBe(55);
    expect(ceilTo05(0.03)).toBe(0.05);     // tiny per-piece price → minimum step
  });
  it('ceilTo05 leaves exact 0.05 multiples alone (no float-drift bump)', () => {
    expect(ceilTo05(1.2)).toBe(1.2);
    expect(ceilTo05(0.3)).toBe(0.3);       // 0.3*20 = 6.000000000000001 in floats
    expect(ceilTo05(150)).toBe(150);       // namecard fix rates untouched
  });
  it('roundOutcomeForCustomer rounds unitPrice, drops VAT fields, keeps the rest', () => {
    const out = roundOutcomeForCustomer({
      ok: true, productType: 'brochure', spec: { qty: 10000 },
      result: { mode: 'offset', unitPrice: 1.17625, unitPriceVat: 1.2585875, totalPrice: 11762.5, totalPriceVat: 12585.875 },
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.unitPrice).toBe(1.2);
      expect(out.result).not.toHaveProperty('unitPriceVat');
      expect(out.result).not.toHaveProperty('totalPriceVat');
      expect(out.result.mode).toBe('offset');       // non-price fields pass through
      expect(out.result.totalPrice).toBe(11762.5);  // namecard needs totalPrice — kept as-is
    }
  });
  it('roundOutcomeForCustomer passes calc errors through untouched', () => {
    const err = { ok: false as const, recoverable: true as const, message: 'สเปคไม่ครบ' };
    expect(roundOutcomeForCustomer(err)).toBe(err);
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
