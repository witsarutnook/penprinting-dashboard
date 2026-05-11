/** Shared spec-rendering helpers used by both /orders modal (orders-table.tsx
 *  SpecSection) and /board card detail (board/card.tsx DetailsTable). Lives
 *  here so future field additions / label tweaks only happen in one place.
 *
 *  Inspired by WP `renderJobSpecTab` (production-monitoring.js ~1109) +
 *  print-template field grouping (printOrderHtml ~3376) but adapted to v2's
 *  rawData shape (which includes per-flag fields from gatherFormData).
 */

export interface SpecSection {
  title: string;
  /** Ordered list of keys to render in this section. Keys not present in
   *  the source data are skipped silently. Boolean keys render as a single
   *  "✓ <label>" chip when true, omitted when false/missing. */
  keys: string[];
  /** When true, render keys as a horizontal chip row (used for
   *  multi-checkbox sections like binding / coating / printing-type). */
  chips?: boolean;
}

/** Keys that are header/system metadata — already shown in the modal
 *  header / dialog title, so they shouldn't repeat in the spec body. */
export const SPEC_HIDDEN_KEYS = new Set<string>([
  // Header / system
  'name', 'customer', 'dateIn', 'dateDue', 'pin', 'orderType',
  // Photobook items render in their own table
  'photobook', 'photobookItems',
  // Job-level assignment fields (shown in the "มอบหมายงาน" section
  // explicitly, no fallback render)
  'cowork', 'assignDept', 'assignStaff',
  // Unit-suffix fields — paired with their value keys in formatSpecValue
  'sizeUnit', 'qtyUnit',
]);

/** Photobook orders inherit the printing schema from OrderForm but the
 *  printing fields are meaningless for them. Whitelist the few fields
 *  that ARE meaningful (the photobook items render in their own table). */
export const PHOTOBOOK_VISIBLE_KEYS = new Set<string>(['notes', 'orderer']);

/** Full label dictionary — superset of WP's `lb` map. Keys missing here
 *  fall back to the raw key name in the renderer. */
export const SPEC_LABELS: Record<string, string> = {
  // Core
  size: 'ขนาด',
  qty: 'จำนวน',
  // Paper + color
  paperCover: 'กระดาษปก',
  paperInner: 'กระดาษเนื้อใน',
  coverColor: 'สีปก',
  innerColor: 'สีเนื้อใน',
  coverColorNote: 'หมายเหตุสีปก',
  innerColorNote: 'หมายเหตุสีเนื้อใน',
  // Plate / printing type
  plate: 'PLATE/Copy',
  plateOld: 'Plate เก่า',
  plateNew: 'Plate ใหม่',
  copyprint: 'Copyprint',
  inkjet: 'Inkjet',
  digital: 'Print Digital',
  plateSize: 'ขนาดเพลท',
  // Bills
  billPerSet: 'บิล/ชุด',
  setPerBook: 'ชุด/เล่ม',
  sheetPerBook: 'แผ่น/เล่ม',
  billColors: 'สีบิล',
  perf: 'ปรุ',
  perfPos: 'ตำแหน่งปรุ',
  runNo: 'หมายเลขรัน',
  runBook: 'รันเล่ม',
  runNum: 'รันหมายเลข',
  // Binding
  binding: 'เข้าเล่ม',
  glue: 'ไสกาว',
  saddle: 'เย็บมุงหลังคา',
  sew: 'เย็บกี่',
  spine: 'สันธรรมดา',
  glueHead: 'ทากาวหัว',
  glueSide: 'ทากาวข้าง',
  sewHead: 'เย็บหัว',
  sewSide: 'เย็บข้าง',
  sewCorner: 'เย็บมุม',
  sewThread: 'เย็บด้าย',
  sewSideTape: 'เย็บข้าง+เทป',
  // Coating + stamping
  coating: 'เคลือบ',
  coatGloss: 'เคลือบเงา',
  coatMatte: 'เคลือบด้าน',
  coatUV: 'เคลือบ UV',
  coatSpotUV: 'เคลือบ Spot UV',
  stamp: 'ปั๊ม/ไดคัท',
  stampColor: 'ปั๊มสี',
  stampColorNote: 'หมายเหตุปั๊มสี',
  emboss: 'ปั๊มนูน',
  diecut: 'ไดคัท',
  diecutSelf: 'ไดคัท(เอง)',
  // Misc
  forwardPrint: 'ส่งต่อพิมพ์',
  orderer: 'ผู้สั่งงาน',
  notes: 'หมายเหตุ',
};

/** Section definitions for structured spec render — mirrors WP's
 *  printOrderHtml grouping so the dashboard modal matches what the
 *  customer sees on the printed A4. */
