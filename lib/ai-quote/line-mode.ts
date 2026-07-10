// lib/ai-quote/line-mode.ts
// Mode state for the LINE customer AI-quote flow (Phase 1b-B, spec §1-§2).
// One row per LINE user in ai_quote_line_modes. The same row carries both the
// active-mode fields (nullable — NULL = not in mode) and the 24h hint gate
// (last_hint_at survives mode exit so hints stay throttled across sessions).
// Expiry is lazy: nothing deletes rows on a timer — modeActive() checks the
// idle window when the next message arrives (no cron, spec D1).
import 'server-only';
import { sql } from '@/lib/postgres';

export const MODE_IDLE_MINUTES = 30;   // spec §1 — idle >30 min = mode expired
export const HINT_GATE_HOURS = 24;     // spec §2 — ≤1 hint/user/24h
export const STAFF_SUPPRESS_HOURS = 48; // HINT-1 — staff replied within → no hint

export interface LineModeRow {
  channelUserId: string;
  enteredAt: string | null;
  lastActivityAt: string | null;
  sessionId: number | null;
  roundsNoQuote: number;
  lastHintAt: string | null;
  lastStaffReplyAt: string | null;
}

/** Pure: is the mode still active given the last-activity timestamp? */
export function modeActive(lastActivityAt: string | null, nowMs: number): boolean {
  if (!lastActivityAt) return false;
  const t = Date.parse(lastActivityAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= MODE_IDLE_MINUTES * 60_000;
}

/** Pure: may we send the out-of-mode hint (≤1/user/24h)? */
export function hintAllowed(lastHintAt: string | null, nowMs: number): boolean {
  if (!lastHintAt) return true;
  const t = Date.parse(lastHintAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > HINT_GATE_HOURS * 3_600_000;
}

/** Pure: did staff reply to this customer within the suppression window?
 *  (HINT-1 — Messenger message_echoes). true = never interject with a hint. */
export function staffActive(lastStaffReplyAt: string | null, nowMs: number): boolean {
  if (!lastStaffReplyAt) return false;
  const t = Date.parse(lastStaffReplyAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= STAFF_SUPPRESS_HOURS * 3_600_000;
}

/** pg-types parses TIMESTAMPTZ into a JS Date by default; a custom parser or
 *  driver swap could hand us a string instead. Normalize to ISO so
 *  modeActive/hintAllowed always Date.parse a well-formed value. */
function toIso(v: unknown): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function rowToMode(r: Record<string, unknown>): LineModeRow {
  return {
    channelUserId: String(r.channel_user_id),
    enteredAt: toIso(r.entered_at),
    lastActivityAt: toIso(r.last_activity_at),
    sessionId: r.session_id == null ? null : Number(r.session_id),
    roundsNoQuote: Number(r.rounds_no_quote) || 0,
    lastHintAt: toIso(r.last_hint_at),
    lastStaffReplyAt: toIso(r.last_staff_reply_at),
  };
}

export async function loadLineMode(channelUserId: string): Promise<LineModeRow | null> {
  const { rows } = await sql`SELECT * FROM ai_quote_line_modes WHERE channel_user_id = ${channelUserId}`;
  return rows[0] ? rowToMode(rows[0] as Record<string, unknown>) : null;
}

/** Enter (or re-enter) AI mode. Keeps session_id — a quick re-entry continues
 *  the same conversation; after exit/escalation session_id is already NULL. */
export async function enterLineMode(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, entered_at, last_activity_at, rounds_no_quote)
    VALUES (${channelUserId}, NOW(), NOW(), 0)
    ON CONFLICT (channel_user_id)
    DO UPDATE SET entered_at = NOW(), last_activity_at = NOW(), rounds_no_quote = 0`;
}

/** Refresh the idle window after a handled turn; optionally link the session
 *  and update the no-quote round counter (omit a field to leave it as-is).
 *  Note: roundsNoQuote is caller-computed (read→compute→write); concurrent
 *  webhook deliveries can lose an increment. Acceptable — it's a soft counter
 *  that at worst delays escalation trigger ③ by one round. */
export async function touchLineMode(
  channelUserId: string,
  patch: { sessionId?: number | null; roundsNoQuote?: number | null },
): Promise<void> {
  await sql`
    UPDATE ai_quote_line_modes
       SET last_activity_at = NOW(),
           session_id       = COALESCE(${patch.sessionId ?? null}, session_id),
           rounds_no_quote  = COALESCE(${patch.roundsNoQuote ?? null}, rounds_no_quote)
     WHERE channel_user_id = ${channelUserId}`;
}

/** Leave AI mode (customer exit or escalation hand-off). Keeps last_hint_at —
 *  the 24h hint gate must survive mode exits. */
export async function exitLineMode(channelUserId: string): Promise<void> {
  await sql`
    UPDATE ai_quote_line_modes
       SET entered_at = NULL, last_activity_at = NULL, session_id = NULL, rounds_no_quote = 0
     WHERE channel_user_id = ${channelUserId}`;
}

/** Record that the out-of-mode hint was sent (starts the 24h gate). Upsert —
 *  most users get a hint before they ever enter the mode. */
export async function markHintSent(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, last_hint_at)
    VALUES (${channelUserId}, NOW())
    ON CONFLICT (channel_user_id) DO UPDATE SET last_hint_at = NOW()`;
}

/** Staff replied from the Page inbox (Messenger message_echoes → HINT-1):
 *  stamp the 48h suppression window AND clear the mode in one atomic upsert —
 *  staff takeover stops the AI immediately. Keeps last_hint_at (the 24h hint
 *  gate is an independent axis). Upsert: a customer with no row yet still
 *  gets the suppression window recorded. */
export async function recordStaffReply(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, last_staff_reply_at, entered_at, last_activity_at, session_id, rounds_no_quote)
    VALUES (${channelUserId}, NOW(), NULL, NULL, NULL, 0)
    ON CONFLICT (channel_user_id)
    DO UPDATE SET last_staff_reply_at = NOW(),
                  entered_at = NULL, last_activity_at = NULL,
                  session_id = NULL, rounds_no_quote = 0`;
}
