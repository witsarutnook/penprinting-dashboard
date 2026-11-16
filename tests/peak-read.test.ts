import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PeakToolError, type PeakClient, type PeakToolName } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';

function fx(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, 'fixtures/peak', name), 'utf8'));
}

type Call = { name: PeakToolName; args: Record<string, unknown> };
function fake(responder: (c: Call, n: number) => unknown) {
  const calls: Call[] = [];
  const client: PeakClient = {
    async call(name, args) {
      const c = { name, args };
      calls.push(c);
      return responder(c, calls.length);
    },
  };
  return { calls, reader: createPeakReader(client) };
}
const quots = (rows: unknown[], total: unknown, resCode: unknown = '200') => ({
  PeakQuotations: { quotations: rows, totalQuotation: total, resCode },
});
const row = (i: number) => ({ code: `QO-${i}`, issuedDate: '20260101', contactCode: 'C1', netAmount: i, status: null, products: [] });
const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => row(from + k));

describe('getQuotation', () => {
  it('maps the fixture', async () => {
    const { reader, calls } = fake(() => fx('get-quotation.json'));
    const q = await reader.getQuotation('QO-20260900097');
    expect(calls).toEqual([{ name: 'get_quotation', args: { code: 'QO-20260900097' } }]);
    expect(q).toEqual({
      code: 'QO-20260900097', status: 'Approve', issuedDate: '2026-09-15', contactCode: 'C01890', netAmount: 3210,
      lines: [{ key: '2cfea6c5-a83e-4ae1-91ae-0df093bb5008', description: 'ไวนิลขนาด 1x2 เมตร\nเจาะรู 4 มุม', quantity: 10, price: 300 }],
    });
  });
  it('returns null for an unknown code', async () => {
    const { reader } = fake(() => fx('get-quotation-empty.json'));
    expect(await reader.getQuotation('QO-X')).toBeNull();
  });
  it('uses idx:<i> for missing/empty ids and keeps decimals', async () => {
    const { reader } = fake(() => fx('get-quotation-multi.json'));
    const q = await reader.getQuotation('QO-20260900101');
    expect(q!.lines.map((l) => l.key)).toEqual([
      'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'idx:2',
    ]);
    expect(q!.lines.map((l) => l.quantity)).toEqual([0.125, 12.5, 1]);
    expect(q!.status).toBe('Draft');
  });
  it('line without id key -> idx:0; duplicate ids are made unique', async () => {
    const mk = (products: unknown) => ({ PeakQuotations: { quotations: [{ code: 'QO-1', products }], resCode: '200' } });
    let payload: unknown = mk([{ description: 'a' }]);
    const { reader } = fake(() => payload);
    expect((await reader.getQuotation('QO-1'))!.lines[0].key).toBe('idx:0');
    payload = mk([{ id: 'dup' }, { id: 'dup' }]);
    expect((await reader.getQuotation('QO-1'))!.lines.map((l) => l.key)).toEqual(['dup', 'idx:1']);
  });
  it('degrades garbled fields and non-array products', async () => {
    const { reader } = fake(() => ({
      PeakQuotations: { quotations: [{ code: 'QO-1', issuedDate: '15/09/2026', status: 5, netAmount: 'abc', products: 'x' }], resCode: '200' },
    }));
    expect(await reader.getQuotation('QO-1')).toEqual({
      code: 'QO-1', status: '', issuedDate: '', contactCode: '', netAmount: null, lines: [],
    });
  });
  it('returns null when the only quotation has a different code (no fallback)', async () => {
    const { reader } = fake(() => fx('get-quotation.json'));
    expect(await reader.getQuotation('QO-20260900098')).toBeNull();
    const b = fake(() => ({ PeakQuotations: { quotations: [{ code: 'QO-2' }, {}], resCode: '200' } }));
    expect(await b.reader.getQuotation('QO-1')).toBeNull();
  });
  it('picks the matching entry even when it is not first (trim/case-insensitive)', async () => {
    const { reader } = fake(() => ({
      PeakQuotations: { quotations: [{ code: 'QO-2', status: 'Draft' }, { code: 'QO-1', status: 'Approve' }], resCode: '200' },
    }));
    expect((await reader.getQuotation(' qo-1 '))!.status).toBe('Approve');
  });
  it.each([
    ['null', null],
    ['string', 'oops'],
    ['wrong envelope', { Other: {} }],
    ['non-array quotations', { PeakQuotations: { quotations: {}, resCode: '200' } }],
    ['outer resCode 500', { PeakQuotations: { quotations: [], resCode: '500' } }],
    ['inner resCode 404', { PeakQuotations: { quotations: [{ resCode: '404', code: 'QO-1' }], resCode: '200' } }],
    ['no object entries', { PeakQuotations: { quotations: [null, 5], resCode: '200' } }],
  ])('malformed payload (%s) throws PeakToolError, not TypeError', async (_n, payload) => {
    const { reader } = fake(() => payload);
    await expect(reader.getQuotation('QO-1')).rejects.toBeInstanceOf(PeakToolError);
  });
});

