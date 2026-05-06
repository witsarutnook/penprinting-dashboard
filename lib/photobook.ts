/**
 * Photobook data model — port of WP `addPhotobookItem` / `getPhotobookItems`
 * (production-monitoring.js:5749-5822). Items are stored under
 * `details.photobook` as an array of these shape objects, with
 * `rawData.orderType = 'photobook'` flagging the whole order.
 */

export const PB_SIZES = [
  '5.5"x5.5"',
  '8"x8"',
  '8"x12"',
  '8"x11" แนวตั้ง',
  'A3',
] as const;

export const PB_BINDINGS = ['ปกแข็ง', 'ปกอ่อน', 'เข้าห่วง'] as const;

export type PBSize = (typeof PB_SIZES)[number];
export type PBBinding = (typeof PB_BINDINGS)[number];

export interface PhotobookItem {
  size: string;
  binding: string;
  qty: string;
  special: string;
}

export function emptyPhotobookItem(): PhotobookItem {
  return { size: '', binding: '', qty: '', special: '' };
}

/** Strip empty rows + ensure required fields present. Returns null if any
 *  remaining item is missing size/binding/qty (server-side use). */
export interface ValidationResult {
  ok: boolean;
  cleaned: PhotobookItem[];
  errors: string[];
}

export function validatePhotobook(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(input)) return { ok: false, cleaned: [], errors: ['photobook ต้องเป็น array'] };
  const cleaned: PhotobookItem[] = [];
  input.forEach((it, i) => {
    if (!it || typeof it !== 'object') return;
    const item = it as Partial<PhotobookItem>;
    const size = String(item.size || '').trim();
    const binding = String(item.binding || '').trim();
    const qty = String(item.qty || '').trim();
    const special = String(item.special || '').trim();
    if (!size && !binding && !qty && !special) return; // drop empty
    if (!size) errors.push(`เล่มที่ ${i + 1}: ต้องเลือกขนาด`);
    if (!binding) errors.push(`เล่มที่ ${i + 1}: ต้องเลือกแบบเข้าเล่ม`);
    if (!qty || isNaN(Number(qty)) || Number(qty) <= 0) {
      errors.push(`เล่มที่ ${i + 1}: ต้องระบุจำนวนเล่ม`);
    }
    cleaned.push({ size, binding, qty, special });
  });
  if (cleaned.length === 0 && errors.length === 0) {
    errors.push('ต้องมีรายการ Photobook อย่างน้อย 1 เล่ม');
  }
  return { ok: errors.length === 0, cleaned, errors };
}
