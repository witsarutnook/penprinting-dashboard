// lib/ai-quote/slip-metrics.ts
// Best-effort metrics for the LINE OA slip-verify flow. One row per inbound
// image → powers /api/admin/slip-metrics (received-vs-slip + Thunder quota
// used). NEVER throws: a metrics failure must not affect the customer reply.
import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { slipAccountMatched, type ThunderVerifyResponse } from './slip';

export const SLIP_METRICS_CHANNELS = ['line', 'messenger'] as const;
export type SlipMetricsChannel = (typeof SLIP_METRICS_CHANNELS)[number];

/** Parse the ?channel= query param of /api/admin/slip-metrics.
 *  Absent (null) = aggregate all channels (พฤติกรรมเดิม). Unknown values are
 *  rejected so a typo 400s instead of silently reading as all-zero days. */
export function parseSlipMetricsChannel(
  raw: string | null,
): { ok: true; channel: SlipMetricsChannel | undefined } | { ok: false } {
  if (raw === null) return { ok: true, channel: undefined };
  return (SLIP_METRICS_CHANNELS as readonly string[]).includes(raw)
    ? { ok: true, channel: raw as SlipMetricsChannel }
    : { ok: false };
}

/** Per-day rollup of inbound images over the last 30 Bangkok-calendar days,
 *  optionally scoped to one channel. NULL param disables the filter in-query
 *  (single statement — no dual query text to drift). */
export async function loadSlipMetrics(channel: SlipMetricsChannel | undefined) {
  const ch = channel ?? null;
  const { rows } = await sql`
    SELECT
      (created_at AT TIME ZONE 'Asia/Bangkok')::date              AS day,
      COUNT(*)::int                                                AS images,
      COUNT(*) FILTER (WHERE thunder_called)::int                  AS thunder_calls,
      COUNT(*) FILTER (WHERE NOT looks_like_slip)::int             AS filtered_out,
      COUNT(*) FILTER (WHERE thunder_success)::int                 AS slip_ok,
      COUNT(*) FILTER (WHERE is_duplicate)::int                    AS duplicates,
      COUNT(*) FILTER (WHERE is_account_matched = false)::int      AS mismatches,
      COUNT(*) FILTER (WHERE thunder_called AND thunder_success IS NOT TRUE
                             AND is_duplicate IS NOT TRUE)::int    AS unreadable
    FROM slip_checks
    WHERE created_at > NOW() - INTERVAL '30 days'
      AND (${ch}::text IS NULL OR channel = ${ch})
    GROUP BY 1
    ORDER BY 1 DESC`;

  const totals = rows.reduce(
    (a, r) => ({
      images: a.images + Number(r.images),
      thunder_calls: a.thunder_calls + Number(r.thunder_calls),
      filtered_out: a.filtered_out + Number(r.filtered_out),
      slip_ok: a.slip_ok + Number(r.slip_ok),
    }),
    { images: 0, thunder_calls: 0, filtered_out: 0, slip_ok: 0 },
  );

  return { windowDays: 30, totals, days: rows };
}

export interface SlipCheckEvent {
  channel: string;
  looksLikeSlip: boolean;                  // Haiku pre-filter verdict
  prefilterAnswer: string | null;          // Haiku's raw answer (null = model call failed → fail-safe pass)
  result: ThunderVerifyResponse | null;    // null when the pre-filter dropped it (no Thunder call)
}

/** Persist one slip-check event. `thunder_called` mirrors `looksLikeSlip`
 *  (Thunder is only hit when the pre-filter passes), so summing it gives the
 *  Thunder quota consumed. `prefilter_answer` + `raw` are the diagnosability
 *  columns (2026-07-23 incident): the Haiku answer proves WHY a drop happened,
 *  the full Thunder response pins the live API contract (e.g. whether
 *  isAccountMatched is ever present). Swallows every error. */
export async function recordSlipCheck(ev: SlipCheckEvent): Promise<void> {
  if (!isPostgresConfigured()) return;
  const r = ev.result;
  const amount = r?.data?.rawSlip?.amount?.amount ?? null;
  try {
    await sql`
      INSERT INTO slip_checks
        (channel, looks_like_slip, prefilter_answer, thunder_called, thunder_success, is_duplicate, is_account_matched, amount, raw)
      VALUES
        (${ev.channel}, ${ev.looksLikeSlip}, ${ev.prefilterAnswer}, ${ev.looksLikeSlip},
         ${r ? r.success : null}, ${r?.data?.isDuplicate ?? null}, ${r ? slipAccountMatched(r) : null}, ${amount},
         ${r ? JSON.stringify(r) : null}::jsonb)`;
  } catch (e) {
    console.error('[ai-quote] recordSlipCheck failed:', e instanceof Error ? e.message : e);
  }
}

/** Newest-first raw slip-check rows for /api/admin/slip-metrics?recent=N —
 *  browser-readable evidence (prefilter answer + full Thunder response) without
 *  needing DB console access. NULL channel param disables the filter in-query
 *  (mirror loadSlipMetrics). */
export async function loadRecentSlipChecks(channel: SlipMetricsChannel | undefined, limit: number) {
  const ch = channel ?? null;
  const { rows } = await sql`
    SELECT id, created_at, channel, looks_like_slip, prefilter_answer,
           thunder_called, thunder_success, is_duplicate, is_account_matched, amount, raw
    FROM slip_checks
    WHERE (${ch}::text IS NULL OR channel = ${ch})
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows;
}
