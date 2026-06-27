// tests/ai-quote-webhook-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeInbound } from '@/lib/ai-quote/webhook-router';
import type { InboundMessage } from '@/lib/ai-quote/channels/types';

const base = { channel: 'line' as const, channelUserId: 'U1', replyToken: 'rt' };

describe('routeInbound (Phase 1b-A, aiEnabled=false)', () => {
  it('routes images to slip', () => {
    const m: InboundMessage = { ...base, kind: 'image', imageMessageId: 'i1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('slip');
  });
  it('routes /track text to track', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
  });
  it('ignores non-track text when AI disabled', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'ขอราคาใบปลิว' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
  it('ignores postback when AI disabled', () => {
    const m: InboundMessage = { ...base, kind: 'postback', postbackData: 'ai_quote_start' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
  it('(forward-compat) routes non-track text to ai when enabled', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'ขอราคาใบปลิว' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('ai');
  });
});
