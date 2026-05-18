import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { phase2WriteEnabled, phase2OwnsTable } from '@/lib/feature-flags';

const RELEVANT_VARS = [
  'WRITE_TEMPLATES_TO_POSTGRES',
  'WRITE_COWORK_TO_POSTGRES',
  'WRITE_DELETE_JOB_TO_POSTGRES',
  'WRITE_RESTORE_JOB_TO_POSTGRES',
  'WRITE_FORWARD_UNDO_TO_POSTGRES',
];

describe('phase2WriteEnabled', () => {
  beforeEach(() => {
    for (const v of RELEVANT_VARS) delete process.env[v];
  });
  afterEach(() => {
    for (const v of RELEVANT_VARS) delete process.env[v];
  });

  it('returns false for unknown actions even if a flag is set', () => {
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('unknownAction')).toBe(false);
    expect(phase2WriteEnabled('updateJob')).toBe(false);
  });

  it('returns false for known actions when env var is unset', () => {
    expect(phase2WriteEnabled('addTemplate')).toBe(false);
    expect(phase2WriteEnabled('deleteTemplate')).toBe(false);
    expect(phase2WriteEnabled('setCowork')).toBe(false);
    expect(phase2WriteEnabled('deleteJob')).toBe(false);
    expect(phase2WriteEnabled('restoreJob')).toBe(false);
    expect(phase2WriteEnabled('forwardUndo')).toBe(false);
  });

  it('returns true for Phase 4.2 Stage 1 actions when their own flag is set', () => {
    process.env.WRITE_DELETE_JOB_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('deleteJob')).toBe(true);
    expect(phase2WriteEnabled('restoreJob')).toBe(false);
    expect(phase2WriteEnabled('forwardUndo')).toBe(false);

    process.env.WRITE_RESTORE_JOB_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('restoreJob')).toBe(true);

    process.env.WRITE_FORWARD_UNDO_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('forwardUndo')).toBe(true);
  });

  it('returns true for templates actions when WRITE_TEMPLATES_TO_POSTGRES=1', () => {
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('addTemplate')).toBe(true);
    expect(phase2WriteEnabled('deleteTemplate')).toBe(true);
    // Unrelated flag should not turn on
    expect(phase2WriteEnabled('setCowork')).toBe(false);
  });

  it('returns true for setCowork when WRITE_COWORK_TO_POSTGRES=1', () => {
    process.env.WRITE_COWORK_TO_POSTGRES = '1';
    expect(phase2WriteEnabled('setCowork')).toBe(true);
    expect(phase2WriteEnabled('addTemplate')).toBe(false);
  });

  it('treats values other than literal "1" as off (no truthy coercion)', () => {
    process.env.WRITE_TEMPLATES_TO_POSTGRES = 'true';
    expect(phase2WriteEnabled('addTemplate')).toBe(false);
    process.env.WRITE_TEMPLATES_TO_POSTGRES = 'yes';
    expect(phase2WriteEnabled('addTemplate')).toBe(false);
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '0';
    expect(phase2WriteEnabled('addTemplate')).toBe(false);
  });
});

describe('phase2OwnsTable', () => {
  beforeEach(() => {
    for (const v of RELEVANT_VARS) delete process.env[v];
  });
  afterEach(() => {
    for (const v of RELEVANT_VARS) delete process.env[v];
  });

  it('returns false for all tables when no Phase 2 flag is set', () => {
    expect(phase2OwnsTable('templates')).toBe(false);
    expect(phase2OwnsTable('jobs')).toBe(false);
    expect(phase2OwnsTable('orders')).toBe(false);
    expect(phase2OwnsTable('shipped')).toBe(false);
    expect(phase2OwnsTable('cancelled')).toBe(false);
    expect(phase2OwnsTable('audit_log')).toBe(false);
  });

  it('returns true for templates when WRITE_TEMPLATES_TO_POSTGRES=1', () => {
    process.env.WRITE_TEMPLATES_TO_POSTGRES = '1';
    expect(phase2OwnsTable('templates')).toBe(true);
  });

  it('does not turn on jobs/orders ownership for setCowork flag (row-level only)', () => {
    // setCowork uses row-level dirty marker, NOT table-level ownership.
    // If we ever flip this, the cron sync needs to skip + recordSyncMetaTouch.
    process.env.WRITE_COWORK_TO_POSTGRES = '1';
    expect(phase2OwnsTable('jobs')).toBe(false);
    expect(phase2OwnsTable('orders')).toBe(false);
  });
});
