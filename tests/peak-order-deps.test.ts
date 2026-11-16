import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InboundMessage } from '@/lib/ai-quote/channels/types';

vi.mock('server-only', () => ({}));

const createClientMock = vi.fn();
const createReaderMock = vi.fn();
vi.mock('@/lib/peak/mcp-client', () => ({ createPeakClient: (...a: unknown[]) => createClientMock(...a) }));
vi.mock('@/lib/peak/read', () => ({ createPeakReader: (...a: unknown[]) => createReaderMock(...a) }));
vi.mock('@/lib/peak-order/db', () => ({ peakOrderDb: { tag: 'db' }, newDraftId: () => 'draft-1' }));
vi.mock('@/lib/orders-create', () => ({ createOrderFromForm: vi.fn() }));
const profileMock = vi.fn();
vi.mock('@/lib/ai-quote/channels/line', () => ({ getLineProfile: (...a: unknown[]) => profileMock(...a) }));
const textMock = vi.fn();
const postbackMock = vi.fn();
vi.mock('@/lib/peak-order/handler', () => ({
  handlePeakOrderText: (...a: unknown[]) => textMock(...a),
  handlePeakOrderPostback: (...a: unknown[]) => postbackMock(...a),
}));

import { peakOrderConfig, buildPeakOrderArm, makePeakReply } from '@/lib/peak-order/deps';
import { TEXT } from '@/lib/peak-order/flex';

const KEY = Buffer.alloc(32, 3).toString('base64');
const ENV_ON = { PEAK_ORDER_ENABLED: 'true', PEAK_ORDER_GROUP_IDS: 'G1', PEAK_TOKEN_ENC_KEY: KEY } as unknown as NodeJS.ProcessEnv;
const msg = { channel: 'line', channelUserId: 'U1', kind: 'text', text: '/order SECRET-TEXT', sourceType: 'group', groupId: 'G1' } as InboundMessage;
const card = (n: string) => ({ flex: { type: 'flex', altText: n }, text: `text-${n}` });

beforeEach(() => {
  vi.resetAllMocks();
  createClientMock.mockImplementation(() => ({ id: Symbol('client') }));
  createReaderMock.mockImplementation((c: unknown) => ({ client: c }));
});
afterEach(() => vi.restoreAllMocks());

describe('peakOrderConfig', () => {
  it('enabled only with all three values', () => {
    expect(peakOrderConfig(ENV_ON)).toEqual({ enabled: true, groupIds: ['G1'] });
    expect(peakOrderConfig({ ...ENV_ON, PEAK_ORDER_ENABLED: 'false' }).enabled).toBe(false);
    expect(peakOrderConfig({ ...ENV_ON, PEAK_ORDER_ENABLED: undefined }).enabled).toBe(false);
    expect(peakOrderConfig({ ...ENV_ON, PEAK_ORDER_GROUP_IDS: ' , ' }).enabled).toBe(false);
    expect(peakOrderConfig({ ...ENV_ON, PEAK_ORDER_GROUP_IDS: undefined }).enabled).toBe(false);
    expect(peakOrderConfig({ ...ENV_ON, PEAK_TOKEN_ENC_KEY: '' }).enabled).toBe(false);
    expect(peakOrderConfig({} as NodeJS.ProcessEnv)).toEqual({ enabled: false, groupIds: [] });
  });
  it('splits, trims and drops empties', () => {
    expect(peakOrderConfig({ ...ENV_ON, PEAK_ORDER_GROUP_IDS: ' G1, ,G2 ' }).groupIds).toEqual(['G1', 'G2']);
  });
});

