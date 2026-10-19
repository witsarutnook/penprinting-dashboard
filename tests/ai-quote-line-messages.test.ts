// tests/ai-quote-line-messages.test.ts
import { describe, it, expect } from 'vitest';
import { buildLineMessages, LINE_MAX_MESSAGES } from '@/lib/ai-quote/channels/line';

describe('buildLineMessages', () => {
  it('wraps a string as one text message (unchanged behaviour)', () => {
    expect(buildLineMessages('hi')).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('keeps order and attaches quick replies to the LAST message only', () => {
    const out = buildLineMessages(
      [{ type: 'image', originalContentUrl: 'u', previewImageUrl: 'u' }, 'text'],
      [{ label: 'L', text: 'T' }],
    );
    expect(out[0]).toEqual({ type: 'image', originalContentUrl: 'u', previewImageUrl: 'u' });
    expect(out[1]).toMatchObject({
      type: 'text', text: 'text',
      quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'L', text: 'T' } }] },
    });
  });

  it('caps at 5 messages keeping the last one', () => {
    const out = buildLineMessages(['a', 'b', 'c', 'd', 'e', 'f', 'last']);
    expect(out).toHaveLength(LINE_MAX_MESSAGES);
    // exactly the first 4 + the last (not any other subset of 5)
    expect(out).toEqual(['a', 'b', 'c', 'd', 'last'].map((text) => ({ type: 'text', text })));
  });
});
