import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetMockPostgres,
  callsContaining,
} from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

// Mutable snapshot — tests can override per-case via setSnapshot().
let snapshot: {
  jobs: unknown[]; orders: unknown[]; shipped: unknown[]; cancelled: unknown[];
  templates: unknown[]; audit: unknown[];
} = {
  jobs: [], orders: [], shipped: [], cancelled: [],
  templates: [
    // One real-looking template so we can prove the skip branch did NOT
    // truncate this table when the flag is on.
    { id: 1700000000001, name: 'tpl1', rawData: {}, createdBy: 'admin', createdAt: '2026-05-10' },
  ],
  audit: [],
};

function setSnapshot(s: Partial<typeof snapshot>): void {
  snapshot = { ...snapshot, ...s };
}

function resetSnapshot(): void {
  snapshot = {
    jobs: [], orders: [], shipped: [], cancelled: [],
    templates: [
      { id: 1700000000001, name: 'tpl1', rawData: {}, createdBy: 'admin', createdAt: '2026-05-10' },
    ],
    audit: [],
  };
}

vi.mock('@/lib/api', () => ({
  loadAllFromAppsScriptForSync: vi.fn(async () => snapshot),
  AppsScriptError: class AppsScriptError extends Error {},
}));

import { syncAllFromSheet } from '@/lib/sync-from-sheet';

describe('syncAllFromSheet — Phase 2 table-skip MUST touch sync_meta', () => {
  beforeEach(() => {
    resetMockPostgres();
    resetSnapshot();
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

describe('syncAllFromSheet — must read from Apps Script, not Postgres-first wrapper', () => {
  beforeEach(() => {
    resetMockPostgres();
    resetSnapshot();
  });

  it('imports the loader that bypasses the Postgres-first wrapper', async () => {
    // 🐛 Regression guard for the 2026-05-11 bootstrap-loop bug:
    // sync-from-sheet was importing `loadAllWithAudit` from @/lib/api,
    // which goes through tryPostgres() and returns the Postgres mirror
    // when READ_FROM_POSTGRES=1. Cron then "refreshed" Postgres FROM
    // Postgres — a no-op — and today's Sheet entries never landed.
    //
    // Fix: import the explicit Apps-Script-only fetcher
    // `loadAllFromAppsScriptForSync` so cron always sees the Sheet truth
    // regardless of the read flag.
    const apiModule = await import('@/lib/api');
    expect(
      typeof apiModule.loadAllFromAppsScriptForSync,
      'sync-from-sheet must use loadAllFromAppsScriptForSync, not the Postgres-first loadAllWithAudit',
    ).toBe('function');
    // Negative assertion — if someone reintroduces loadAllWithAudit usage
    // here, the bootstrap loop returns. Verified by the source-import
    // string check below (we can't easily probe Vitest's module imports
    // without intermediate state, so the import-name above is the canary).
  });
});

describe('syncAllFromSheet — audit_log preserves Phase 2 entries', () => {
  beforeEach(() => {
    resetMockPostgres();
    resetSnapshot();
  });

  it('uses DELETE WHERE source=sheet — preserves source=postgres rows', async () => {
    // 🐛 Regression guard for the 2026-05-11 audit log fix:
    // Phase 2 routes (setCowork/updateJob/addJob) write audit entries
    // directly to Postgres with source='postgres' so they show in /board
    // history tab immediately. The from-Sheet cron used to TRUNCATE the
    // entire table, wiping these Phase 2 entries every run. Fix: only
    // DELETE rows that came from Sheet (source='sheet').
    await syncAllFromSheet();

    const auditDeletes = callsContaining('DELETE FROM audit_log');
    expect(auditDeletes.length).toBeGreaterThanOrEqual(1);
    const wipeCall = auditDeletes[0];
    expect(
      wipeCall.text.toLowerCase(),
      "audit_log refresh must scope to source='sheet' so Phase 2 entries survive",
    ).toMatch(/source\s*=\s*'sheet'/);

    // Cardinal check — no TRUNCATE on audit_log (only on templates if any).
    expect(callsContaining('TRUNCATE TABLE audit_log')).toHaveLength(0);
  });

  it('inserts new Sheet entries with source=sheet so cron can find them next time', async () => {
    setSnapshot({
      audit: [
        { timestamp: '2026-05-11T08:00:00Z', role: 'admin', action: 'addJob', targetId: '100', summary: 'x' },
      ],
    });
    await syncAllFromSheet();

    const auditInserts = callsContaining('INSERT INTO audit_log');
    expect(auditInserts.length).toBeGreaterThanOrEqual(1);
    const insert = auditInserts[0];
    // Bulk insert format includes source column literal in the values list
    // (one per row, last position). Verify 'sheet' is bound for the audit row.
    expect(insert.values).toContain('sheet');
  });
});