describe('buildPeakOrderArm', () => {
  const adapter = { reply: vi.fn<(m: InboundMessage, x: unknown) => Promise<void>>() };
  it('undefined when disabled (any missing value)', () => {
    expect(buildPeakOrderArm(adapter, {} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_ORDER_ENABLED: undefined })).toBeUndefined();
    expect(buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_ORDER_GROUP_IDS: '' })).toBeUndefined();
    expect(buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_TOKEN_ENC_KEY: undefined })).toBeUndefined();
  });
  it('returns the arm when enabled, doing no I/O at build time', () => {
    const arm = buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_ORDER_GROUP_IDS: 'G1,G2' })!;
    expect(arm.groupIds).toEqual(['G1', 'G2']);
    expect(typeof arm.handleText).toBe('function');
    expect(typeof arm.handlePostback).toBe('function');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(profileMock).not.toHaveBeenCalled();
  });
  it('garbage key: still builds without throwing', () => {
    for (const k of ['not base64 !!!', 'AAAA']) {
      expect(() => buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_TOKEN_ENC_KEY: k })).not.toThrow();
      expect(buildPeakOrderArm(adapter, { ...ENV_ON, PEAK_TOKEN_ENC_KEY: k })).toBeDefined();
    }
  });
  it('a new Peak client per inbound message', async () => {
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await arm.handleText(msg);
    await arm.handlePostback({ ...msg, kind: 'postback' });
    expect(createClientMock).toHaveBeenCalledTimes(2);
    const readers = [textMock.mock.calls[0][1].peak, postbackMock.mock.calls[0][1].peak];
    expect(readers[0]).not.toBe(readers[1]);
    expect(readers[0].client).not.toBe(readers[1].client);
  });
  it('wires deps: db, display name, now, newDraftId', async () => {
    profileMock.mockResolvedValueOnce({ displayName: 'Somchai' }).mockResolvedValueOnce(null);
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await arm.handleText(msg);
    const deps = textMock.mock.calls[0][1];
    expect(deps.db).toEqual({ tag: 'db' });
    expect(deps.newDraftId()).toBe('draft-1');
    expect(deps.now()).toBeInstanceOf(Date);
    expect(await deps.getDisplayName('U1')).toBe('Somchai');
    expect(await deps.getDisplayName('U1')).toBeNull();
    expect(typeof deps.createOrder).toBe('function');
  });
  it('swallows and safely logs an unexpected throw; next call still works', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn2 = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class BoomDb extends Error { name = 'BoomDb'; }
    textMock.mockRejectedValueOnce(new BoomDb('password=hunter2 /order SECRET-TEXT')).mockResolvedValueOnce(undefined);
    postbackMock.mockRejectedValueOnce(new Error('tok'));
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await expect(arm.handleText(msg)).resolves.toBeUndefined();
    await expect(arm.handlePostback({ ...msg, kind: 'postback' })).resolves.toBeUndefined();
    await expect(arm.handleText(msg)).resolves.toBeUndefined();
    expect(textMock).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify([...warn.mock.calls, ...warn2.mock.calls]);
    expect(logged).toContain('BoomDb');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('SECRET-TEXT');
    expect(logged).not.toContain('tok');
  });
});

