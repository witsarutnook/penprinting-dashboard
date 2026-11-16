import { describe, it, expect } from 'vitest';
import {
  PEAK_ORDER_POSTBACK_PREFIX, encodePostback, decodePostback, type OrderPostback,
} from '@/lib/peak-order/postback';

const D = 'abcdefghijkl'; // 12-char draft id
const LONG_STAFF = 'staff_'.concat('x'.repeat(40));

const variants: OrderPostback[] = [
  { a: 'who', orderer: 0, args: '' },
  { a: 'who', orderer: -1, args: 'QO-202611001' },
  { a: 'who', orderer: 3, args: 'ใบปลิว ร้านกาแฟ 5000' },
  { a: 'who', orderer: 2, args: 'a|b%7C c%25 | |' },
  { a: 'pick', code: 'QO-202611001' },
  { a: 'pick', code: 'ก|ข%' },
  { a: 'rest', code: 'QO-202611001' },
  { a: 'mode', draft: D, v: 'merged' },
  { a: 'mode', draft: D, v: 'split' },
  { a: 'unit', draft: D, u: 0, v: 0 },
  { a: 'unit', draft: D, u: 11, v: 5 },
  { a: 'unit', draft: D, u: 2, v: 'skip' },
  { a: 'gfx', draft: D, u: 1, v: LONG_STAFF },
  { a: 'gfx', draft: D, u: 1, v: 'none' },
  { a: 'gfx', draft: D, u: 1, v: 'same' },
  { a: 'press', draft: D, u: 4, v: LONG_STAFF },
  { a: 'press', draft: D, u: 4, v: 'none' },
  { a: 'date', draft: D, u: 0, v: '+1' },
  { a: 'date', draft: D, u: 0, v: '+2' },
  { a: 'date', draft: D, u: 0, v: '+3' },
  { a: 'date', draft: D, u: 0, v: '+5' },
  { a: 'date', draft: D, u: 0, v: '+7' },
  { a: 'date', draft: D, u: 0, v: 'pick' },
  { a: 'ok', draft: D, u: 0, v: 'create' },
  { a: 'ok', draft: D, u: 0, v: 'draft' },
  { a: 'dup', draft: D, u: 0, v: 'force' },
  { a: 'x', draft: D },
];

describe('encodePostback / decodePostback', () => {
  it('prefix constant', () => expect(PEAK_ORDER_POSTBACK_PREFIX).toBe('po1|'));

  it.each(variants.map((v, i) => [i, v] as const))('round-trips variant %i', (_i, p) => {
    const s = encodePostback(p);
    expect(s.startsWith('po1|')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(300);
    expect(decodePostback(s)).toEqual(p);
  });

  it('who with 400-char args drops args and stays <= 300', () => {
    const s = encodePostback({ a: 'who', orderer: 1, args: 'ก'.repeat(400) });
    expect(s.length).toBeLessThanOrEqual(300);
    expect(decodePostback(s)).toEqual({ a: 'who', orderer: 1, args: '' });
  });

  it('who with args whose escaped form just fits keeps them; just over drops them', () => {
    const head = 'po1|who|1|'.length;
    const fit = '|'.repeat(Math.floor((300 - head) / 3)); // each | escapes to 3 chars
    expect(decodePostback(encodePostback({ a: 'who', orderer: 1, args: fit }))).toEqual({ a: 'who', orderer: 1, args: fit });
    const over = '|'.repeat(Math.floor((300 - head) / 3) + 1);
    expect(decodePostback(encodePostback({ a: 'who', orderer: 1, args: over }))).toEqual({ a: 'who', orderer: 1, args: '' });
  });

  it('worst realistic case: 12-char draft, long staff id, still <= 300', () => {
    const s = encodePostback({ a: 'press', draft: D, u: 99, v: 'x'.repeat(120) });
    expect(s.length).toBeLessThanOrEqual(300);
  });

  it('encode never emits an unescaped extra delimiter for values containing |', () => {
    const s = encodePostback({ a: 'pick', code: 'a|b' });
    expect(s.split('|')).toHaveLength(3);
  });

  it('throws RangeError (programmer error) when a non-who postback cannot fit 300', () => {
    expect(() => encodePostback({ a: 'pick', code: 'x'.repeat(400) })).toThrow(RangeError);
  });
});

describe('decodePostback malformed input -> null, never throws', () => {
  const bad: Array<[string, unknown]> = [
    ['foreign data', 'ai_quote_start'],
    ['prefix only', 'po1|'],
    ['unknown action', 'po1|nope|x'],
    ['empty string', ''],
    ['non-string', undefined],
    ['non-string number', 42],
    ['unit non-numeric u', `po1|unit|${D}|a|0`],
    ['unit non-numeric v', `po1|unit|${D}|0|zz`],
    ['unit negative u', `po1|unit|${D}|-1|0`],
    ['unit negative v', `po1|unit|${D}|0|-1`],
    ['unit huge u', `po1|unit|${D}|99999999999999999999|0`],
    ['unit unsafe u', `po1|unit|${D}|9007199254740993|0`],
    ['unit float u', `po1|unit|${D}|1.5|0`],
    ['unit exp u', `po1|unit|${D}|1e2|0`],
    ['unit hex u', `po1|unit|${D}|0x1|0`],
    ['unit leading zero u', `po1|unit|${D}|01|0`],
    ['unit space u', `po1|unit|${D}| 1|0`],
    ['unit empty u', `po1|unit|${D}||0`],
    ['unit missing v', `po1|unit|${D}|0`],
    ['unit extra field', `po1|unit|${D}|0|0|extra`],
    ['unit empty draft', 'po1|unit||0|0'],
    ['mode unknown v', `po1|mode|${D}|both`],
    ['mode missing v', `po1|mode|${D}`],
    ['mode empty draft', 'po1|mode||merged'],
    ['mode extra separator', `po1|mode|${D}|merged|`],
    ['who non-numeric', 'po1|who|abc|x'],
    ['who -2', 'po1|who|-2|x'],
    ['who huge', 'po1|who|99999999999999999999|x'],
    ['who missing args field', 'po1|who|1'],
    ['who extra separator', 'po1|who|1|a|b'],
    ['pick empty code', 'po1|pick|'],
    ['pick extra', 'po1|pick|QO-1|x'],
    ['rest empty code', 'po1|rest|'],
    ['gfx empty v', `po1|gfx|${D}|0|`],
    ['press empty v', `po1|press|${D}|0|`],
    ['date unknown v', `po1|date|${D}|0|+4`],
    ['ok unknown v', `po1|ok|${D}|0|maybe`],
    ['dup unknown v', `po1|dup|${D}|0|nope`],
    ['x empty draft', 'po1|x|'],
    ['x extra', `po1|x|${D}|1`],
    ['bad escape', 'po1|pick|a%zz'],
    ['lone percent', 'po1|pick|a%'],
    ['over-long data', `po1|pick|${'a'.repeat(400)}`],
  ];
  it.each(bad)('%s', (_n, input) => {
    expect(() => decodePostback(input as string)).not.toThrow();
    expect(decodePostback(input as string)).toBeNull();
  });
});