describe('listQuotations', () => {
  it('sends searchText/limit/page and no date keys', async () => {
    const { reader, calls } = fake(() => fx('list-quotation.json'));
    const r = await reader.listQuotations({ searchText: 'ไทยฟูดส์', page: 1 });
    expect(calls[0]).toEqual({ name: 'list_quotation', args: { searchText: 'ไทยฟูดส์', limit: 50, page: 1 } });
    expect(Object.keys(calls[0].args)).not.toContain('dateStart');
    expect(r).toEqual({ rows: [{ code: 'QO-20260900097', issuedDate: '2026-09-15', contactCode: 'C01890', netAmount: 3210 }], total: 1 });
  });
  it('converts ISO dates to yyyyMMdd', async () => {
    const { reader, calls } = fake(() => fx('list-quotation.json'));
    await reader.listQuotations({ dateStart: '2026-11-01', dateEnd: '2026-11-30', page: 2 });
    expect(calls[0].args).toEqual({ dateStart: '20261101', dateEnd: '20261130', limit: 50, page: 2 });
  });
  it('rejects a malformed ISO date from the caller', async () => {
    const { reader, calls } = fake(() => fx('list-quotation.json'));
    await expect(reader.listQuotations({ dateStart: '1/11/2026', page: 1 })).rejects.toBeInstanceOf(RangeError);
    expect(calls).toHaveLength(0);
  });
  it('no match -> empty, total 0; null total falls back to row count', async () => {
    const { reader } = fake(() => quots([], 0));
    expect(await reader.listQuotations({ page: 1 })).toEqual({ rows: [], total: 0 });
    const b = fake(() => quots(rowsOf(1, 2), null));
    expect((await b.reader.listQuotations({ page: 1 })).total).toBe(2);
  });
  it('skips code-less rows; malformed payload throws PeakToolError', async () => {
    const a = fake(() => quots([row(1), { issuedDate: '20260101' }, 7, null], 4));
    expect((await a.reader.listQuotations({ page: 1 })).rows.map((r) => r.code)).toEqual(['QO-1']);
    const b = fake(() => ({ PeakQuotations: { quotations: 'x', resCode: '200' } }));
    await expect(b.reader.listQuotations({ page: 1 })).rejects.toBeInstanceOf(PeakToolError);
    const c = fake(() => quots([], 0, '401'));
    await expect(c.reader.listQuotations({ page: 1 })).rejects.toBeInstanceOf(PeakToolError);
  });
});

describe('newestQuotations', () => {
  const pages = (page3Rows: number) => (c: Call) => {
    const p = c.args.page;
    if (p === 1) return quots(rowsOf(1, 50), 120);
    if (p === 2) return quots(rowsOf(51, 100), 120);
    return quots(rowsOf(101, 100 + page3Rows), 120);
  };
  it('page 1 and last page only when last page has >= n rows', async () => {
    const { reader, calls } = fake(pages(20));
    const r = await reader.newestQuotations({}, 5);
    expect(calls.map((c) => c.args.page)).toEqual([1, 3]);
    expect(r.map((x) => x.code)).toEqual(['QO-120', 'QO-119', 'QO-118', 'QO-117', 'QO-116']);
  });
  it('also fetches the previous page when last page is short', async () => {
    const { reader, calls } = fake(pages(2));
    const r = await reader.newestQuotations({}, 5);
    expect(calls.map((c) => c.args.page)).toEqual([1, 3, 2]);
    expect(r.map((x) => x.code)).toEqual(['QO-102', 'QO-101', 'QO-100', 'QO-99', 'QO-98']);
  });
  it('single page reuses page 1, newest first', async () => {
    const { reader, calls } = fake(() => quots(rowsOf(1, 3), 3));
    const r = await reader.newestQuotations({}, 5);
    expect(calls).toHaveLength(1);
    expect(r.map((x) => x.code)).toEqual(['QO-3', 'QO-2', 'QO-1']);
  });
  it('total 0 -> [] after one call; n <= 0 -> no call', async () => {
    const a = fake(() => quots([], 0));
    expect(await a.reader.newestQuotations({}, 5)).toEqual([]);
    expect(a.calls).toHaveLength(1);
    const b = fake(() => quots([], 0));
    expect(await b.reader.newestQuotations({}, 0)).toEqual([]);
    expect(b.calls).toHaveLength(0);
  });
  it('passes filters through to every page', async () => {
    const { reader, calls } = fake(pages(20));
    await reader.newestQuotations({ searchText: 'x', dateStart: '2026-11-01' }, 5);
    for (const c of calls) expect(c.args).toMatchObject({ searchText: 'x', dateStart: '20261101', limit: 50 });
  });
});

