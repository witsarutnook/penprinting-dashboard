// lib/ai-quote/tools.ts
import type { ProductType, QuoteSpec, ComputeResult } from './types';

/** The single tool the model may call. Box/bag/namecard/etc. are intentionally
 *  absent — the model escalates those (D8) rather than pricing them. */
export const COMPUTE_QUOTE_TOOL = {
  name: 'compute_quote',
  description:
    'คำนวณราคางานพิมพ์ (ต่อชิ้น ก่อน VAT) จากสเปคที่ครบถ้วน. ' +
    'เรียกเมื่อได้สเปคครบเท่านั้น — ห้ามเดาราคาเอง. ' +
    'รองรับเฉพาะ โบรชัวร์/ใบปลิว (brochure), หนังสือ (book), สมุด (notebook). ' +
    'งานกล่อง/ถุง/นามบัตร/สติกเกอร์/โปสการ์ด ห้ามเรียก — ให้ escalate ให้พนักงานแทน.',
  input_schema: {
    type: 'object' as const,
    properties: {
      productType: { type: 'string', enum: ['brochure', 'book', 'notebook'] },
      spec: {
        type: 'object',
        description:
          'สเปคตามชนิดงาน. brochure: {size(A2/A3/A4/A5/ตัด16), color("1"/"2"/"4"), sides(1/2), paperName, qty}. ' +
          'book/notebook: {size, qty, cover:{paperName,color}, innerA:{paperName,color,pages}, innerB:{paperName,color,pages}}. ' +
          'notebook size = A4/A5 เท่านั้น. paperName ต้องเป็นชื่อกระดาษที่รู้จัก (ดูใน system prompt).',
      },
    },
    required: ['productType', 'spec'],
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
    const detail = body.message
      ?? (body.issues?.map((i) => `${i.path}: ${i.message}`).join('; '))
      ?? body.error
      ?? 'สเปคไม่ครบหรือไม่ถูกต้อง';
    return { ok: false, recoverable: true, message: detail };
  }

  // 401 (bad/missing token) or 500 (token not configured) = server misconfig.
  const text = await res.text().catch(() => '');
  throw new Error(`compute_quote failed: ${res.status} ${text.slice(0, 200)}`);
}
