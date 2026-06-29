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
  it('drops group/room events', () => {
    const body = { events: [{
      type: 'message', replyToken: 'rt',
      source: { type: 'group', groupId: 'G1', userId: 'U1' },
      message: { type: 'text', text: 'hi' },
    }] };
    expect(parseLineEvents(body)).toEqual([]);
  });
  it('drops unsupported message types (sticker/location) and bad bodies', () => {
    const sticker = { events: [{ type: 'message', source: { type: 'user', userId: 'U' }, message: { type: 'sticker' } }] };
    expect(parseLineEvents(sticker)).toEqual([]);
    expect(parseLineEvents(null)).toEqual([]);
    expect(parseLineEvents({})).toEqual([]);
  });
});
