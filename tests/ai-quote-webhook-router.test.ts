// tests/ai-quote-webhook-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeInbound, handleInbound } from '@/lib/ai-quote/webhook-router';
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

function stubDeps(over: Record<string, unknown> = {}) {
  const replies: unknown[] = [];
  return {
    replies,
    deps: {
      adapter: {
        downloadImage: async () => new Blob(['x']),
        reply: async (_m: unknown, message: string | object) => { replies.push(message); },
        push: async () => {},
      },
      blobToBase64: async () => ({ data: 'AAA', mediaType: 'image/jpeg' }),
      isSlipImage: async () => true,
      verifyBankSlipImage: async () => ({ success: true, data: { isDuplicate: false, isAccountMatched: true, rawSlip: { amount: { amount: 50 } } } }),
      buildSlipFlex: () => ({ type: 'flex', altText: 'SLIP_OK' }),
      loadOrder: async () => ({ order: { name: 'งานเอ' }, job: null, shipped: null, cancelled: null }),
      buildOrderFlex: () => ({ type: 'flex' }),
      anthropic: {} as never,
      visionModel: 'm',
      aiEnabled: false,
      ...over,
    },
  };
}

describe('handleInbound', () => {
  it('verifies a slip image and replies with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex', altText: 'SLIP_OK' });
  });
  it('skips Thunder when the pre-filter says the image is NOT a slip', async () => {
    let thunderCalled = false;
    const { replies, deps } = stubDeps({
      isSlipImage: async () => false,
      verifyBankSlipImage: async () => { thunderCalled = true; return { success: false }; },
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, deps as never);
    expect(thunderCalled).toBe(false);
    expect(replies.length).toBe(0); // เงียบ (ไม่ใช่สลิป → ประหยัด Thunder quota)
  });
  it('answers /track with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 202606110', replyToken: 'rt' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex' }); // flex object sent
  });
  it('replies (not-found bubble) when the order does not exist', async () => {
    const { replies, deps } = stubDeps({ loadOrder: async () => ({ order: null, job: null, shipped: null, cancelled: null }) });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 999999', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(1);
  });
  it('ignores non-track text when AI disabled', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: 'สวัสดี', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(0);
  });
});
