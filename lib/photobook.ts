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

/** Full WP order form schema — mirrors `gatherFormData()` in
 *  production-monitoring.js:1595. Used by the v2 OrderForm so payloads
 *  match what the WP form sends to addOrder/updateOrder.
 *
 *  All fields stored under `details` (and `rawData`) on the order row;
 *  Apps Script doesn't validate them — UI/print-template owns the schema. */
export interface OrderFormData {
  // Header
  name: string;
  customer: string;
  dateIn: string;       // YYYY-MM-DD
  dateDue: string;      // YYYY-MM-DD
  // Job specs (Tab 1: ข้อมูลหลัก)
  size: string;
  sizeUnit: string;     // 'ซม.' / 'นิ้ว' / 'มม.'
  qty: string;
  qtyUnit: string;      // 'แผ่น' / 'ชุด' / 'เล่ม'
  paperCover: string;
  paperInner: string;
  coverColor: string;       // '1สี' / '2สี' / '3สี' / '4สี' / ''
  coverColorNote: string;
  innerColor: string;
  innerColorNote: string;
  // PLATE / การพิมพ์
  plateOld: boolean;
  plateNew: boolean;
  copyprint: boolean;
  inkjet: boolean;
  digital: boolean;
  plateSize: string[];      // ['ตัด 5', 'ตัด 4', 'ตัด 3'] subset
  // งานบิล (Tab 2: งานหลังพิมพ์)
  billPerSet: string;
  setPerBook: string;
  sheetPerBook: string;
  billColors: string[];     // length 6, blank = unused
  perf: boolean;
  perfPos: string;
  runNo: boolean;
  runBook: string;
  runNum: string;
  // เข้าเล่ม (Binding) — 11 checkboxes
  glue: boolean;
  saddle: boolean;
  sew: boolean;
  spine: boolean;
  glueHead: boolean;
  glueSide: boolean;
  sewHead: boolean;
  sewSide: boolean;
  sewCorner: boolean;
  sewThread: boolean;
  sewSideTape: boolean;
  // เคลือบ / ปั๊ม
  coatGloss: boolean;
  coatMatte: boolean;
  coatUV: boolean;
  coatSpotUV: boolean;
  stampColor: boolean;
  stampColorNote: string;
  emboss: boolean;
  diecut: boolean;
  diecutSelf: boolean;
  // Assignment (Tab 3: มอบหมาย+หมายเหตุ)
  assignDept: string;       // always 'graphic' for the order form (WP behavior)
  assignStaff: string;      // graphic staff id; or '' if forwarding to print
  forwardPrint: string;     // print staff id; or '' if assigned to graphic
  orderer: string;
  notes: string;
  // Photobook
  orderType: 'normal' | 'photobook';
  photobookItems: PhotobookItem[];
}

export function emptyOrderForm(orderer = ''): OrderFormData {
  return {
    name: '',
    customer: '',
    dateIn: '',
    dateDue: '',
    size: '', sizeUnit: 'ซม.',
    qty: '', qtyUnit: 'แผ่น',
    paperCover: '', paperInner: '',
    coverColor: '', coverColorNote: '',
    innerColor: '', innerColorNote: '',
    plateOld: false, plateNew: false, copyprint: false, inkjet: false, digital: false,
    plateSize: [],
    billPerSet: '', setPerBook: '', sheetPerBook: '',
    billColors: ['', '', '', '', '', ''],
    perf: false, perfPos: '',
    runNo: false, runBook: '', runNum: '',
    glue: false, saddle: false, sew: false, spine: false,
    glueHead: false, glueSide: false,
    sewHead: false, sewSide: false, sewCorner: false,
    sewThread: false, sewSideTape: false,
    coatGloss: false, coatMatte: false, coatUV: false, coatSpotUV: false,
    stampColor: false, stampColorNote: '',
    emboss: false, diecut: false, diecutSelf: false,
    assignDept: 'graphic',
    assignStaff: '',
    forwardPrint: '',
    orderer,
    notes: '',
    orderType: 'normal',
    photobookItems: [],
  };
}

/** Reverse of gatherFormData — pull fields back out of `order.rawData` for
 *  edit-mode prefill. Falls back to defaults for missing keys. */
export function orderFormFromRaw(
  raw: Record<string, unknown> | null | undefined,
  fallbackOrderer = '',
): OrderFormData {
  const f = emptyOrderForm(fallbackOrderer);
  if (!raw || typeof raw !== 'object') return f;
  const r = raw as Record<string, unknown>;
  const merge: Partial<OrderFormData> = {};
  // Strings
  for (const k of [
    'name', 'customer', 'dateIn', 'dateDue', 'size', 'sizeUnit', 'qty', 'qtyUnit',
    'paperCover', 'paperInner', 'coverColor', 'coverColorNote', 'innerColor', 'innerColorNote',
    'billPerSet', 'setPerBook', 'sheetPerBook', 'perfPos', 'runBook', 'runNum',
    'stampColorNote', 'assignDept', 'assignStaff', 'forwardPrint', 'orderer', 'notes',
  ] as const) {
    if (typeof r[k] === 'string') (merge as Record<string, unknown>)[k] = r[k];
  }
  // Booleans
  for (const k of [
    'plateOld', 'plateNew', 'copyprint', 'inkjet', 'digital',
    'perf', 'runNo',
    'glue', 'saddle', 'sew', 'spine', 'glueHead', 'glueSide',
    'sewHead', 'sewSide', 'sewCorner', 'sewThread', 'sewSideTape',
    'coatGloss', 'coatMatte', 'coatUV', 'coatSpotUV',
    'stampColor', 'emboss', 'diecut', 'diecutSelf',
  ] as const) {
    if (typeof r[k] === 'boolean') (merge as Record<string, unknown>)[k] = r[k];
  }
  if (Array.isArray(r.plateSize)) merge.plateSize = r.plateSize.map((s) => String(s));
  if (Array.isArray(r.billColors)) {
    const bc = r.billColors.map((s) => String(s || ''));
    while (bc.length < 6) bc.push('');
    merge.billColors = bc.slice(0, 6);
  }
  if (r.orderType === 'photobook') merge.orderType = 'photobook';
  if (Array.isArray(r.photobookItems)) {
    merge.photobookItems = r.photobookItems
      .filter((x) => x && typeof x === 'object')
      .map((x) => {
        const o = x as Record<string, unknown>;
        return {
          size: String(o.size || ''),
          binding: String(o.binding || ''),
          qty: String(o.qty || ''),
          special: String(o.special || ''),
        };
      });
  }
  return { ...f, ...merge };
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
