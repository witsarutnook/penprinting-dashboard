import 'server-only';
import { PeakToolError, type PeakClient } from '@/lib/peak/mcp-client';

/**
 * Typed read-only Peak readers on top of PeakClient.
 *
 * Peak data is untrusted. Parsing is defensive: an unusable payload (not an
 * object, wrong envelope, non-"200" resCode, non-array list) throws
 * `PeakToolError` with a fixed message (never the payload). Individual garbled
 * fields degrade to ''/null; list entries without a `code` are skipped.
 */

export interface PeakLine {
  key: string;
  description: string;
  quantity: number | null;
  price: number | null;
}
export interface PeakQuotation {
  code: string;
  status: string;
  issuedDate: string;
  contactCode: string;
  netAmount: number | null;
  lines: PeakLine[];
}
export interface PeakQuotationRow {
  code: string;
  issuedDate: string;
  contactCode: string;
  netAmount: number | null;
}
export interface PeakListQuery {
  searchText?: string;
  dateStart?: string;
  dateEnd?: string;
}
export interface PeakReader {
  /** null = not found. Throws PeakToolError on an unusable payload. */
  getQuotation(code: string): Promise<PeakQuotation | null>;
  listQuotations(q: PeakListQuery & { page: number }): Promise<{ rows: PeakQuotationRow[]; total: number }>;
  /** Newest first. */
  newestQuotations(q: PeakListQuery, n: number): Promise<PeakQuotationRow[]>;
  getContactName(contactCode: string): Promise<string | null>;
}

const PAGE_SIZE = 50;

type Obj = Record<string, unknown>;
function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
/** Lone (unpaired) UTF-16 surrogates — Postgres rejects them (like NUL) in JSONB/text. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/**
 * Every Peak string goes through here: a NUL is dropped and a lone surrogate
 * becomes U+FFFD, so a snapshot of the quotation can always be stored as JSONB.
 */
function str(v: unknown): string {
  return typeof v === 'string' ? v.replaceAll('\u0000', '').replace(LONE_SURROGATE, '\uFFFD') : '';
}
function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
/** yyyyMMdd -> yyyy-mm-dd ('' when absent/garbled). */
function fromWireDate(v: unknown): string {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
/** yyyy-mm-dd -> yyyyMMdd. */
function toWireDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new RangeError('Invalid ISO date');
  return `${m[1]}${m[2]}${m[3]}`;
}

/** Unwrap `{ [envelope]: { [listKey]: [...], resCode } }` or throw PeakToolError. */
function unwrap(raw: unknown, envelope: string, listKey: string, tool: string): { list: unknown[]; body: Obj } {
  const body = isObj(raw) ? raw[envelope] : undefined;
  if (!isObj(body)) throw new PeakToolError(`Peak ${tool} returned an unexpected payload`);
  if (body.resCode !== undefined && String(body.resCode) !== '200') {
    throw new PeakToolError(`Peak ${tool} returned resCode ${String(body.resCode).slice(0, 10)}`);
  }
  const list = body[listKey];
  if (list === null || list === undefined) return { list: [], body };
  if (!Array.isArray(list)) throw new PeakToolError(`Peak ${tool} returned an unexpected payload`);
  return { list, body };
}

function toRow(o: Obj): PeakQuotationRow {
  return {
    code: str(o.code),
    issuedDate: fromWireDate(o.issuedDate),
    contactCode: str(o.contactCode),
    netAmount: num(o.netAmount),
  };
}

function toLines(products: unknown): PeakLine[] {
  if (!Array.isArray(products)) return [];
  const used = new Set<string>();
  return products.map((p, i) => {
    const o = isObj(p) ? p : {};
    const id = str(o.id);
    let key = id.trim() !== '' ? id : `idx:${i}`;
    // Keys are idempotency keys downstream: force uniqueness if Peak repeats an id.
    if (used.has(key)) key = `idx:${i}`;
    used.add(key);
    return { key, description: str(o.description), quantity: num(o.quantity), price: num(o.price) };
  });
}

export function createPeakReader(client: PeakClient): PeakReader {
  async function listPage(q: PeakListQuery, page: number): Promise<{ rows: PeakQuotationRow[]; total: number }> {
    const args: Record<string, unknown> = {};
    if (q.searchText) args.searchText = q.searchText;
    if (q.dateStart) args.dateStart = toWireDate(q.dateStart);
    if (q.dateEnd) args.dateEnd = toWireDate(q.dateEnd);
    args.limit = PAGE_SIZE;
    args.page = page;
    const raw = await client.call('list_quotation', args);
    const { list, body } = unwrap(raw, 'PeakQuotations', 'quotations', 'list_quotation');
    const rows = list.filter(isObj).map(toRow).filter((r) => r.code !== '');
    const t = num(body.totalQuotation);
    return { rows, total: t !== null && t >= 0 ? Math.floor(t) : rows.length };
  }

  return {
    async getQuotation(code) {
      const raw = await client.call('get_quotation', { code });
      const { list } = unwrap(raw, 'PeakQuotations', 'quotations', 'get_quotation');
      if (list.length === 0) return null;
      const entries = list.filter(isObj);
      if (entries.length === 0) throw new PeakToolError('Peak get_quotation returned an unexpected payload');
      // Never substitute a different quotation: only an exact (trimmed, case-insensitive) code match counts.
      const want = code.trim().toLowerCase();
      const o = entries.find((e) => str(e.code).trim().toLowerCase() === want);
      if (!o) return null;
      if (o.resCode !== undefined && String(o.resCode) !== '200') {
        throw new PeakToolError(`Peak get_quotation returned resCode ${String(o.resCode).slice(0, 10)}`);
      }
      return { ...toRow(o), status: str(o.status), lines: toLines(o.products) };
    },

    listQuotations(q) {
      return listPage(q, q.page);
    },

    async newestQuotations(q, n) {
      if (!Number.isInteger(n) || n <= 0) return [];
      const first = await listPage(q, 1);
      if (first.total <= 0) return [];
      const last = Math.ceil(first.total / PAGE_SIZE);
      if (last <= 1) return first.rows.slice().reverse().slice(0, n);
      const lastRows = (await listPage(q, last)).rows;
      let ordered = lastRows;
      if (lastRows.length < n) {
        const prev = (await listPage(q, last - 1)).rows;
        ordered = [...prev, ...lastRows];
      }
      return ordered.slice().reverse().slice(0, n);
    },

    async getContactName(contactCode) {
      // limit 10 (not 1): a prefix/substring match may sort ahead of the exact code.
      const raw = await client.call('search_contacts', { searchText: contactCode, limit: 10 });
      const { list } = unwrap(raw, 'PeakContacts', 'contacts', 'search_contacts');
      for (const c of list) {
        if (isObj(c) && c.code === contactCode) {
          const name = str(c.name).trim();
          return name === '' ? null : name;
        }
      }
      return null;
    },
  };
}
