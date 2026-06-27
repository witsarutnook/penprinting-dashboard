// lib/ai-quote/webhook-router.ts
import type { InboundMessage } from './channels/types';
import { isTrackCommand } from './track-flex';

export type Route = 'slip' | 'track' | 'ai' | 'enter-ai' | 'exit-ai' | 'ignore';

/** Pure routing decision. Phase 1b-A passes aiEnabled=false (AI off): images→slip,
 *  /track→track, everything else→ignore. The 'ai'/'enter-ai'/'exit-ai' arms are
 *  exercised once Phase 1b-B turns aiEnabled on (kept here so the table is total). */
export function routeInbound(m: InboundMessage, opts: { aiEnabled: boolean }): Route {
  if (m.kind === 'image') return 'slip';
  if (m.kind === 'text' && m.text && isTrackCommand(m.text)) return 'track';
  if (!opts.aiEnabled) return 'ignore';
  if (m.kind === 'postback' && m.postbackData === 'ai_quote_start') return 'enter-ai';
  if (m.kind === 'text' && (m.text === 'คุยกับทีมงาน' || m.text === 'ออกจากโหมด AI')) return 'exit-ai';
  if (m.kind === 'text' && m.text) return 'ai';
  return 'ignore';
}
