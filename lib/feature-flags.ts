import 'server-only';

/**
 * Phase 2 — per-action write-migration feature flags.
 *
 * Each migrated action gets its own opt-in env var. Default-off until
 * verified in preview + flipped per-action in Vercel project settings.
 *
 * Rollout playbook for a new action:
 *  1. Implement Postgres-first handler in lib/postgres-write.ts
 *  2. Wire route to branch on phase2WriteEnabled('<action>')
 *  3. Deploy with flag OFF (smoke test in preview by setting flag in
 *     preview env)
 *  4. Flip flag ON in production env, watch Sentry for fallback rate
 *  5. After 24-48h stable, gate the matching Sheet→Postgres cron sync
 *     (see lib/sync-from-sheet.ts) so cron stops overwriting Postgres-
 *     owned tables
 *  6. Eventually drop the legacy Apps Script handler entirely (later phase)
 *
 * Rollback: unset the env var + redeploy → reads/writes return to the
 * Apps Script path. Postgres rows accumulated during the on-period stay
 * in place and re-sync via cron (which will resume Sheet→Postgres
 * because the flag is off).
 */

const ACTION_ENV_VAR: Record<string, string> = {
  // Templates — first action migrated. Low blast radius, low frequency,
  // identified by name (UNIQUE-ish) + Date.now() id. Used only on
  // /orders/new for save-preset / load-preset.
  addTemplate:    'WRITE_TEMPLATES_TO_POSTGRES',
  deleteTemplate: 'WRITE_TEMPLATES_TO_POSTGRES',
  // setCowork — second action migrated. Single-field UPDATE, /board only,
  // no id allocation. Reuses Apps Script `setCowork` action for inline
  // Sheet sync (idempotent UPDATE) + heal cron uses `setJobRow` for
  // post-failure retries. First user of phase2_dirty_at infrastructure.
  setCowork:      'WRITE_COWORK_TO_POSTGRES',
  // updateJob — third action migrated (2026-05-11). Multi-field UPDATE
  // (name/date/dept/staff/status/orderId/cowork). Drops inline Apps Script
  // sync — relies on heal cron's setJobRow within 5 min. Reads through
  // Postgres (Phase 1 mirror) so /board card moves columns instantly when
  // dept/staff change without round-tripping the Sheet.
  updateJob:      'WRITE_UPDATE_JOB_TO_POSTGRES',
  // addJob — fourth action migrated (2026-05-11). Single INSERT.
  // Still calls Apps Script `getNextId` for sequential id allocation
  // (Sheet UI / morning report show short readable ids), but skips the
  // Apps Script `addJob` write — heal cron's setJobRow pushes the new
  // row to Sheet within 5 min. Eliminates the addJob round-trip's double
  // counter-bump (legacy `addJob` calls incrementConfig after getNextId
  // already bumped, leaving id gaps in Sheet). Phase 2 path = clean +1.
  addJob:         'WRITE_ADD_JOB_TO_POSTGRES',
  // createOrder — fifth action migrated (2026-05-11). Atomic 2-table INSERT
  // (orders + jobs). Dedupe scan via Postgres mirror (Phase 1). Id allocation
  // still through Apps Script (getNextOrderId per-month + getNextId global —
  // keeps Sheet UI ids readable). Skips Apps Script createOrder call → saves
  // ~1.3s on hot path (every new order/job comes through here). Heal cron
  // pushes setOrderRow + setJobRow to Sheet within 5 min.
  createOrder:    'WRITE_CREATE_ORDER_TO_POSTGRES',
};

/** True when the given mutation should write Postgres-first
 *  (lib/postgres-write.ts) instead of the legacy Apps Script path.
 *  Returns false for any action not in the migration map. */
export function phase2WriteEnabled(action: string): boolean {
  const envVar = ACTION_ENV_VAR[action];
  if (!envVar) return false;
  return process.env[envVar] === '1';
}

/** True when ANY Phase 2 write flag is on for `action`'s table. Used by
 *  lib/sync-from-sheet.ts to skip cron Sheet→Postgres sync for tables
 *  Postgres now owns. Direction reversal is a follow-up step (Postgres
 *  → Sheet) — for now we just stop overwriting. */
export function phase2OwnsTable(table: 'templates' | 'orders' | 'jobs' | 'shipped' | 'cancelled' | 'audit_log'): boolean {
  switch (table) {
    case 'templates':
      return process.env.WRITE_TEMPLATES_TO_POSTGRES === '1';
    // Add more cases as actions migrate. Examples for future phases:
    // case 'jobs':   return process.env.WRITE_JOBS_TO_POSTGRES === '1';
    // case 'orders': return process.env.WRITE_ORDERS_TO_POSTGRES === '1';
    default:
      return false;
  }
}
