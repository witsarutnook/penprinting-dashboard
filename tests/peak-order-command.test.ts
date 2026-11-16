import { describe, expect, it } from 'vitest';
import { isOrderCommand, orderCommandArgs, parseOrderCommand } from '@/lib/peak-order/command';

describe('parseOrderCommand', () => {
  it('no args -> latest', () => {
    expect(parseOrderCommand('/order')).toEqual({ kind: 'latest' });
    expect(parseOrderCommand('  /order   ')).toEqual({ kind: 'latest' });
  });
  it('full code, case/space insensitive, normalised', () => {
    expect(parseOrderCommand('/ORDER  qo-20260900097 ')).toEqual({ kind: 'code', code: 'QO-20260900097' });
    expect(parseOrderCommand('/order QO20260900097')).toEqual({ kind: 'code', code: 'QO-20260900097' });
  });
  it('3+ digits -> digits; short number is text', () => {
    expect(parseOrderCommand('/order 900097')).toEqual({ kind: 'digits', digits: '900097' });
    expect(parseOrderCommand('/order 97')).toEqual({ kind: 'text', words: ['97'] });
  });
  it('free text split on whitespace incl. newlines', () => {
    expect(parseOrderCommand('/order ไทยฟูดส์  ไวนิล')).toEqual({ kind: 'text', words: ['ไทยฟูดส์', 'ไวนิล'] });
    expect(parseOrderCommand('/order\nไทยฟูดส์')).toEqual({ kind: 'text', words: ['ไทยฟูดส์'] });
  });
  it('not a command -> null', () => {
    expect(parseOrderCommand('order x')).toBeNull();
    expect(parseOrderCommand('/orders')).toBeNull();
    expect(parseOrderCommand('สวัสดี /order')).toBeNull();
  });
  it('keeps at most 6 words', () => {
    const r = parseOrderCommand('/order a b c d e f g h');
    expect(r).toEqual({ kind: 'text', words: ['a', 'b', 'c', 'd', 'e', 'f'] });
  });
  it('isOrderCommand / orderCommandArgs', () => {
    expect(isOrderCommand(' /Order')).toBe(true);
    expect(isOrderCommand('/orders')).toBe(false);
    expect(orderCommandArgs('/order  hello world ')).toBe('hello world');
    expect(orderCommandArgs('/order')).toBe('');
  });
});
