// tests/ai-quote-price-tables.test.ts
import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import path from 'node:path';
import {
  PRICE_TABLE_IDS,
  PRICE_TABLE_LABEL,
  isPriceTableId,
  priceTableUrl,
  priceTableImageMessage,
} from '@/lib/ai-quote/price-tables';

describe('price-tables', () => {
  it('every id has a label and an https jpg url under the dashboard host', () => {
    for (const id of PRICE_TABLE_IDS) {
      expect(PRICE_TABLE_LABEL[id]).toBeTruthy();
      expect(priceTableUrl(id)).toBe(`https://dashboard.penprinting.co/price-tables/${id}.jpg`);
    }
  });

  it('isPriceTableId accepts ids and rejects junk', () => {
    expect(isPriceTableId('pvc_card')).toBe(true);
    expect(isPriceTableId('sticker')).toBe(false);
    expect(isPriceTableId(null)).toBe(false);
  });

  it('line image message carries original + preview urls', () =>
    expect(priceTableImageMessage('pvc_card', 'line')).toEqual({
      type: 'image',
      originalContentUrl: priceTableUrl('pvc_card'),
      previewImageUrl: priceTableUrl('pvc_card'),
    }));

  it('messenger image message is a reusable attachment', () =>
    expect(priceTableImageMessage('calendar_desk', 'messenger')).toEqual({
      attachment: { type: 'image', payload: { url: priceTableUrl('calendar_desk'), is_reusable: true } },
    }));

  it('every id has its jpg in public/price-tables (≤ 1 MB — LINE preview limit)', () => {
    for (const id of PRICE_TABLE_IDS) {
      const st = statSync(path.join(process.cwd(), 'public/price-tables', `${id}.jpg`));
      expect(st.size).toBeGreaterThan(0);
      expect(st.size).toBeLessThanOrEqual(1_000_000);
    }
  });
});
