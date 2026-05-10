import 'server-only';
import { sql, isPostgresConfigured } from '@/lib/postgres';

/**
 * Phase 2 — Postgres-as-source-of-truth write handlers.
 *
 * Difference vs lib/postgres-write-mirror.ts:
 *  - Mirror = Apps Script writes Sheet first, then mirror-to-Postgres.
 *    Sheet = source of truth. Postgres reflects state with ~ms lag.
 *  - This module = Postgres writes first (authoritative), then a
 *    best-effort Apps Script call propagates the change to Sheet so
 *    admin Sheet UI keeps working. Postgres = source of truth.
 *
 * Per-action rollout — controlled by lib/feature-flags.ts. Each action
 * has its own env var (e.g. WRITE_TEMPLATES_TO_POSTGRES=1) so we can
 * migrate one row type at a time and roll back instantly if anything
 * breaks. Default-off until verified per action.
 *
 * Failure mode contract:
 *  - Postgres write fails → propagate error to caller (user sees toast).
 *  - Apps Script Sheet sync fails → log to Sentry but DO NOT propagate.
 *    Sheet stays drifted; cron sync direction is reversed (Postgres →
 *    Sheet) for migrated tables, so drift heals on the next cron run
 *    once Apps Script is reachable again.
 *
 * Why not put these handlers in postgres-write-mirror.ts? Different
 * semantics — mirror is non-fatal best-effort, this module's writes
 * are authoritative. Two files keeps the mental model clean.
 */

class PostgresWriteError extends Error {
  constructor(public action: string, public reason: string) {
    super(`Postgres write ${action} failed: ${reason}`);
    this.name = 'PostgresWriteError';
  }
}

interface AnyRow { [k: string]: unknown }

// ─── templates ────────────────────────────────────────────────────

export interface AddTemplateInput {
  name: string;
  rawData?: Record<string, unknown> | string;
  createdBy?: string;
}

export interface AddTemplateResult {
  ok: true;
  id: number;
}

/** Insert a new template into Postgres with a Date.now() id (matches the
 *  Apps Script convention so legacy ids and new ids share the same shape).
 *  Caller is responsible for the best-effort Apps Script Sheet sync after
 *  this returns — see api.ts post() flow. */
export async function addTemplateToPostgres(input: AddTemplateInput): Promise<AddTemplateResult> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('addTemplate', 'POSTGRES_URL env var missing');
  }
  const name = String(input.name || '').trim();
  if (!name) throw new PostgresWriteError('addTemplate', 'Missing template name');

  const id = Date.now();
  const rawDataObj =
    typeof input.rawData === 'string'
      ? safeParseJson(input.rawData)
      : input.rawData || {};
  const rawDataStr = JSON.stringify(rawDataObj);
  const createdBy = input.createdBy != null ? String(input.createdBy) : null;
  const createdAt = new Date().toISOString();

  const raw = JSON.stringify({
    id,
    name,
    rawData: rawDataObj,
    createdBy,
    createdAt,
  });

  await sql`
    INSERT INTO templates (id, name, raw_data, created_by, created_at, raw)
    VALUES (${id}::bigint, ${name}, ${rawDataStr}::jsonb, ${createdBy}, ${createdAt}, ${raw}::jsonb)
  `;

  return { ok: true, id };
}

export interface DeleteTemplateResult {
  ok: true;
  found: boolean;
}

/** Delete a template by id from Postgres. `found=false` is a soft no-op —
 *  matches Sheet-side semantics where a missing row also returns "not
 *  found" rather than throwing. Caller can decide whether to surface that
 *  to the user. */
export async function deleteTemplateFromPostgres(id: number | string): Promise<DeleteTemplateResult> {
  if (!isPostgresConfigured()) {
    throw new PostgresWriteError('deleteTemplate', 'POSTGRES_URL env var missing');
  }
  const idNum = Number(id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    throw new PostgresWriteError('deleteTemplate', 'Invalid template id');
  }
  const r = await sql`DELETE FROM templates WHERE id = ${idNum}::bigint`;
  return { ok: true, found: (r.rowCount ?? 0) > 0 };
}

// ─── small util ───────────────────────────────────────────────────

function safeParseJson(s: string): AnyRow {
  if (!s) return {};
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' ? (parsed as AnyRow) : {};
  } catch {
    return {};
  }
}

export { PostgresWriteError };
