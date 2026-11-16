// tests/ai-quote-line-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseLineEvents } from '@/lib/ai-quote/channels/line';

describe('parseLineEvents', () => {
  it('parses a 1-on-1 text message', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt1',
      source: { type: 'user', userId: 'U123' },
      message: { type: 'text', text: '/track 202606110' },
    }] };
    expect(parseLineEvents(body)).toEqual([{
      channel: 'line', channelUserId: 'U123', kind: 'text',
      text: '/track 202606110', replyToken: 'rt1',
    }]);
  });
  it('parses an image message', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt2',
      source: { type: 'user', userId: 'U9' },
      message: { type: 'image', id: 'IMG77' },
    }] };
    expect(parseLineEvents(body)).toEqual([{
      channel: 'line', channelUserId: 'U9', kind: 'image',
      imageMessageId: 'IMG77', replyToken: 'rt2',
    }]);
  });
  it('parses a postback', () => {
    const body = { events: [{
      type: 'postback', replyToken: 'rt3',
      source: { type: 'user', userId: 'U5' },
      postback: { data: 'ai_quote_start' },
    }] };
    expect(parseLineEvents(body)).toEqual([{
      channel: 'line', channelUserId: 'U5', kind: 'postback',
      postbackData: 'ai_quote_start', replyToken: 'rt3',
    }]);
  });
  it('parses group text (carries groupId for /groupid)', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt',
      source: { type: 'group', groupId: 'G1', userId: 'U1' },
      message: { type: 'text', text: '/groupid' },
    }] };
    expect(parseLineEvents(body)).toEqual([{
      channel: 'line', channelUserId: 'U1', kind: 'text',
      text: '/groupid', replyToken: 'rt', sourceType: 'group', groupId: 'G1',
    }]);
  });
  it('parses room text (carries roomId; userId optional)', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt',
      source: { type: 'room', roomId: 'R1' },
      message: { type: 'text', text: '/groupid' },
    }] };
    expect(parseLineEvents(body)).toEqual([{
      channel: 'line', channelUserId: '', kind: 'text',
      text: '/groupid', replyToken: 'rt', sourceType: 'room', roomId: 'R1',
    }]);
  });
  it('drops non-text group events (images/postback stay ignored in groups)', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt',
      source: { type: 'group', groupId: 'G1', userId: 'U1' },
      message: { type: 'image', id: 'IMG1' },
    }] };
    expect(parseLineEvents(body)).toEqual([]);
  });
  it('drops unsupported message types (sticker/location) and bad bodies', () => {
    const sticker = { events: [{ type: 'message', source: { type: 'user', userId: 'U' }, message: { type: 'sticker' } }] };
    expect(parseLineEvents(sticker)).toEqual([]);
    expect(parseLineEvents(null)).toEqual([]);
    expect(parseLineEvents({})).toEqual([]);
  });
  describe('peak-order group postbacks', () => {
    const pb = (source: object, data: string, params?: object) => ({ events: [{
      type: 'postback', replyToken: 'rtp', source, postback: params ? { data, params } : { data },
    }] });
    it('emits a prefixed group postback', () => {
      expect(parseLineEvents(pb({ type: 'group', groupId: 'G1', userId: 'U1' }, 'po1|x|abc'))).toEqual([{
        channel: 'line', channelUserId: 'U1', kind: 'postback', postbackData: 'po1|x|abc',
        postbackParams: { date: undefined }, replyToken: 'rtp', sourceType: 'group', groupId: 'G1',
      }]);
    });
    it('carries params.date from the datetimepicker', () => {
      const out = parseLineEvents(pb({ type: 'group', groupId: 'G1', userId: 'U1' }, 'po1|x|abc', { date: '2026-11-20' }));
      expect(out).toHaveLength(1);
      expect(out[0].kind).toBe('postback');
      expect(out[0].sourceType).toBe('group');
      expect(out[0].groupId).toBe('G1');
      expect(out[0].postbackParams?.date).toBe('2026-11-20');
    });
    it('group postback without userId -> channelUserId empty string', () => {
      const out = parseLineEvents(pb({ type: 'group', groupId: 'G1' }, 'po1|x|abc'));
      expect(out[0].channelUserId).toBe('');
    });
    it('non-string params.date is not forwarded', () => {
      const out = parseLineEvents(pb({ type: 'group', groupId: 'G1', userId: 'U1' }, 'po1|x|abc', { date: 123 }));
      expect(out[0].postbackParams?.date).toBeUndefined();
    });
    it('drops a non-peak group postback (ai_quote_start)', () => {
      expect(parseLineEvents(pb({ type: 'group', groupId: 'G1', userId: 'U1' }, 'ai_quote_start'))).toEqual([]);
    });
    it('drops a prefixed room postback', () => {
      expect(parseLineEvents(pb({ type: 'room', roomId: 'R1', userId: 'U1' }, 'po1|x|abc'))).toEqual([]);
    });
    it('group image is still dropped', () => {
      expect(parseLineEvents({ events: [{
        type: 'message', replyToken: 'rt', source: { type: 'group', groupId: 'G1', userId: 'U1' },
        message: { type: 'image', id: 'IMG1' },
      }] })).toEqual([]);
    });
    it('1-on-1 postback with params carries postbackParams', () => {
      const out = parseLineEvents(pb({ type: 'user', userId: 'U5' }, 'po1|x|abc', { date: '2026-11-20' }));
      expect(out[0].postbackParams).toEqual({ date: '2026-11-20' });
    });
  });
});