describe('buildPeakOrderArm — an unexpected error is answered, never silent', () => {
  const adapter = { reply: vi.fn<(m: InboundMessage, x: unknown) => Promise<void>>() };
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  const logged = () => JSON.stringify(err.mock.calls);

  it('text handler throws → exactly one reply with TEXT.unexpected', async () => {
    textMock.mockRejectedValueOnce(new Error('relation "peak_order_staff" does not exist'));
    adapter.reply.mockResolvedValue(undefined);
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await expect(arm.handleText(msg)).resolves.toBeUndefined();
    expect(adapter.reply).toHaveBeenCalledTimes(1);
    expect(adapter.reply).toHaveBeenCalledWith(msg, TEXT.unexpected);
    expect(logged()).not.toContain('peak_order_staff');
  });

  it('postback handler throws → exactly one reply with TEXT.unexpected', async () => {
    postbackMock.mockRejectedValueOnce(new TypeError('x is undefined'));
    adapter.reply.mockResolvedValue(undefined);
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    const pb = { ...msg, kind: 'postback' } as InboundMessage;
    await expect(arm.handlePostback(pb)).resolves.toBeUndefined();
    expect(adapter.reply).toHaveBeenCalledTimes(1);
    expect(adapter.reply).toHaveBeenCalledWith(pb, TEXT.unexpected);
  });

  it('the apology reply throws too → nothing escapes, logged by class label only', async () => {
    textMock.mockRejectedValueOnce(new Error('boom SECRET-A'));
    adapter.reply.mockRejectedValue(new Error('LINE 400 SECRET-B'));
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await expect(arm.handleText(msg)).resolves.toBeUndefined();
    expect(adapter.reply).toHaveBeenCalledTimes(1);
    expect(logged()).not.toContain('SECRET-A');
    expect(logged()).not.toContain('SECRET-B');
    expect(err.mock.calls.length).toBe(2);
  });

  it('a thrown SQLSTATE code is logged (e.g. 42P01 table missing), the message is not', async () => {
    const e = Object.assign(new Error('relation "peak_order_drafts" does not exist SECRET'), { code: '42P01' });
    textMock.mockRejectedValueOnce(e);
    adapter.reply.mockResolvedValue(undefined);
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await arm.handleText(msg);
    expect(logged()).toContain('42P01');
    expect(logged()).not.toContain('SECRET');
    expect(logged()).not.toContain('peak_order_drafts');
  });

  it('a code that is not a SQLSTATE is not logged', async () => {
    textMock.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'Bearer abc.def' }));
    adapter.reply.mockResolvedValue(undefined);
    await buildPeakOrderArm(adapter, ENV_ON)!.handleText(msg);
    expect(logged()).not.toContain('Bearer');
  });

  it('a handler that returns silently (malformed postback) still sends nothing', async () => {
    postbackMock.mockResolvedValueOnce(undefined);
    const arm = buildPeakOrderArm(adapter, ENV_ON)!;
    await arm.handlePostback({ ...msg, kind: 'postback', postbackData: 'garbage' } as InboundMessage);
    expect(adapter.reply).not.toHaveBeenCalled();
  });
});

describe('makePeakReply', () => {
  type ReplyFn = (m: InboundMessage, x: unknown, q?: unknown) => Promise<void>;
  let reply: ReturnType<typeof vi.fn<ReplyFn>>;
  beforeEach(() => {
    reply = vi.fn<ReplyFn>();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends the flex of a card', async () => {
    reply.mockResolvedValue(undefined);
    await makePeakReply({ reply })(msg, card('a'));
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(msg, card('a').flex);
  });
  it('falls back to the text when the flex send throws', async () => {
    reply.mockRejectedValueOnce(new Error('flex refused')).mockResolvedValueOnce(undefined);
    await makePeakReply({ reply })(msg, card('a'));
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1]).toEqual([msg, 'text-a']);
  });
  it('rethrows when the text send also fails', async () => {
    reply.mockRejectedValue(new Error('down'));
    await expect(makePeakReply({ reply })(msg, card('a'))).rejects.toThrow('down');
    expect(reply).toHaveBeenCalledTimes(2);
  });
  it('strings pass through as a single send, no fallback', async () => {
    reply.mockResolvedValue(undefined);
    await makePeakReply({ reply })(msg, 'hello');
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(msg, 'hello');
    reply.mockReset().mockRejectedValue(new Error('x'));
    await expect(makePeakReply({ reply })(msg, 'hello')).rejects.toThrow();
    expect(reply).toHaveBeenCalledTimes(1);
  });
  it('an array is one reply call with all messages', async () => {
    reply.mockResolvedValue(undefined);
    await makePeakReply({ reply })(msg, [card('a'), 'mid', card('b')]);
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(msg, [card('a').flex, 'mid', card('b').flex]);
  });
  it('array with a refused flex: resend the whole array as texts in one call', async () => {
    reply.mockRejectedValueOnce(new Error('flex refused')).mockResolvedValueOnce(undefined);
    await makePeakReply({ reply })(msg, [card('a'), 'mid', card('b')]);
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1]).toEqual([msg, ['text-a', 'mid', 'text-b']]);
  });
  it('does not log the error message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    reply.mockRejectedValueOnce(new Error('Bearer SECRETTOKEN')).mockResolvedValueOnce(undefined);
    await makePeakReply({ reply })(msg, card('a'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRETTOKEN');
  });
});
