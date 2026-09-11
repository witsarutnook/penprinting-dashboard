// lib/ai-quote/slip-messenger.ts
// Slip-verify result → Messenger text message (Phase 1c). Messenger has no
// LINE Flex — plain text with the same 5-state copy as slip-flex.ts.
// classify + formatters are imported from slip-flex so the LINE card and the
// Messenger text can never disagree. Pure + total: never throws, null-safe.
import { classifySlipState, fmtAmount, fmtDate, partyName, bankName } from './slip-flex';
import type { ThunderVerifyResponse } from './slip';

/** Build the Messenger message object for a slip-verify result — ready for
 *  adapter.reply(). The messenger route injects this as deps.buildSlipFlex. */
export function buildSlipMessenger(result: ThunderVerifyResponse): Record<string, unknown> {
  const state = classifySlipState(result);
  const raw = result.data?.rawSlip;
  const amount = fmtAmount(raw?.amount?.amount);
  const lines: string[] = [];
  if (state === 'success') {
    lines.push('✅ สลิปถูกต้องค่ะ');
    if (amount) lines.push(`ยอดโอน ${amount}`);
    const date = fmtDate(raw?.date ?? raw?.transDate);
    if (date) lines.push(date);
    const sender = partyName(raw?.sender);
    if (sender !== '-') lines.push(`จาก ${[sender, bankName(raw?.sender)].filter(Boolean).join(' · ')}`);
    lines.push('ขอบคุณค่ะ 🙏');
  } else if (state === 'duplicate') {
    lines.push('⚠️ สลิปนี้เคยส่งแล้วค่ะ');
    if (amount) lines.push(`ยอดโอน ${amount}`);
    const sender = partyName(raw?.sender);
    if (sender !== '-') lines.push(`จาก ${sender}`);
    lines.push('ถ้าเป็นการโอนใหม่ รบกวนแจ้งทีมงานเพิ่มเติมนะคะ 🙏');
  } else if (state === 'mismatch') {
    // D4: never expose the mistaken destination account (amount = transfer amount, safe)
    lines.push('❌ ยอดนี้ดูไม่ตรงบัญชีของร้านค่ะ 🙏');
    if (amount) lines.push(`ยอดโอน ${amount}`);
    lines.push('รบกวนตรวจสอบเลขบัญชีปลายทางอีกครั้งนะคะ');
  } else if (state === 'error') {
    lines.push('ระบบตรวจสอบสลิปขัดข้องชั่วคราวค่ะ');
    lines.push('ทีมงานจะตรวจสอบให้นะคะ 🙏');
  } else {
    // 'unreadable' — Thunder answered about this image and could not confirm
    // it. Re-sending the same picture returns the same answer, so we no longer
    // ask for one (2026-09-11 SLIP_NOT_FOUND run).
    lines.push('ระบบตรวจสอบอัตโนมัติยืนยันสลิปใบนี้ไม่ได้ค่ะ');
    lines.push('ทีมงานจะตรวจสอบให้อีกครั้งนะคะ 🙏');
    lines.push('(ไม่ต้องส่งซ้ำค่ะ)');
  }
  return { text: lines.join('\n') };
}
