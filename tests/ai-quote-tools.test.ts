// tests/ai-quote-tools.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runComputeQuote, COMPUTE_QUOTE_TOOL, SEND_PRICE_TABLE_TOOL } from '@/lib/ai-quote/tools';
import { PRICE_TABLE_IDS } from '@/lib/ai-quote/price-tables';

const OK = {
  productType: 'brochure',
  spec: { size: 'A4', color: '4', sides: 2, paperName: 'Art 130', qty: 1000 },
  result: { mode: 'offset', unitPrice: 5.048225, unitPriceVat: 5.4, totalPrice: 5048.2 },
};

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('runComputeQuote', () => {
  it('returns the calc result on 200', async () => {
    vi.stubGlobal('fetch', mockFetch(200, OK));
    const r = await runComputeQuote(
      { productType: 'brochure', spec: OK.spec },
      { url: 'https://calc/api/quote', token: 't' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.unitPrice).toBe(5.048225);
  });

  it('returns a recoverable error (for the model) on 422', async () => {
    vi.stubGlobal('fetch', mockFetch(422, { error: 'invalid spec', issues: [{ path: 'paperName', message: 'ไม่รู้จัก' }] }));
    const r = await runComputeQuote(
      { productType: 'brochure', spec: { paperName: 'X' } },
      { url: 'https://calc/api/quote', token: 't' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.recoverable).toBe(true);
    // plain `issues` path (no `message`) is unchanged: the per-field list, no [code] prefix
    if (!r.ok) expect(r.message).toBe('paperName: ไม่รู้จัก');
  });

  it('422 with a string error code + message: the model sees "[code] message" (below_min / above_max rule)', async () => {
    vi.stubGlobal('fetch', mockFetch(422, { error: 'above_max', message: 'จำนวนเกิน 5,000 ชุด ต้องให้ทีมงานประเมิน' }));
    const r = await runComputeQuote(
      { productType: 'calendar', spec: { qty: 99999 } },
      { url: 'https://calc/api/quote', token: 't' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.recoverable).toBe(true);
      expect(r.message).toBe('[above_max] จำนวนเกิน 5,000 ชุด ต้องให้ทีมงานประเมิน');
    }
  });

  it('422 with only a message (no error code) is passed through unprefixed', async () => {
    vi.stubGlobal('fetch', mockFetch(422, { message: 'สเปคไม่ถูกต้อง' }));
    const r = await runComputeQuote(
      { productType: 'brochure', spec: {} },
      { url: 'https://calc/api/quote', token: 't' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe('สเปคไม่ถูกต้อง');
  });

  it('throws on 401 (server misconfig — not the model\'s problem)', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }));
    await expect(
      runComputeQuote({ productType: 'brochure', spec: {} }, { url: 'https://calc/api/quote', token: 'bad' }),
    ).rejects.toThrow();
  });

  it('compute_quote enum lists all 6 product types', () => {
    const pt = (COMPUTE_QUOTE_TOOL.input_schema as unknown as { properties: { productType: { enum: string[] } } }).properties.productType.enum;
    expect(pt).toEqual(['brochure', 'book', 'notebook', 'namecard', 'calendar', 'pvccard']);
  });

  it('send_price_table tool enum matches PRICE_TABLE_IDS', () => {
    expect(SEND_PRICE_TABLE_TOOL.name).toBe('send_price_table');
    expect(SEND_PRICE_TABLE_TOOL.input_schema.properties.table.enum).toEqual([...PRICE_TABLE_IDS]);
    expect(SEND_PRICE_TABLE_TOOL.input_schema.required).toEqual(['table']);
  });
});
