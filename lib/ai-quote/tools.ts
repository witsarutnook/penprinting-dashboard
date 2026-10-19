// lib/ai-quote/tools.ts
import type { ProductType, QuoteSpec, ComputeResult } from './types';
import { PRICE_TABLE_IDS } from './price-tables';

/** The pricing tool the model may call. Box/bag/sticker/etc. are intentionally
 *  absent — the model escalates those (D8) rather than pricing them.
 *  namecard added 2026-07-13 (fix rate/box — calc API is the price source).
 *  calendar + pvccard added 2026-10-19 (price-table products). */
export const COMPUTE_QUOTE_TOOL = {
  name: 'compute_quote',
  description:
    'คำนวณราคางานพิมพ์ (ต่อชิ้น ก่อน VAT) จากสเปคที่ครบถ้วน. ' +
    'เรียกเมื่อได้สเปคครบเท่านั้น — ห้ามเดาราคาเอง. ' +
    'รองรับ 6 ชนิดเท่านั้น: โบรชัวร์/ใบปลิว (brochure), หนังสือ (book), สมุด (notebook), นามบัตร (namecard), ปฏิทิน (calendar), บัตร PVC (pvccard). ' +
    'งานกล่อง/ถุง/สติกเกอร์/โปสการ์ด ห้ามเรียก — ให้ escalate ให้พนักงานแทน.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productType: { type: 'string', enum: ['brochure', 'book', 'notebook', 'namecard', 'calendar', 'pvccard'] },
      spec: {
        type: 'object',
        description:
          'สเปคตามชนิดงาน. brochure: {size(A2/A3/A4/A5/ตัด16), color("1"/"2"/"4"), sides(1/2), paperName, qty}. ' +
          'book/notebook: {size, qty, cover:{paperName,color}, innerA:{paperName,color,pages}, innerB:{paperName,color,pages}}. ' +
          'notebook size = A4/A5 เท่านั้น. paperName ต้องเป็นชื่อกระดาษที่รู้จัก (ดูใน system prompt). ' +
          'namecard: {qty(จำนวนใบ), sides(1/2), laminated(boolean — เคลือบเงา/ด้าน)}. ' +
          'นามบัตรขายเป็นกล่อง (100 ใบ/กล่อง) — ระบบปัดจำนวนใบขึ้นเป็นกล่องเต็มให้เอง ผลลัพธ์มี boxes/pricePerBox/totalPrice. ' +
          "calendar: {kind('chinese'|'desk'|'hanging'), variant(จีน/แขวน '10.5x15'|'15x21' · ตั้งโต๊ะ '8'|'14' แผ่น), qty(ชุด)} · pvccard: {qty(ใบ)}",
      },
    },
    required: ['productType', 'spec'],
  },
};

/** Second model tool (no I/O): the model asks to show a price-table image.
 *  The runner turns it into an image message after the text reply (later task). */
export const SEND_PRICE_TABLE_TOOL = {
  name: 'send_price_table',
  description:
    'ส่งรูปตารางราคาให้ลูกค้าดู — เรียกครั้งแรกที่รู้ว่าเป็นปฏิทินแบบไหน/บัตร PVC, 1 ครั้งต่อตารางต่อบทสนทนา. ไม่ใช่การคิดราคา',
  input_schema: {
    type: 'object' as const,
    properties: {
      table: { type: 'string', enum: [...PRICE_TABLE_IDS] },
    },
    required: ['table'],
  },
};

export interface ComputeQuoteInput {
  productType: ProductType;
  spec: QuoteSpec;
}

export type ComputeQuoteOutcome =
  | { ok: true; productType: ProductType; spec: QuoteSpec; result: ComputeResult }
  /** recoverable = calc returned 422 (bad/incomplete spec or unknown paper).
   *  Feed `message` back to the model so it asks for the missing field or escalates. */
  | { ok: false; recoverable: true; message: string };

/** POST the spec to the calc pricing API (single source of truth). */
export async function runComputeQuote(
  input: ComputeQuoteInput,
  cfg: { url: string; token: string },
): Promise<ComputeQuoteOutcome> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-quote-token': cfg.token },
    body: JSON.stringify({ productType: input.productType, spec: input.spec }),
    cache: 'no-store',
  });

  if (res.ok) {
    const data = (await res.json()) as { productType: ProductType; spec: QuoteSpec; result: ComputeResult };
    return { ok: true, productType: data.productType, spec: data.spec, result: data.result };
  }

  if (res.status === 422) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string; issues?: { path: string; message: string }[] };
    // The prompts key off the calc API's machine codes (`below_min` / `above_max`), so when the
    // API sends both a string code and a message, show the model "[code] message" — it can only
    // follow the rule if it can see the code.
    const detail = (typeof body.error === 'string' && body.message ? `[${body.error}] ${body.message}` : body.message)
      ?? (body.issues?.map((i) => `${i.path}: ${i.message}`).join('; '))
      ?? body.error
      ?? 'สเปคไม่ครบหรือไม่ถูกต้อง';
    return { ok: false, recoverable: true, message: detail };
  }

  // 401 (bad/missing token) or 500 (token not configured) = server misconfig.
  const text = await res.text().catch(() => '');
  throw new Error(`compute_quote failed: ${res.status} ${text.slice(0, 200)}`);
}
