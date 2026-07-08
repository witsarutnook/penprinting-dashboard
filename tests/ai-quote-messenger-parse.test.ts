// tests/ai-quote-messenger-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseMessengerEvents } from '@/lib/ai-quote/channels/messenger';

function page(messaging: unknown[]) {
  return { object: 'page', entry: [{ id: 'PAGE1', messaging }] };
}

describe('parseMessengerEvents', () => {
  it('parses a text message', () => {
    const body = page([{ sender: { id: '24680' }, message: { text: 'ขอราคาโบรชัวร์' } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '24680', kind: 'text', text: 'ขอราคาโบรชัวร์',
    }]);
  });
  it('prefers quick_reply.payload over the (20-char-truncated) title text', () => {
    const body = page([{ sender: { id: '1' }, message: { text: '🤖 เริ่มขอราคา A…', quick_reply: { payload: '/ขอราคา AI' } } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '1', kind: 'text', text: '/ขอราคา AI',
    }]);
  });
  it('parses an image attachment (CDN URL carried in imageMessageId)', () => {
    const body = page([{ sender: { id: '2' }, message: { attachments: [{ type: 'image', payload: { url: 'https://cdn.fb/x.jpg' } }] } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '2', kind: 'image', imageMessageId: 'https://cdn.fb/x.jpg',
    }]);
  });
  it('parses a postback', () => {
    const body = page([{ sender: { id: '3' }, postback: { payload: 'ai_quote_start' } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '3', kind: 'postback', postbackData: 'ai_quote_start',
    }]);
  });
  it('skips echo events (page/staff-sent messages must never enter the pipeline)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, message: { is_echo: true, text: 'ตอบจาก Page inbox' } }]);
    expect(parseMessengerEvents(body)).toEqual([]);
  });
  it('drops non-image attachments (sticker/audio/file) and events without sender', () => {
    expect(parseMessengerEvents(page([{ sender: { id: '4' }, message: { attachments: [{ type: 'audio', payload: { url: 'https://cdn.fb/a.mp3' } }] } }]))).toEqual([]);
    expect(parseMessengerEvents(page([{ message: { text: 'x' } }]))).toEqual([]);
  });
  it('drops non-page objects and malformed bodies (never throws)', () => {
    expect(parseMessengerEvents({ object: 'instagram', entry: [] })).toEqual([]);
    expect(parseMessengerEvents(null)).toEqual([]);
    expect(parseMessengerEvents({})).toEqual([]);
    expect(parseMessengerEvents({ object: 'page', entry: [{}] })).toEqual([]);
  });
});
