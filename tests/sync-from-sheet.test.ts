import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetMockPostgres,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

// Stub @/lib/api to avoid pulling in the full Apps Script client.
// Returns an empty snapshot — sync functions will no-op cleanly so we can
// focus assertions on sync_meta + table-skip behavior.
vi.mock('@/lib/api', () => ({
  loadAllWithAudit: vi.fn(async () => ({
    jobs: [],
    orders: [],
    shipped: [],
    cancelled: [],
    templates: [
      // One real-looking template so we can prove the skip branch did NOT
      // truncate this table when the flag is on.
      { id: 1700000000001, name: 'tpl1', rawData: {}, createdBy: 'admin', createdAt: '2026-05-10' },
    ],
    audit: [],
  })),
  AppsScriptError: class AppsScriptError extends Error {},
}));

import { syncAllFromSheet } from '@/lib/sync-from-sheet';

describe('syncAllFromSheet — Phase 2 table-skip MUST touch sync_meta', () => {
  beforeEach(() => {
    resetMockPostgres();
    delete process.env.WRITE_TEMPLATES_TO_POSTGRES;
  });
  afterEach(() => {
    delete process.env.WRITE_TEMPLATES_TO_POSTGRES;
  });

  it('with flag OFF — runs full templates sync (TRUNCATE + INSERT) and records sync_meta', async () => {
    const result = await syncAllFromSheet();
    const tplResult = result.tables.find((t) => t.table === 'templates');
    expect(tplResult).toBeDefined();
    expect(tplResult!.ok).toBe(true);
    expect(tplResult!.error).toBeUndefined();

    // Full sync path invokes TRUNCATE on templates table.
    expect(callsContaining('TRUNCATE TABLE templates')).toHaveLength(1);

    // sync_meta is updated via recordSyncMeta (full upsert with row_count).
    // Filter for the templates-specific call — there's one per table.
    const tplMetaCalls = callsContaining('INSERT INTO sync_meta').filter(
      (c) => c.values[0] === 'templates',
    );
    expect(tplMetaCalls.length).toBeGreaterThanOrEqual(1);
    // Full path includes row_count column (vs. the touch path which omits it).
    expect(tplMetaCalls[0].text).toContain('row_count');
  });

  it('with flag ON — SKIPS templates sync but STILL touches sync_meta (regression guard)', async () => {
    // 🐛 This is the test that catches the 2026-05-10 setCowork-style bug:
    // if a future Phase 2 migration adds `phase2OwnsTable('newTable')` but
    // forgets `recordSyncMetaTouch(...)` in the skip branch, sync_meta
    // staleness check will trip and silent-fallback all reads to Apps Script.
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '1';

    const result = await syncAllFromSheet();
    const tplResult = result.tables.find((t) => t.table === 'templates');
    expect(tplResult).toBeDefined();
    expect(tplResult!.ok).toBe(true);
    expect(tplResult!.inserted).toBe(0);
    expect(tplResult!.error).toMatch(/skipped.*Postgres owns/i);

    // ✋ NO TRUNCATE on templates — skip branch protects Phase 2-only rows.
    expect(callsContaining('TRUNCATE TABLE templates')).toHaveLength(0);

    // ✅ sync_meta MUST still be touched for templates, otherwise loadAllFromPostgres
    // staleness check fails after 30 min and reads silently fall back to Apps Script.
    const tplMetaCalls = callsContaining('INSERT INTO sync_meta').filter(
      (c) => c.values[0] === 'templates',
    );
    expect(
      tplMetaCalls.length,
      'recordSyncMetaTouch must run on Phase 2 table-skip — see feedback_phase2_table_skip_sync_meta.md',
    ).toBeGreaterThanOrEqual(1);
  });

  it('with flag ON — sync_meta touch survives even when other tables fail', async () => {
    // Even if jobs/orders/etc. fail, the templates skip branch should still
    // record sync_meta for templates. (Future-proofing: we never want a
    // partial sync to leave templates appearing stale.)
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '1';

    const result = await syncAllFromSheet();
    const tplMetaCalls = callsContaining('INSERT INTO sync_meta').filter(
      (c) => c.values[0] === 'templates',
    );
    expect(tplMetaCalls.length).toBeGreaterThanOrEqual(1);

    // The touch query specifically OMITS row_count (Phase 2 owns the table,
    // we don't know the count from cron's perspective) and writes ok=true
    // as a literal in the SQL text, not a parameter.
    const tplTouch = tplMetaCalls[0];
    expect(tplTouch.text).not.toContain('row_count');
    expect(tplTouch.text).toContain('last_sync_at');
    expect(tplTouch.text).toMatch(/ok\)\s*VALUES.*true/i);
    expect(result.ok).toBe(true);
  });
});