export const SPEC_SECTIONS: SpecSection[] = [
  {
    title: 'ขนาด & จำนวน',
    keys: ['size', 'qty'],
  },
  {
    title: 'กระดาษ & สี',
    keys: [
      'paperCover', 'coverColor', 'coverColorNote',
      'paperInner', 'innerColor', 'innerColorNote',
    ],
  },
  {
    title: 'PLATE / การพิมพ์',
    chips: true,
    keys: ['plateOld', 'plateNew', 'copyprint', 'inkjet', 'digital', 'plateSize'],
  },
  {
    title: 'งานบิล',
    keys: [
      'billPerSet', 'setPerBook', 'sheetPerBook', 'billColors',
      'perf', 'perfPos', 'runNo', 'runBook', 'runNum',
    ],
  },
  {
    title: 'เข้าเล่ม',
    chips: true,
    keys: [
      'glue', 'saddle', 'sew', 'spine',
      'glueHead', 'glueSide',
      'sewHead', 'sewSide', 'sewCorner', 'sewThread', 'sewSideTape',
    ],
  },
  {
    title: 'เคลือบ / ปั๊ม',
    chips: true,
    keys: [
      'coatGloss', 'coatMatte', 'coatUV', 'coatSpotUV',
      'stampColor', 'stampColorNote', 'emboss', 'diecut', 'diecutSelf',
    ],
  },
  {
    title: 'อื่นๆ',
    keys: ['orderer', 'forwardPrint', 'notes'],
  },
];

/** Boolean keys that represent presence/absence flags — render as "✓ label"
 *  chips when true, omitted when false. Inferred from SPEC_LABELS — any key
 *  whose typical value is a boolean should be in a section with chips: true. */
function isBooleanFlag(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export interface FormatContext {
  /** Source rawData object — needed for unit-suffix pairing (size+sizeUnit, qty+qtyUnit). */
  raw: Record<string, unknown>;
}

/** Format a single key's value for display. Returns null when the value
 *  should be omitted entirely (empty / false flag / etc.). */
export function formatSpecValue(key: string, value: unknown, ctx: FormatContext): string | null {
  // Empty / nullish
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (Array.isArray(value) && value.length === 0) return null;
  if (Array.isArray(value) && value.every((x) => !x)) return null;

  // Boolean — true → '✓', false → omit
  if (isBooleanFlag(value)) return value ? '✓' : null;

  // Pair size + sizeUnit, qty + qtyUnit
  if (key === 'size') {
    const unit = String(ctx.raw.sizeUnit || '').trim();
    return unit ? `${value} ${unit}` : String(value);
  }
  if (key === 'qty') {
    const unit = String(ctx.raw.qtyUnit || '').trim();
    return unit ? `${value} ${unit}` : String(value);
  }

  // billColors array — join non-empty values
  if (Array.isArray(value)) {
    return value.filter(Boolean).map(String).join(', ');
  }

  // Object — JSON fallback (rare)
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/** Label lookup with fallback to raw key (so a new field that ships before
 *  the dictionary updates still shows something readable rather than nothing). */
export function specLabel(key: string): string {
  return SPEC_LABELS[key] || key;
}

/** Returns true when the key should be skipped in spec render
 *  (header / system / photobook items / unit-only). */
export function isHidden(key: string, isPhotobook: boolean): boolean {
  if (SPEC_HIDDEN_KEYS.has(key)) return true;
  if (isPhotobook) return !PHOTOBOOK_VISIBLE_KEYS.has(key);
  return false;
}

/** Build the section-by-section render plan for a given raw object.
 *  Returns sections with their resolved entries (key → formatted value).
 *  Sections with zero visible entries are dropped. */
export interface RenderedSection {
  title: string;
  chips: boolean;
  entries: Array<{ key: string; label: string; display: string }>;
}

export function buildSpecSections(
  raw: Record<string, unknown>,
  isPhotobook: boolean,
): RenderedSection[] {
  if (isPhotobook) {
    // Photobook gets a single section with just notes + orderer.
    const entries: RenderedSection['entries'] = [];
    for (const key of ['orderer', 'notes']) {
      if (isHidden(key, true)) continue;
      const display = formatSpecValue(key, raw[key], { raw });
      if (display === null) continue;
      entries.push({ key, label: specLabel(key), display });
    }
    return entries.length > 0
      ? [{ title: 'รายละเอียด', chips: false, entries }]
      : [];
  }

  const sections: RenderedSection[] = [];
  for (const section of SPEC_SECTIONS) {
    const entries: RenderedSection['entries'] = [];
    for (const key of section.keys) {
      if (isHidden(key, false)) continue;
      const display = formatSpecValue(key, raw[key], { raw });
      if (display === null) continue;
      entries.push({ key, label: specLabel(key), display });
    }
    if (entries.length > 0) {
      sections.push({ title: section.title, chips: !!section.chips, entries });
    }
  }

  // Catch-all section for any keys the user added via custom fields that
  // aren't in any SPEC_SECTION above. Keeps unknown data visible rather
  // than silently hidden.
  const knownKeys = new Set<string>();
  for (const s of SPEC_SECTIONS) s.keys.forEach((k) => knownKeys.add(k));
  const orphanEntries: RenderedSection['entries'] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (knownKeys.has(key)) continue;
    if (isHidden(key, false)) continue;
    const display = formatSpecValue(key, value, { raw });
    if (display === null) continue;
    orphanEntries.push({ key, label: specLabel(key), display });
  }
  if (orphanEntries.length > 0) {
    sections.push({ title: 'อื่นๆ (ไม่ได้จัดกลุ่ม)', chips: false, entries: orphanEntries });
  }

  return sections;
}
