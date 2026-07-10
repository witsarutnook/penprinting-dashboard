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

  // HINT-1: echo classification — only when ourAppId is provided
  it('own-app echo is skipped (the bot echoes every AI reply)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 1234, text: 'AI ตอบ' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([]);
  });
  it('other-app echo → staff-echo carrying the CUSTOMER psid (recipient, not sender)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 263902037430900, text: 'ตอบจาก inbox' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([
      { channel: 'messenger', kind: 'staff-echo', channelUserId: '555' },
    ]);
  });
  it('echo without app_id (Page inbox send) → staff-echo', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '556' }, message: { is_echo: true, text: 'จาก inbox' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([
      { channel: 'messenger', kind: 'staff-echo', channelUserId: '556' },
    ]);
  });
  it('without ourAppId EVERY echo is skipped — fail-safe (misclassified own echo would kick users out of AI mode)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 99, text: 'x' } }]);
    expect(parseMessengerEvents(body)).toEqual([]);
  });
  it('echo without recipient id is dropped (never throws)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, message: { is_echo: true, text: 'x' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([]);
  });
});
