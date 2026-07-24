import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockPostgres,
  queueResult,
  queueError,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadOrderAndJobs } from '@/lib/api';

/**
 * L-loadOrderAndJobs-serial: the order + jobs queries are independent reads
 * on different tables — they must fire in ONE parallel batch (saves a Neon
 * hop on every cascade write path: promote-draft / orders-update / cancel /
 * delete). The not-found contract is preserved by discarding the jobs
 * result when the order row is missing.
 */
describe('loadOrderAndJobs', () => {
  beforeEach(() => resetMockPostgres());

  it('fires the jobs query in parallel (order query failure does not gate it)', async () => {
    // Black-box parallelism pin (PATTERNS §1.14): reject the FIRST (order)
    // query — under the old serial shape the jobs query is never issued.
    queueError(new Error('boom'));            // order query rejects
    queueResult({ rows: [], rowCount: 0 });   // jobs query (must still fire)

    await expect(loadOrderAndJobs(202605069)).rejects.toThrow('boom');
    expect(callsContaining('FROM jobs')).toHaveLength(1);
  });

  it('returns {order:null, jobs:[]} when the order is missing — jobs result discarded', async () => {
    queueResult({ rows: [], rowCount: 0 });                     // order: not found
    queueResult({ rows: [{ raw: { id: 1 } }], rowCount: 1 });   // jobs: stale rows (discard)

    const r = await loadOrderAndJobs(999999999);
    expect(r).toEqual({ order: null, jobs: [] });
  });

  it('returns the order with its active jobs', async () => {
    const order = { id: 202605069, name: 'sds-order' };
    queueResult({ rows: [{ raw: order }], rowCount: 1 });
    queueResult({ rows: [{ raw: { id: 518 } }, { raw: null }], rowCount: 2 });

    const r = await loadOrderAndJobs(202605069);
    expect(r.order).toEqual(order);
    // null raw rows are filtered
    expect(r.jobs).toEqual([{ id: 518 }]);
    // jobs query keeps the active-only tombstone filter
    expect(callsContaining('FROM jobs')[0].text).toContain('phase2_deleted_at IS NULL');
  });
});
