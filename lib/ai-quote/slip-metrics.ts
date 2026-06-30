// lib/ai-quote/slip-metrics.ts
// Best-effort metrics for the LINE OA slip-verify flow. One row per inbound
// image → powers /api/admin/slip-metrics (received-vs-slip + Thunder quota
// used). NEVER throws: a metrics failure must not affect the customer reply.
import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import type { ThunderVerifyResponse } from './slip';

export interface SlipCheckEvent {
  channel: string;
  looksLikeSlip: boolean;                  // Haiku pre-filter verdict
  result: ThunderVerifyResponse | null;    // null when the pre-filter dropped it (no Thunder call)
}

/** Persist one slip-check event. `thunder_called` mirrors `looksLikeSlip`
 *  (Thunder is only hit when the pre-filter passes), so summing it gives the
 *  Thunder quota consumed. Swallows every error. */
export async function recordSlipCheck(ev: SlipCheckEvent): Promise<void> {
  if (!isPostgresConfigured()) return;
  const r = ev.result;
  const amount = r?.data?.rawSlip?.amount?.amount ?? null;
  try {
    await sql`
      INSERT INTO slip_checks
        (channel, looks_like_slip, thunder_called, thunder_success, is_duplicate, is_account_matched, amount)
      VALUES
        (${ev.channel}, ${ev.looksLikeSlip}, ${ev.looksLikeSlip},
         ${r ? r.success : null}, ${r?.data?.isDuplicate ?? null}, ${r?.data?.isAccountMatched ?? null}, ${amount})`;
  } catch (e) {
    console.error('[ai-quote] recordSlipCheck failed:', e instanceof Error ? e.message : e);
  }
}
