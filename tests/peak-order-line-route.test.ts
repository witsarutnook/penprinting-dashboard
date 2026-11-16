import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const pending: Array<Promise<unknown>> = [];
vi.mock('next/server', async (orig) => {
  const actual = await orig<typeof import('next/server')>();
  return { ...actual, after: (fn: () => Promise<unknown>) => { pending.push(fn()); } };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }));

const adapter = {
  verifySignature: () => true,
  parseEvents: vi.fn(),
  reply: vi.fn(),
  push: vi.fn(),
  downloadImage: vi.fn(),
};
vi.mock('@/lib/ai-quote/channels/line', () => ({ buildLineAdapter: () => adapter, getLineProfile: vi.fn() }));
const handleInboundMock = vi.fn();
vi.mock('@/lib/ai-quote/webhook-router', () => ({ handleInbound: (...a: unknown[]) => handleInboundMock(...a) }));
vi.mock('@/lib/ai-quote/customer-deps', () => ({ buildCustomerAiDeps: vi.fn(), lineHintEnabled: () => false }));
vi.mock('@/lib/ai-quote/slip', () => ({ isSlipImage: vi.fn(), verifyBankSlipImage: vi.fn() }));
vi.mock('@/lib/ai-quote/slip-flex', () => ({ buildSlipFlex: vi.fn() }));
vi.mock('@/lib/ai-quote/slip-metrics', () => ({ recordSlipCheck: vi.fn() }));
vi.mock('@/lib/ai-quote/track-flex', () => ({ buildOrderFlex: vi.fn() }));
vi.mock('@/lib/api', () => ({ loadOrder: vi.fn() }));
vi.mock('@/lib/customer-track', () => ({ loadActiveJobsByCustomer: vi.fn() }));
vi.mock('@/lib/registrations', () => ({ loadRegistrationByGroup: vi.fn() }));
vi.mock('@/lib/ai-quote/customer-jobs-flex', () => ({ buildCustomerJobsFlex: vi.fn() }));
vi.mock('@/lib/ai-quote/db', () => ({ createLineSession: vi.fn() }));
vi.mock('@/lib/peak-order/db', () => ({ peakOrderDb: {}, newDraftId: () => 'd' }));
vi.mock('@/lib/orders-create', () => ({ createOrderFromForm: vi.fn() }));
vi.mock('@/lib/peak/mcp-client', () => ({ createPeakClient: vi.fn() }));
vi.mock('@/lib/peak/read', () => ({ createPeakReader: vi.fn() }));

import { POST } from '@/app/api/ai-quote/line/route';
import * as route from '@/app/api/ai-quote/line/route';
import { CREATING_STALE_MS } from '@/lib/peak-order/handler';

const KEY = Buffer.alloc(32, 3).toString('base64');
const saved = { ...process.env };
function req() {
  return new Request('https://x.test/api/ai-quote/line', { method: 'POST', body: '{}', headers: { 'x-line-signature': 's' } });
}
const m = (id: string) => ({ channel: 'line', channelUserId: id, kind: 'text', text: 'hi' });

beforeEach(() => {
  pending.length = 0;
  handleInboundMock.mockReset();
  adapter.parseEvents.mockReset().mockReturnValue([m('U1'), m('U2')]);
  process.env.LINE_CHANNEL_SECRET = 'sec';
  delete process.env.PEAK_ORDER_ENABLED;
  delete process.env.PEAK_ORDER_GROUP_IDS;
  delete process.env.PEAK_TOKEN_ENC_KEY;
});
afterEach(() => { process.env = { ...saved }; });

describe('LINE route peak-order wiring', () => {
  it('maxDuration stays 60', () => { expect(route.maxDuration).toBe(60); });

  it('disabled => handleInbound receives no peakOrder arm', async () => {
    handleInboundMock.mockResolvedValue(undefined);
    await POST(req() as never);
    await Promise.all(pending);
    expect(handleInboundMock).toHaveBeenCalledTimes(2);
    for (const c of handleInboundMock.mock.calls) expect(c[1].peakOrder).toBeUndefined();
  });

  it('enabled => arm with the configured groups is passed', async () => {
    process.env.PEAK_ORDER_ENABLED = 'true';
    process.env.PEAK_ORDER_GROUP_IDS = 'G1,G2';
    process.env.PEAK_TOKEN_ENC_KEY = KEY;
    handleInboundMock.mockResolvedValue(undefined);
    await POST(req() as never);
    await Promise.all(pending);
    expect(handleInboundMock.mock.calls[0][1].peakOrder.groupIds).toEqual(['G1', 'G2']);
  });

  it('a failing event does not stop the next event in the batch', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.PEAK_ORDER_ENABLED = 'true';
    process.env.PEAK_ORDER_GROUP_IDS = 'G1';
    process.env.PEAK_TOKEN_ENC_KEY = KEY;
    handleInboundMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    await POST(req() as never);
    await Promise.all(pending);
    expect(handleInboundMock).toHaveBeenCalledTimes(2);
  });
});

describe('stale-creating window vs the route budget', () => {
  it('CREATING_STALE_MS is longer than the route maxDuration (a live attempt is never presumed dead)', () => {
    expect(CREATING_STALE_MS).toBeGreaterThan(route.maxDuration * 1000);
  });
});
