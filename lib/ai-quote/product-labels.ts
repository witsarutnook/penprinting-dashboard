// lib/ai-quote/product-labels.ts
// Single source of Thai product names + per-piece units for ProductType.
// Pure module — NO `server-only`: the staff panel (client component), quote-logs
// and the escalation Flex all import from here.

export const PRODUCT_LABEL: Record<string, string> = {
  brochure: 'โบรชัวร์/ใบปลิว',
  book: 'หนังสือ',
  notebook: 'สมุด',
  namecard: 'นามบัตร',
  calendar: 'ปฏิทิน',
  pvccard: 'บัตร PVC',
};

/** What one "unit price" is a price of. Anything not listed is `ชิ้น`. */
export const UNIT_LABEL: Record<string, string> = {
  calendar: 'ชุด',
  pvccard: 'ใบ',
  namecard: 'ใบ',
};

export function unitLabel(productType: string): string {
  return UNIT_LABEL[productType] ?? 'ชิ้น';
}
