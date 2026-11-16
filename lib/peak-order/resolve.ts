import 'server-only';
import type { PeakQuotation, PeakQuotationRow, PeakReader } from '@/lib/peak/read';
import { PeakUnavailableError } from '@/lib/peak/oauth';
import type { OrderCommand } from '@/lib/peak-order/command';
import { addDaysISO, firstLine } from '@/lib/peak-order/mapper';

export interface QuotationChoice {
  code: string;
  issuedDate: string;
  customerName: string;
  netAmount: number | null;
  firstLine: string;
  opened: boolean;
}
export type Resolved =
  | { kind: 'quotation'; quotation: PeakQuotation; customerName: string }
  | { kind: 'choices'; heading: string; choices: QuotationChoice[]; note?: string }
  | { kind: 'not-found'; hint: string };

export const MAX_PEAK_CALLS = 40;
export const PEAK_CONCURRENCY = 3;
/**
 * Wall-clock budget for all Peak calls of one command. The LINE route has 60 s
 * (maxDuration); DB work and the LINE reply need the rest.
 */
export const RESOLVE_BUDGET_MS = 25_000;
/** Appended to every not-found reply (spec §4.6: "ไม่เจอ + ตัวอย่างวิธีพิมพ์"). */
export const NOT_FOUND_EXAMPLE = 'ตัวอย่าง: /order QO-20260900097 หรือ /order ชื่อลูกค้า';
/** Echoed user text (searched words / code) is clipped to this many code points. */
export const ECHO_MAX = 80;

/** One line, at most ECHO_MAX code points (… on cut). */
export function clipEcho(s: string): string {
  const one = String(s).replace(/\s+/g, ' ').trim();
  const cps = Array.from(one);
  return cps.length <= ECHO_MAX ? one : cps.slice(0, ECHO_MAX - 1).join('') + '…';
}

/** `head` + the shared usage example, as a not-found hint. */
export function notFoundHint(head: string): string {
  return `${head}\n${NOT_FOUND_EXAMPLE}`;
}

const SHOWN = 5;
const FILTER_POOL = 20;

/**
 * Wraps a PeakReader so EVERY Peak call counts against a hard cap and shares a
 * concurrency limit. Once the cap is hit, calls are not made and return an
 * empty value (null / [] / total 0), so the caller returns what it has.
 * Time is capped too: a call that would START after `budgetMs` since the
 * limiter was made throws PeakUnavailableError ("Peak ไม่ตอบ") instead, and so
 * does every later one — no further Peak call is started.
 */
