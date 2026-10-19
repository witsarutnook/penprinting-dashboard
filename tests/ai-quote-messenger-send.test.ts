// tests/ai-quote-messenger-send.test.ts
import { afterEach, describe, it, expect, vi } from 'vitest';
import { buildMessengerAdapter, buildMessengerSendBody, messengerQuickReplies } from '@/lib/ai-quote/channels/messenger';

describe('messengerQuickReplies', () => {
  it('maps generic {label,text} → {content_type,title,payload}', () => {
    expect(messengerQuickReplies([{ label: '🤖 เริ่มขอราคา AI', text: '/ขอราคา AI' }])).toEqual([
      { content_type: 'text', title: '🤖 เริ่มขอราคา AI', payload: '/ขอราคา AI' },
    ]);
  });
  it('returns undefined for empty/missing list', () => {
    expect(messengerQuickReplies([])).toBeUndefined();
    expect(messengerQuickReplies(undefined)).toBeUndefined();
  });
});

describe('buildMessengerSendBody', () => {
  it('wraps a string as a text message with RESPONSE type', () => {
    expect(buildMessengerSendBody('24680', 'สวัสดีค่ะ')).toEqual({
      recipient: { id: '24680' }, messaging_type: 'RESPONSE', message: { text: 'สวัสดีค่ะ' },
    });
  });
  it('attaches quick replies to a text message', () => {
    const body = buildMessengerSendBody('1', 'hint', [{ label: 'L', text: 'T' }]);
    expect((body.message as Record<string, unknown>).quick_replies).toEqual([
      { content_type: 'text', title: 'L', payload: 'T' },
    ]);
  });
  it('passes a ready-made message object through (e.g. slip text message)', () => {
    expect(buildMessengerSendBody('2', { text: 'สลิปถูกต้อง' })).toEqual({
      recipient: { id: '2' }, messaging_type: 'RESPONSE', message: { text: 'สลิปถูกต้อง' },
    });
  });
});

describe('buildMessengerAdapter.reply with multiple messages', () => {
  const prevToken = process.env.FB_PAGE_TOKEN;
  afterEach(() => {
    vi.unstubAllGlobals();
    if (prevToken === undefined) delete process.env.FB_PAGE_TOKEN;
    else process.env.FB_PAGE_TOKEN = prevToken;
  });

  it('adapter.reply with an array sends one Send API call per message, in order, quick replies on the last', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', fetchMock); process.env.FB_PAGE_TOKEN = 'tok';
    await buildMessengerAdapter('s').reply({ channel: 'messenger', channelUserId: 'P1', kind: 'text' }, [{ attachment: { type: 'image', payload: { url: 'u', is_reusable: true } } }, 'ข้อความ'], [{ label: 'L', text: 'T' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].message.attachment.type).toBe('image'); expect(bodies[0].message.quick_replies).toBeUndefined();
    expect(bodies[1].message.text).toBe('ข้อความ'); expect(bodies[1].message.quick_replies).toHaveLength(1);
  });

  it('awaits each send before starting the next (image lands before text)', async () => {
    let releaseFirst!: (v: { ok: boolean }) => void;
    const first = new Promise<{ ok: boolean }>((resolve) => { releaseFirst = resolve; });
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock); process.env.FB_PAGE_TOKEN = 'tok';

    const pending = buildMessengerAdapter('s').reply(
      { channel: 'messenger', channelUserId: 'P1', kind: 'text' },
      [{ attachment: { type: 'image', payload: { url: 'u', is_reusable: true } } }, 'ข้อความ'],
    );
    await new Promise((r) => setTimeout(r, 0));   // let any (wrongly) parallel send fire
    expect(fetchMock).toHaveBeenCalledTimes(1);   // text must NOT start while the image is in flight

    releaseFirst({ ok: true });
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0].message.attachment.type).toBe('image');
    expect(bodies[1].message.text).toBe('ข้อความ');
  });

  it('stops at the first failed send — later messages are not sent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 }).mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock); process.env.FB_PAGE_TOKEN = 'tok';
    await expect(buildMessengerAdapter('s').reply(
      { channel: 'messenger', channelUserId: 'P1', kind: 'text' },
      [{ attachment: { type: 'image', payload: { url: 'u', is_reusable: true } } }, 'ข้อความ'],
    )).rejects.toThrow('Messenger send HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
