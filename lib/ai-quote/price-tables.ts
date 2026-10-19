// lib/ai-quote/price-tables.ts
// Price-table images the AI quote assistant can show customers (calendar ×3, PVC card).
// Pure module — NO `server-only`: the staff panel (client component) imports
// labels/urls from here. Images live in public/price-tables/ and are served
// from the dashboard host so LINE/Messenger can fetch them by https URL.

export const PRICE_TABLE_IDS = ['calendar_chinese', 'calendar_desk', 'calendar_hanging', 'pvc_card'] as const;
export type PriceTableId = (typeof PRICE_TABLE_IDS)[number];

export const PRICE_TABLE_LABEL: Record<PriceTableId, string> = {
  calendar_chinese: 'ปฏิทินจีน',
  calendar_desk: 'ปฏิทินตั้งโต๊ะ 6x8 นิ้ว',
  calendar_hanging: 'ปฏิทินแขวน',
  pvc_card: 'บัตร PVC',
};

export const PRICE_TABLE_BASE = 'https://dashboard.penprinting.co/price-tables/';

export function isPriceTableId(x: unknown): x is PriceTableId {
  return typeof x === 'string' && (PRICE_TABLE_IDS as readonly string[]).includes(x);
}

export function priceTableUrl(id: PriceTableId): string {
  return `${PRICE_TABLE_BASE}${id}.jpg`;
}

/** Outbound image message for a channel. LINE needs both urls (preview ≤ 1 MB);
 *  Messenger sends a reusable attachment so repeat sends reuse Meta's cache. */
export function priceTableImageMessage(id: PriceTableId, channel: 'line' | 'messenger'): Record<string, unknown> {
  const url = priceTableUrl(id);
  if (channel === 'line') {
    return { type: 'image', originalContentUrl: url, previewImageUrl: url };
  }
  return { attachment: { type: 'image', payload: { url, is_reusable: true } } };
}
