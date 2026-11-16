/**
 * Postback `data` codec for the LINE peak-order flow. PURE module: no
 * 'server-only' (imported by lib/ai-quote/channels/line.ts) and no runtime
 * import of any server-only module.
 *
 * Wire format: `po1|<action>|<field>|<field>…` — fields separated by `|`.
 * Free-text fields (`args`, `code`, `draft`, staff ids) are escaped with a
 * minimal two-entry scheme so they can hold `|`, `%` and Thai text without
 * percent-encoding every character: `%` -> `%25`, `|` -> `%7C`. The decoder is
 * strict (any other `%` sequence is malformed) because the encoder never
 * emits one. Integers (`orderer`, `u`, unit `v`) are canonical decimal only
 * (`0`, `12`; `orderer` may also be `-1`), at most 3 digits.
 *
 * LINE limit: postback `data` <= 300 characters. `decodePostback` receives
 * attacker-controllable text (anyone in the group can forge a postback) and
 * returns null for anything malformed — it never throws.
 */
export const PEAK_ORDER_POSTBACK_PREFIX = 'po1|';
export const POSTBACK_DATA_MAX = 300;

export type OrderPostback =
  | { a: 'who'; orderer: number; args: string }
  | { a: 'pick'; code: string }
  | { a: 'rest'; code: string }
  | { a: 'mode'; draft: string; v: 'merged' | 'split' }
  | { a: 'unit'; draft: string; u: number; v: number | 'skip' }
  | { a: 'gfx'; draft: string; u: number; v: string }
  | { a: 'press'; draft: string; u: number; v: string }
  | { a: 'date'; draft: string; u: number; v: string }
  | { a: 'ok'; draft: string; u: number; v: 'create' | 'draft' }
  | { a: 'dup'; draft: string; u: number; v: 'force' }
  | { a: 'x'; draft: string };

const DATE_VALUES = ['+1', '+2', '+3', '+5', '+7', 'pick'];

function esc(s: string): string {
  return s.replace(/[%|]/g, (c) => (c === '%' ? '%25' : '%7C'));
}

/** Strict inverse of esc(); null on any stray `%`. */
function unesc(s: string): string | null {
  if (/%(?!25|7C)/.test(s)) return null;
  return s.replace(/%(25|7C)/g, (_m, h: string) => (h === '25' ? '%' : '|'));
}

function parseIdx(s: string, allowNeg = false): number | null {
  if (allowNeg && s === '-1') return -1;
  return /^(0|[1-9]\d{0,2})$/.test(s) ? Number(s) : null;
}

function safeIdx(n: number, allowNeg = false): number {
  if (!Number.isInteger(n) || n > 999 || n < (allowNeg ? -1 : 0)) {
    throw new RangeError('postback index out of range');
  }
  return n;
}

function build(p: OrderPostback, withArgs = true): string {
  const head = PEAK_ORDER_POSTBACK_PREFIX + p.a;
  switch (p.a) {
    case 'who': return `${head}|${safeIdx(p.orderer, true)}|${withArgs ? esc(p.args) : ''}`;
    case 'pick':
    case 'rest': return `${head}|${esc(p.code)}`;
    case 'x': return `${head}|${esc(p.draft)}`;
    case 'mode': return `${head}|${esc(p.draft)}|${p.v}`;
    default: return `${head}|${esc(p.draft)}|${safeIdx(p.u)}|${typeof p.v === 'number' ? safeIdx(p.v) : esc(p.v)}`;
  }
}

/** Always starts with the prefix and is <= 300 chars. 'who' drops `args` if it
 *  would not fit; any other variant that cannot fit is a programmer error
 *  (RangeError — draft ids / codes / staff ids are short). */
export function encodePostback(p: OrderPostback): string {
  let s = build(p);
  if (s.length > POSTBACK_DATA_MAX && p.a === 'who') s = build(p, false);
  if (s.length > POSTBACK_DATA_MAX) throw new RangeError('postback data exceeds 300 characters');
  return s;
}

function nonEmpty(s: string | undefined): string | null {
  if (s === undefined || s === '') return null;
  const u = unesc(s);
  return u === null || u === '' ? null : u;
}

export function decodePostback(data: string): OrderPostback | null {
  try {
    if (typeof data !== 'string' || data.length > POSTBACK_DATA_MAX) return null;
    if (!data.startsWith(PEAK_ORDER_POSTBACK_PREFIX)) return null;
    const parts = data.slice(PEAK_ORDER_POSTBACK_PREFIX.length).split('|');
    const [a, f1, f2, f3] = parts;
    switch (a) {
      case 'who': {
        if (parts.length !== 3) return null;
        const orderer = parseIdx(f1, true);
        const args = unesc(f2);
        return orderer === null || args === null ? null : { a, orderer, args };
      }
      case 'pick':
      case 'rest': {
        if (parts.length !== 2) return null;
        const code = nonEmpty(f1);
        return code === null ? null : { a, code };
      }
      case 'x': {
        if (parts.length !== 2) return null;
        const draft = nonEmpty(f1);
        return draft === null ? null : { a, draft };
      }
      case 'mode': {
        if (parts.length !== 3) return null;
        const draft = nonEmpty(f1);
        if (draft === null || (f2 !== 'merged' && f2 !== 'split')) return null;
        return { a, draft, v: f2 };
      }
      case 'unit':
      case 'gfx':
      case 'press':
      case 'date':
      case 'ok':
      case 'dup': {
        if (parts.length !== 4) return null;
        const draft = nonEmpty(f1);
        const u = parseIdx(f2);
        if (draft === null || u === null) return null;
        if (a === 'unit') {
          if (f3 === 'skip') return { a, draft, u, v: 'skip' };
          const v = parseIdx(f3);
          return v === null ? null : { a, draft, u, v };
        }
        if (a === 'ok') return f3 === 'create' || f3 === 'draft' ? { a, draft, u, v: f3 } : null;
        if (a === 'dup') return f3 === 'force' ? { a, draft, u, v: 'force' } : null;
        if (a === 'date') return DATE_VALUES.includes(f3) ? { a, draft, u, v: f3 } : null;
        const v = nonEmpty(f3);
        return v === null ? null : { a, draft, u, v };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
