import 'server-only';
import type { ChannelAdapter, InboundMessage, OutboundMessage } from '@/lib/ai-quote/channels/types';
import type { PeakOrderArm } from '@/lib/ai-quote/webhook-router';
import { getLineProfile } from '@/lib/ai-quote/channels/line';
import { createOrderFromForm } from '@/lib/orders-create';
import { createPeakClient } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';
import { newDraftId, peakOrderDb } from '@/lib/peak-order/db';
import { handlePeakOrderPostback, handlePeakOrderText, type PeakOrderDeps } from '@/lib/peak-order/handler';
import { TEXT, type Card } from '@/lib/peak-order/flex';

/**
 * Env config + real-dependency wiring for the LINE /order flow (spec §6.7).
 * Off unless PEAK_ORDER_ENABLED === 'true', PEAK_ORDER_GROUP_IDS is non-empty
 * and PEAK_TOKEN_ENC_KEY is set. Building the arm does no I/O and parses no key:
 * a bad key surfaces inside the handler as PeakConfigError ("not connected" text).
 */
export function peakOrderConfig(env: NodeJS.ProcessEnv = process.env): { enabled: boolean; groupIds: string[] } {
  const groupIds = (env.PEAK_ORDER_GROUP_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const enabled = env.PEAK_ORDER_ENABLED === 'true' && groupIds.length > 0 && !!env.PEAK_TOKEN_ENC_KEY;
  return { enabled, groupIds };
}

function errClass(e: unknown): string {
  return e instanceof Error && e.name ? e.name : 'unknown';
}

/** ' SQLSTATE 42P01' when the thrown value carries a Postgres error code, else ''. */
function sqlState(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? ` SQLSTATE ${code}` : '';
}

type ReplyItem = Card | string;

/**
 * Flex-or-text reply. All messages go out in ONE adapter.reply call (LINE allows
 * ≤ 5 per reply). If the Flex send throws, the whole list is resent as plain text
 * in one call; if that fails too, the error propagates. Logs the error class only.
 *
 * The real path for a refused Flex: the LINE adapter's reply() swallows a failed
 * reply-token send and pushes the SAME Flex to the group; only when that push is
 * refused too does reply() throw — and only then does this wrapper resend the
 * cards as text, again through adapter.reply (reply token first, then push).
 */
export function makePeakReply(adapter: Pick<ChannelAdapter, 'reply'>) {
  return async (m: InboundMessage, card: ReplyItem | ReplyItem[]): Promise<void> => {
    const items = Array.isArray(card) ? card : [card];
    const asFlex: OutboundMessage[] = items.map((c) => (typeof c === 'string' ? c : c.flex));
    const payload = (list: OutboundMessage[]) => (Array.isArray(card) ? list : list[0]);
    try {
      await adapter.reply(m, payload(asFlex));
    } catch (e) {
      if (!items.some((c) => typeof c !== 'string')) throw e; // nothing to fall back to
      console.warn(`[peak-order] flex reply failed, retrying as text: ${errClass(e)}`);
      const asText: OutboundMessage[] = items.map((c) => (typeof c === 'string' ? c : c.text));
      await adapter.reply(m, payload(asText));
    }
  };
}

/** A fresh Peak client per inbound message; nothing is created at module load. */
function makeDeps(reply: PeakOrderDeps['reply']): PeakOrderDeps {
  return {
    reply,
    peak: createPeakReader(createPeakClient()),
    db: peakOrderDb,
    createOrder: createOrderFromForm,
    getDisplayName: async (uid) => (await getLineProfile(uid))?.displayName ?? null,
    now: () => new Date(),
    newDraftId,
  };
}

export function buildPeakOrderArm(
  adapter: Pick<ChannelAdapter, 'reply'>,
  env: NodeJS.ProcessEnv = process.env,
): PeakOrderArm | undefined {
  const cfg = peakOrderConfig(env);
  if (!cfg.enabled) return undefined;

  const reply = makePeakReply(adapter);

  // Never let anything escape into after(), and never stay silent (spec §4.6):
  // log a fixed string + error class (+ SQLSTATE when there is one) only — no
  // message, no inbound text — then answer TEXT.unexpected. If that reply
  // fails too, log its class and carry on with the next event.
  const guarded = (where: string, run: (m: InboundMessage) => Promise<void>) => async (m: InboundMessage) => {
    try {
      await run(m);
    } catch (e) {
      console.error(`[peak-order] ${where} failed: ${errClass(e)}${sqlState(e)}`);
      try {
        await reply(m, TEXT.unexpected);
      } catch (e2) {
        console.error(`[peak-order] ${where} apology reply failed: ${errClass(e2)}`);
      }
    }
  };

  return {
    groupIds: cfg.groupIds,
    handleText: guarded('text', (m) => handlePeakOrderText(m, makeDeps(reply))),
    handlePostback: guarded('postback', (m) => handlePeakOrderPostback(m, makeDeps(reply))),
  };
}
