/**
 * Shared mock state for `@/lib/postgres`. Tests import from this module
 * to inspect SQL calls made by the code under test.
 *
 * Usage in a test file:
 *   import { sqlCalls, queueResult, resetMockPostgres } from '../helpers/mock-postgres';
 *   vi.mock('@/lib/postgres', () => import('../helpers/mock-postgres'));
 *
 * The mock supports both invocation styles used by lib/:
 *  - tagged-template: sql`SELECT ... ${id}`
 *  - explicit query:  sql.query('SELECT ... $1', [id])
 *
 * Each call appends a record to `sqlCalls`. Tests can call `queueResult()`
 * to set what the NEXT sql call should resolve to (FIFO). Default = empty.
 */

export interface SqlCall {
  type: 'tag' | 'query';
  /** Reconstructed SQL text — for `tag`, parameter slots are joined with
   *  the literal placeholder `$N`. For `query`, the original parameterized
   *  text is preserved. Whitespace is collapsed for stable assertions. */
  text: string;
  /** Bound parameter values (in order). */
  values: unknown[];
}

export interface SqlResult {
  rows?: unknown[];
  rowCount?: number;
}

/** Queue entry — either a result to resolve with, or an error to reject with
 *  (via queueError — lets tests exercise compensation/rollback paths). */
type QueueEntry = { result: SqlResult } | { throwErr: unknown };

const state = {
  calls: [] as SqlCall[],
  queue: [] as QueueEntry[],
  configured: true,
};

function normaliseSql(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

interface SqlMock {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlResult>;
  query(text: string, params?: unknown[]): Promise<SqlResult>;
}

function nextResult(): Promise<SqlResult> {
  const entry = state.queue.shift();
  if (!entry) return Promise.resolve({ rows: [], rowCount: 0 });
  if ('throwErr' in entry) return Promise.reject(entry.throwErr);
  return Promise.resolve(entry.result);
}

function makeSqlMock(): SqlMock {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlResult> => {
    let text = strings[0] || '';
    for (let i = 0; i < values.length; i++) {
      text += `$${i + 1}` + (strings[i + 1] || '');
    }
    state.calls.push({ type: 'tag', text: normaliseSql(text), values });
    return nextResult();
  };
  const query = (text: string, params: unknown[] = []): Promise<SqlResult> => {
    state.calls.push({ type: 'query', text: normaliseSql(text), values: params });
    return nextResult();
  };
  return Object.assign(tag, { query });
}

// Exports consumed by the mocked `@/lib/postgres` module ────────────

export const sql = makeSqlMock();
export const db = null;
export const createPool = () => null;
export const POSTGRES_AVAILABLE = true;
export function isPostgresConfigured(): boolean {
  return state.configured;
}

// Test-side helpers ─────────────────────────────────────────────────

export const sqlCalls = state.calls;

export function resetMockPostgres(): void {
  state.calls.length = 0;
  state.queue.length = 0;
  state.configured = true;
}

export function queueResult(r: SqlResult): void {
  state.queue.push({ result: r });
}

/** Make the NEXT sql call reject with `err` — for testing compensation /
 *  rollback paths (e.g. tombstone-gate succeeded but terminal INSERT failed). */
export function queueError(err: unknown): void {
  state.queue.push({ throwErr: err });
}

export function setConfigured(b: boolean): void {
  state.configured = b;
}

export function findCallContaining(needle: string): SqlCall | undefined {
  return state.calls.find((c) => c.text.includes(needle));
}

export function callsContaining(needle: string): SqlCall[] {
  return state.calls.filter((c) => c.text.includes(needle));
}