function limitReader(
  inner: PeakReader,
  maxCalls: number,
  concurrency: number,
  budgetMs: number,
  nowMs: () => number,
): PeakReader {
  const startedAt = nowMs();
  let calls = 0;
  let active = 0;
  const waiters: Array<() => void> = [];
  async function run<T>(empty: T, fn: () => Promise<T>): Promise<T> {
    if (calls >= maxCalls) return empty;
    calls++;
    if (active >= concurrency) await new Promise<void>((r) => waiters.push(r));
    else active++;
    try {
      if (nowMs() - startedAt > budgetMs) throw new PeakUnavailableError('Peak resolve time budget exceeded');
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next(); // hand the slot over
      else active--;
    }
  }
  return {
    getQuotation: (code) => run<PeakQuotation | null>(null, () => inner.getQuotation(code)),
    listQuotations: (q) => run({ rows: [] as PeakQuotationRow[], total: 0 }, () => inner.listQuotations(q)),
    newestQuotations: (q, n) => run<PeakQuotationRow[]>([], () => inner.newestQuotations(q, n)),
    getContactName: (c) => run<string | null>(null, () => inner.getContactName(c)),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export async function resolveOrderCommand(
  cmd: OrderCommand,
  deps: {
    peak: PeakReader;
    openedCodes: (codes: string[]) => Promise<Set<string>>;
    todayISO: string;
    /** Test hook; defaults are the production limits and the real clock. */
    limits?: { maxCalls?: number; concurrency?: number; budgetMs?: number; nowMs?: () => number };
  },
): Promise<Resolved> {
  const peak = limitReader(
    deps.peak,
    deps.limits?.maxCalls ?? MAX_PEAK_CALLS,
    deps.limits?.concurrency ?? PEAK_CONCURRENCY,
    deps.limits?.budgetMs ?? RESOLVE_BUDGET_MS,
    deps.limits?.nowMs ?? Date.now,
  );

  const quotCache = new Map<string, Promise<PeakQuotation | null>>();
  const getQ = (code: string) => {
    let p = quotCache.get(code);
    if (!p) quotCache.set(code, (p = peak.getQuotation(code)));
    return p;
  };
  const nameCache = new Map<string, Promise<string | null>>();
  const nameOf = async (contactCode: string): Promise<string> => {
    let p = nameCache.get(contactCode);
    if (!p) nameCache.set(contactCode, (p = peak.getContactName(contactCode)));
    return (await p) || contactCode;
  };

  async function asQuotation(code: string): Promise<Resolved> {
    const quotation = await getQ(code);
    if (!quotation) return { kind: 'not-found', hint: notFoundHint(`ไม่พบใบเสนอราคา ${clipEcho(code)}`) };
    return { kind: 'quotation', quotation, customerName: await nameOf(quotation.contactCode) };
  }

  async function asChoices(rows: PeakQuotationRow[], heading: string, note?: string): Promise<Resolved> {
    const shown = rows.slice(0, SHOWN);
    const [opened, details, names] = await Promise.all([
      deps.openedCodes(shown.map((r) => r.code)),
      Promise.all(shown.map((r) => getQ(r.code))),
      Promise.all(shown.map((r) => nameOf(r.contactCode))),
    ]);
    const choices: QuotationChoice[] = shown.map((r, i) => ({
      code: r.code,
      issuedDate: r.issuedDate,
      customerName: names[i],
      netAmount: r.netAmount,
      firstLine: firstLine(details[i]?.lines[0]?.description ?? ''),
      opened: opened.has(r.code),
    }));
    return { kind: 'choices', heading, choices, ...(note ? { note } : {}) };
  }

  async function byDigits(digits: string): Promise<Resolved> {
    const first = await peak.listQuotations({ searchText: digits, page: 1 });
    if (first.total <= 0 || first.rows.length === 0) {
      return { kind: 'not-found', hint: notFoundHint(`ไม่พบใบเสนอราคาที่ตรงกับ "${clipEcho(digits)}"`) };
    }
    if (first.total === 1) return asQuotation(first.rows[0].code);
    const rows = await peak.newestQuotations({ searchText: digits }, SHOWN);
    return asChoices(rows, `พบ ${first.total} ใบ — ${SHOWN} ใบล่าสุด`);
  }

  switch (cmd.kind) {
    case 'latest': {
      const rows = await peak.newestQuotations({ dateStart: addDaysISO(deps.todayISO, -30) }, SHOWN);
      if (rows.length === 0) return { kind: 'not-found', hint: notFoundHint('ไม่พบใบเสนอราคาใน 30 วันที่ผ่านมา') };
      return asChoices(rows, `${SHOWN} ใบล่าสุด`);
    }
    case 'code': {
      const r = await asQuotation(cmd.code);
      if (r.kind === 'quotation') return r;
      const digits = cmd.code.replace(/\D/g, '');
      return digits ? byDigits(digits) : r;
    }
    case 'digits':
      return byDigits(cmd.digits);
    case 'text': {
      const words = cmd.words;
      if (words.length === 0) return { kind: 'not-found', hint: notFoundHint('กรุณาระบุคำค้นหา') };
      let k = words.length;
      let first: { rows: PeakQuotationRow[]; total: number } | null = null;
      let query = '';
      for (; k >= 1; k--) {
        query = words.slice(0, k).join(' ');
        const res = await peak.listQuotations({ searchText: query, page: 1 });
        if (res.total > 0 && res.rows.length > 0) {
          first = res;
          break;
        }
      }
      if (!first) return { kind: 'not-found', hint: notFoundHint(`ไม่พบใบเสนอราคาที่ตรงกับ "${clipEcho(words.join(' '))}"`) };
      const filter = words.slice(k).map(norm).filter((w) => w !== '');
      if (filter.length === 0) {
        if (first.total === 1) return asQuotation(first.rows[0].code);
        const rows = await peak.newestQuotations({ searchText: query }, SHOWN);
        return asChoices(rows, `พบ ${first.total} ใบ — ${SHOWN} ใบล่าสุด`);
      }
      const pool = await peak.newestQuotations({ searchText: query }, FILTER_POOL);
      const details = await Promise.all(pool.map((r) => getQ(r.code)));
      const survivors = pool.filter((_, i) => {
        const q = details[i];
        if (!q) return false;
        const text = norm(q.lines.map((l) => l.description).join(' '));
        return filter.every((w) => text.includes(w));
      });
      if (survivors.length > 0) return asChoices(survivors, `พบ ${survivors.length} ใบ — ${SHOWN} ใบล่าสุด`);
      return asChoices(
        pool,
        `${SHOWN} ใบล่าสุดของ "${query}"`,
        `ไม่พบคำว่า "${words.slice(k).join(' ')}" ในรายการ จึงแสดงใบล่าสุดของ "${query}" แทน`,
      );
    }
  }
}
