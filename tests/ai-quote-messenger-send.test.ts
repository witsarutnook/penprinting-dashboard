// tests/ai-quote-messenger-send.test.ts
import { describe, it, expect } from 'vitest';
import { buildMessengerSendBody, messengerQuickReplies } from '@/lib/ai-quote/channels/messenger';

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
