// lib/ai-quote/customer-triggers.ts
// Escalation trigger detection + canned customer-facing copy for the LINE
// customer AI-quote flow (Phase 1b-B, spec §4). Pure module — no I/O — the
// webhook router imports it directly (no injection needed for pure fns).

export type TriggerType = 'human' | 'out_of_scope' | 'rounds' | 'order_intent';

/** ① Customer asks for a human. Checked BEFORE the engine call. */
export function detectHumanRequest(text: string): boolean {
  return /คุยกับ\s*(คน|พนักงาน|ทีมงาน|แอดมิน)|ขอสาย|ติดต่อ\s*(พนักงาน|ทีมงาน|แอดมิน)|โทรกลับ/i.test(text);
}

/** ④ Customer confirms the order (Type B — qualified lead). Only meaningful
 *  when the session already has ≥1 quote (caller checks countQuotes).
 *  Deliberately narrow — confirmation phrasings only. Broad words like
 *  "สั่งพิมพ์/จะสั่ง" appear in ordinary spec sentences ("อยากสั่งพิมพ์โบรชัวร์…")
 *  and a false positive here kicks the customer out of the mode. */
export function detectOrderIntent(text: string): boolean {
  return /สั่งเลย|สั่งตามนี้|ยืนยันสั่ง|ตกลงสั่ง|เอาตามนี้|ตามนี้เลย|ตกลงทำ/i.test(text);
}

/** ② Model handed off (out-of-scope / special paper / discount ask). The
 *  customer prompt pins the exact phrase "ส่งต่อทีมงาน" for hand-offs, so this
 *  stays narrow — the per-quote disclaimer ("ทีมงานยืนยันราคา") never matches
 *  because quoteCount > 0 on those turns. Keep prompt + detector in sync. */
export function detectCustomerEscalation(quoteCount: number, reply: string): boolean {
  return quoteCount === 0 && /ส่งต่อทีมงาน|ให้ทีมงานประเมิน/.test(reply);
}

/** ③ N consecutive engine turns without a successful quote → hand off. */
export const ROUNDS_NO_QUOTE_LIMIT = 4;

/** Fixed replies for the detector-driven triggers (②'s reply is the model's
 *  own hand-off text, so it has no entry here). */
export const CUSTOMER_REPLY: Record<'human' | 'rounds' | 'order_intent', string> = {
  human: 'รับทราบค่ะ ส่งต่อทีมงานแล้วนะคะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วค่ะ 🙏',
  rounds: 'เดี๋ยวให้ทีมงานช่วยดูรายละเอียดให้นะคะ ส่งต่อทีมงานแล้วค่ะ เดี๋ยวติดต่อกลับค่ะ 🙏',
  order_intent: 'รับเรื่องแล้วค่ะ 🛒 ทีมขายจะติดต่อยืนยันราคาและรายละเอียดกับคุณลูกค้าอีกครั้งนะคะ ขอบคุณค่ะ 🙏',
};

/** Staff-facing trigger label (escalation Flex + /quote-leads context). */
export const TRIGGER_LABEL: Record<TriggerType, string> = {
  human: 'ลูกค้าขอคุยกับพนักงาน',
  out_of_scope: 'งานนอกขอบเขต AI',
  rounds: 'คุยหลายรอบยังตีราคาไม่ได้',
  order_intent: 'ลูกค้าพร้อมสั่ง (มีราคาแล้ว)',
};

// ─── Mode lifecycle copy (spec §1-§2, §6) ───

export const INTRO_TEXT =
  'สวัสดีค่ะ 🤖 ตอนนี้คุณลูกค้ากำลังคุยกับระบบประเมินราคาอัตโนมัติของ Penprinting นะคะ\n' +
  'พิมพ์สเปกงานมาได้เลย เช่น "โบรชัวร์ A4 1,000 ใบ" หรือ "หนังสือ A5 100 หน้า 500 เล่ม"\n' +
  '• ตีราคาได้: โบรชัวร์/ใบปลิว · หนังสือ · สมุด\n' +
  '• พิมพ์ "ออก" เมื่อต้องการกลับไปคุยกับทีมงาน\n' +
  'ราคาที่ได้เป็นการประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ';

export const EXIT_TEXT = 'ออกจากโหมดประเมินราคาแล้วค่ะ ✅ ทีมงานจะดูแลต่อจากตรงนี้นะคะ ขอบคุณค่ะ 🙏';

export const HINT_TEXT =
  'ทีมงานจะตอบกลับโดยเร็วค่ะ 🙏\n' +
  'หรือถ้าต้องการราคาประเมินทันที กดปุ่มด้านล่างให้ AI ช่วยคิดราคาได้เลยค่ะ (โบรชัวร์ · หนังสือ · สมุด)';

// ⚠️ TEST-ONLY (soft-launch 2026-07-07): text carries the "/" entry command so
// the hint button matches isEnterAiKeyword. REVERT with webhook-router.ts →
// 'ขอราคา AI'.
export const HINT_QUICK_REPLY = { label: '🤖 เริ่มขอราคา AI', text: '/ขอราคา AI' };

export const RATE_LIMIT_TEXT =
  'ขออภัยค่ะ มีการใช้งานถี่เกินไป รบกวนรอสักครู่ หรือรอทีมงานติดต่อกลับนะคะ 🙏';

export const ERROR_TEXT =
  'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้ง หรือรอทีมงานตอบกลับนะคะ 🙏';
