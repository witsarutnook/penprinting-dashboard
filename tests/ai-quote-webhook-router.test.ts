// tests/ai-quote-webhook-router.test.ts
import { describe, it, expect } from 'vitest';
import { routeInbound, handleInbound, parseTrackCommand } from '@/lib/ai-quote/webhook-router';
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
  it('routes /groupid to groupid', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/groupid', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('groupid');
  });
  it('ignores non-command text from a group (no slip/track/ai noise in groups)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: 'สวัสดีครับ', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('ignore');
  });
  it('routes /track sent from a group to track (customers track in their own group)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
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
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }],
      buildCustomerJobsFlex: () => ({ type: 'flex', altText: 'LIST' }),
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
  it('records one metric row per image (pass → result, drop → null)', async () => {
    const events: Array<{ looksLikeSlip: boolean; result: unknown }> = [];
    const recordSlipCheck = async (ev: { channel: string; looksLikeSlip: boolean; result: unknown }) => { events.push(ev); };

    const pass = stubDeps({ recordSlipCheck });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, pass.deps as never);

    const drop = stubDeps({ recordSlipCheck, isSlipImage: async () => false });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'image', imageMessageId: 'i', replyToken: 'rt' }, drop.deps as never);

    expect(events.length).toBe(2);
    expect(events[0]).toMatchObject({ looksLikeSlip: true });
    expect(events[0].result).not.toBeNull();          // verified → Thunder result attached
    expect(events[1]).toMatchObject({ looksLikeSlip: false, result: null }); // dropped → no Thunder call
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
  it('answers /track sent from a group with a flex card', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound(
      { channel: 'line', channelUserId: 'U', kind: 'text', text: '/track 202606110', replyToken: 'rt', sourceType: 'group', groupId: 'G1' },
      deps as never,
    );
    expect(replies[0]).toMatchObject({ type: 'flex' });
  });
  it('echoes the group id when /groupid is sent in a group', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound(
      { channel: 'line', channelUserId: 'U', kind: 'text', text: '/groupid', replyToken: 'rt', sourceType: 'group', groupId: 'Gabc123' },
      deps as never,
    );
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('Gabc123');
  });
  it('tells the user /groupid is group-only when sent in a 1-on-1 chat', async () => {
    const { replies, deps } = stubDeps();
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/groupid', replyToken: 'rt' }, deps as never);
    expect(replies.length).toBe(1);
    expect(replies[0]).toContain('เฉพาะในกลุ่ม');
  });
});

describe('parseTrackCommand', () => {
  it('parses an order id (>=6 digits)', () => {
    expect(parseTrackCommand('/track 202606110')).toEqual({ kind: 'order', id: '202606110' });
  });
  it('parses bare /track as a customer command with no keyword', () => {
    expect(parseTrackCommand('/track')).toEqual({ kind: 'customer', keyword: undefined });
  });
  it('parses /track <name> as a customer keyword', () => {
    expect(parseTrackCommand('/track โบรชัวร์')).toEqual({ kind: 'customer', keyword: 'โบรชัวร์' });
  });
  it('returns null for non-track text', () => {
    expect(parseTrackCommand('สวัสดีครับ')).toBeNull();
  });
});

describe('routeInbound — track-customer (group name search)', () => {
  it('routes bare /track from a group to track-customer', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track-customer');
  });
  it('routes /track <name> from a group to track-customer', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track โบรชัวร์', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track-customer');
  });
  it('keeps /track <id> as the order route even in a group', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track 202606110', sourceType: 'group', groupId: 'G1' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('track');
  });
  it('ignores bare /track in a 1-on-1 chat (no group binding = no identity)', () => {
    const m: InboundMessage = { ...base, kind: 'text', text: '/track' };
    expect(routeInbound(m, { aiEnabled: false })).toBe('ignore');
  });
});

describe('handleInbound — track-customer', () => {
  it('guides the user when the group is not registered', async () => {
    const { replies, deps } = stubDeps({ loadRegistrationByGroup: async () => null });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'Gx' }, deps as never);
    expect(replies.length).toBe(1);
    expect(String(replies[0])).toContain('ยังไม่ได้ลงทะเบียน');
  });
  it('answers a single active job with the full order card', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }],
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(replies[0]).toMatchObject({ type: 'flex' }); // buildOrderFlex stub
  });
  it('answers multiple active jobs with the summary bubble', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [{ orderId: 100 }, { orderId: 101 }],
      buildCustomerJobsFlex: () => ({ type: 'flex', altText: 'LIST' }),
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(replies[0]).toMatchObject({ altText: 'LIST' });
  });
  it('replies empty-state when the customer has no active jobs', async () => {
    const { replies, deps } = stubDeps({
      loadRegistrationByGroup: async () => ({ customers: ['บ.เอ'] }),
      loadActiveJobsByCustomer: async () => [],
    });
    await handleInbound({ channel: 'line', channelUserId: 'U', kind: 'text', text: '/track', replyToken: 'rt', sourceType: 'group', groupId: 'G1' }, deps as never);
    expect(String(replies[0])).toContain('ไม่มีงาน');
  });
});