describe('getContactName', () => {
  it('returns the trimmed name of the exact-code contact', async () => {
    const { reader, calls } = fake(() => fx('search-contacts.json'));
    expect(await reader.getContactName('C01890')).toBe('ไทยฟูดส์ อาหารสัตว์');
    expect(calls[0].name).toBe('search_contacts');
    expect(calls[0].args).toEqual({ searchText: 'C01890', limit: 10 });
  });
  it('null when no contacts, a different code, or blank name', async () => {
    const a = fake(() => ({ PeakContacts: { contacts: [], totalContact: 1997, resCode: '200' } }));
    expect(await a.reader.getContactName('C01890')).toBeNull();
    const b = fake(() => ({ PeakContacts: { contacts: [{ code: 'C018901', name: 'Other' }], resCode: '200' } }));
    expect(await b.reader.getContactName('C01890')).toBeNull();
    const c = fake(() => ({ PeakContacts: { contacts: [{ code: 'C01890', name: '  ' }], resCode: '200' } }));
    expect(await c.reader.getContactName('C01890')).toBeNull();
  });
  it('finds the exact code among several; malformed payload throws PeakToolError', async () => {
    const a = fake(() => ({ PeakContacts: { contacts: [{ code: 'C018901', name: 'Other' }, null, { code: 'C01890', name: 'Right' }], resCode: '200' } }));
    expect(await a.reader.getContactName('C01890')).toBe('Right');
    const b = fake(() => ({ PeakContacts: { contacts: 'x' } }));
    await expect(b.reader.getContactName('C01890')).rejects.toBeInstanceOf(PeakToolError);
    const c = fake(() => undefined);
    await expect(c.reader.getContactName('C01890')).rejects.toBeInstanceOf(PeakToolError);
  });
});

describe('untrusted strings are made Postgres-safe (no NUL, no lone surrogate)', () => {
  it('strips NUL and replaces a lone surrogate in a description; valid pairs untouched', async () => {
    const { reader } = fake(() => ({
      PeakQuotations: {
        quotations: [{ code: 'QO-1', products: [{ id: 'k1', description: 'ใบปลิว\u0000A5 \ud83d x 😀' }] }],
        resCode: '200',
      },
    }));
    const q = await reader.getQuotation('QO-1');
    expect(q!.lines[0].description).toBe('ใบปลิวA5 � x 😀');
  });
  it('a lone low surrogate and a NUL in status / contact code are cleaned too', async () => {
    const { reader } = fake(() => ({
      PeakQuotations: {
        quotations: [{ code: 'QO-1', status: 'Appr\u0000ove', contactCode: 'C\udc001', products: [] }],
        resCode: '200',
      },
    }));
    const q = await reader.getQuotation('QO-1');
    expect(q!.status).toBe('Approve');
    expect(q!.contactCode).toBe('C�1');
  });
  it('a line id containing a NUL is stripped (the line key)', async () => {
    const { reader } = fake(() => ({
      PeakQuotations: { quotations: [{ code: 'QO-1', products: [{ id: 'ab\u0000cd' }, { id: '\u0000' }] }], resCode: '200' },
    }));
    const q = await reader.getQuotation('QO-1');
    expect(q!.lines.map((l) => l.key)).toEqual(['abcd', 'idx:1']);
  });
  it('a list row code with a NUL is stripped', async () => {
    const { reader } = fake(() => quots([{ code: 'QO-\u00001', issuedDate: '20260101', contactCode: 'C\u00001' }], 1));
    const r = await reader.listQuotations({ page: 1 });
    expect(r.rows[0]).toMatchObject({ code: 'QO-1', contactCode: 'C1' });
  });
  it('a contact name with a NUL is stripped', async () => {
    const { reader } = fake(() => ({ PeakContacts: { contacts: [{ code: 'C01890', name: 'ไทย\u0000ฟูดส์' }], resCode: '200' } }));
    expect(await reader.getContactName('C01890')).toBe('ไทยฟูดส์');
  });
});
