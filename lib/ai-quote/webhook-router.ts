// lib/ai-quote/webhook-router.ts
import type { InboundMessage, ChannelAdapter } from './channels/types';
import { isTrackCommand, extractOrderId } from './track-flex';
import type { ThunderVerifyResponse } from './slip';

export type Route = 'slip' | 'track' | 'groupid' | 'ai' | 'enter-ai' | 'exit-ai' | 'ignore';

/** Match the group-id command — e.g. `/groupid`, `/group-id`, `/id` (leading slash
 *  required, case-insensitive). Echoes the LINE group/room id so staff can register
 *  a customer group for order tracking. */
export function isGroupIdCommand(text: string): boolean {
  return /^\/(group-?id|id)\s*$/i.test(text.trim());
}

/** Pure routing decision. Phase 1b-A passes aiEnabled=false (AI off): images→slip,
 *  /track→track, /groupid→groupid, everything else→ignore. The 'ai'/'enter-ai'/'exit-ai'
 *  arms are exercised once Phase 1b-B turns aiEnabled on (kept here so the table is total). */
export function routeInbound(m: InboundMessage, opts: { aiEnabled: boolean }): Route {
  // /groupid works anywhere (in groups it echoes the id; in 1-on-1 it says "groups only")
  if (m.kind === 'text' && m.text && isGroupIdCommand(m.text)) return 'groupid';
  // group/room sources only handle the group-id command — never slip/track/ai (avoid noise)
  if (m.sourceType === 'group' || m.sourceType === 'room') return 'ignore';
  if (m.kind === 'image') return 'slip';
  if (m.kind === 'text' && m.text && isTrackCommand(m.text)) return 'track';
  if (!opts.aiEnabled) return 'ignore';
  if (m.kind === 'postback' && m.postbackData === 'ai_quote_start') return 'enter-ai';
  if (m.kind === 'text' && (m.text === 'คุยกับทีมงาน' || m.text === 'ออกจากโหมด AI')) return 'exit-ai';
  if (m.kind === 'text' && m.text) return 'ai';
  return 'ignore';
}

export interface HandleDeps {
  adapter: Pick<ChannelAdapter, 'downloadImage' | 'reply' | 'push'>;
  blobToBase64: (b: Blob) => Promise<{ data: string; mediaType: string }>;
  isSlipImage: (b64: string, mediaType: string, d: { client: unknown; model: string }) => Promise<boolean>;
  verifyBankSlipImage: (image: Blob, opts?: { matchAccount?: boolean }) => Promise<ThunderVerifyResponse>;
  buildSlipFlex: (r: ThunderVerifyResponse) => Record<string, unknown>;
  loadOrder: (id: number) => Promise<{ order: unknown } & Record<string, unknown>>;
  buildOrderFlex: (orderId: string, state: unknown) => Record<string, unknown>;
  anthropic: unknown;
  visionModel: string;
  aiEnabled: boolean;
  // Optional best-effort metrics sink (one row per inbound slip image). Omitted
  // in tests; wired to Postgres in the LINE route. Must never throw.
  recordSlipCheck?: (ev: { channel: string; looksLikeSlip: boolean; result: ThunderVerifyResponse | null }) => Promise<void>;
}

/** Orchestrate one inbound message → side-effecting reply. Phase 1b-A handles
 *  slip + track; 'ai'/'enter-ai'/'exit-ai' routes are no-ops until 1b-B wires them. */
export async function handleInbound(m: InboundMessage, deps: HandleDeps): Promise<void> {
  const route = routeInbound(m, { aiEnabled: deps.aiEnabled });
  console.log('[ai-quote] inbound', { kind: m.kind, route });
  if (route === 'slip') {
    const blob = await deps.adapter.downloadImage(m);
    // Cheap Haiku pre-filter to spare Thunder quota (customers send many non-slip
    // images). Tuned to err toward "yes": only an explicit "no"/"ไม่" drops the
    // image, and the prompt explicitly counts bill-payment/QR/top-up slips as slips.
    const { data, mediaType } = await deps.blobToBase64(blob);
    const looksLikeSlip = await deps.isSlipImage(data, mediaType, { client: deps.anthropic, model: deps.visionModel });
    console.log('[ai-quote] slip pre-filter', { mediaType, looksLikeSlip });
    let result: ThunderVerifyResponse | null = null;
    if (looksLikeSlip) {
      result = await deps.verifyBankSlipImage(blob, { matchAccount: true });
      console.log('[ai-quote] thunder result', {
        success: result.success,
        isDuplicate: result.data?.isDuplicate,
        isAccountMatched: result.data?.isAccountMatched,
        error: result.error?.code,
      });
      await deps.adapter.reply(m, deps.buildSlipFlex(result));
      console.log('[ai-quote] slip reply sent');
    }
    // record one metric row per image (pass or drop) — best-effort, never throws
    await deps.recordSlipCheck?.({ channel: m.channel, looksLikeSlip, result });
    return;
  }
  if (route === 'track') {
    const id = extractOrderId(m.text!);
    if (!id) return;
    const state = await deps.loadOrder(Number(id));
    const flex = deps.buildOrderFlex(id, state.order ? state : null);
    await deps.adapter.reply(m, flex);
    return;
  }
  if (route === 'groupid') {
    const id = m.groupId || m.roomId;
    const reply = id
      ? `LINE Group ID:\n${id}`
      : 'คำสั่ง /groupid ใช้ได้เฉพาะในกลุ่ม LINE เท่านั้นครับ\nกรุณาเชิญบอทเข้ากลุ่มแล้วพิมพ์ /groupid ในกลุ่มอีกครั้ง';
    await deps.adapter.reply(m, reply);
    return;
  }
  // slip/track/groupid เท่านั้นใน 1b-A. ai/enter-ai/exit-ai → 1b-B.
}
