// tests/ai-quote-tools.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { runComputeQuote, COMPUTE_QUOTE_TOOL } from '@/lib/ai-quote/tools';

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
  });

  it('throws on 401 (server misconfig — not the model\'s problem)', async () => {
    vi.stubGlobal('fetch', mockFetch(401, { error: 'unauthorized' }));
    await expect(
      runComputeQuote({ productType: 'brochure', spec: {} }, { url: 'https://calc/api/quote', token: 'bad' }),
    ).rejects.toThrow();
  });

  it('tool definition only allows the 3 quotable product types', () => {
    const pt = (COMPUTE_QUOTE_TOOL.input_schema as any).properties.productType.enum;
    expect(pt).toEqual(['brochure', 'book', 'notebook']);
  });
});
