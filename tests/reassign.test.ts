import { describe, it, expect, beforeEach, vi } from 'vitest';
import { queueResult, resetMockPostgres, findCallContaining } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { validateReassign } from '@/lib/forward';
import { loadJobDeptStaffFromPostgres } from '@/lib/api-postgres';

/**
 * M-reassign-client-dept-trust (audit 2026-07-21): the reassign route used
 * to feed the cross-dept admin gate with `body.srcJob.dept` — client-owned.
 * A non-admin claiming srcJob.dept === targetDept made a cross-dept move
 * look same-dept and slip through (plus the audit trail recorded the fake
 * prevDept). validateReassign takes the REAL dept/staff (read from
 * Postgres via loadJobDeptStaffFromPostgres) so a client-supplied dept can
 * no longer influence the guard — closed by construction: there is no
 * client-dept parameter.
 */
describe('validateReassign', () => {
  it('rejects cross-dept move for non-admin based on the REAL dept', () => {
    // Real job lives in post; client wants it in print. Pre-fix, lying
    // srcJob.dept='print' made this pass as same-dept.
    const r = validateReassign({
      realDept: 'post',
      realStaff: 'bind',
      targetDept: 'print',
      targetStaff: 'sm74',
      isAdmin: false,
    });
    expect(r).toEqual({ status: 403, error: 'ย้ายข้ามแผนกสำหรับ admin เท่านั้น' });
  });

  it('allows cross-dept move for admin', () => {
    const r = validateReassign({
      realDept: 'post',
      realStaff: 'bind',
      targetDept: 'print',
      targetStaff: 'sm74',
      isAdmin: true,
    });
    expect(r).toBeNull();
  });

  it('allows same-dept reassign for non-admin', () => {
    const r = validateReassign({
      realDept: 'print',
      realStaff: 'sm74',
      targetDept: 'print',
      targetStaff: 'mo',
      isAdmin: false,
    });
    expect(r).toBeNull();
  });

  it('rejects no-op (same dept AND same staff) with 400', () => {
    const r = validateReassign({
      realDept: 'print',
      realStaff: 'sm74',
      targetDept: 'print',
      targetStaff: 'sm74',
      isAdmin: true,
    });
    expect(r).toEqual({ status: 400, error: 'ผู้รับงานเดิมแล้ว — ไม่ต้องย้าย' });
  });

  it('rejects targetStaff not in targetDept with 400', () => {
    const r = validateReassign({
      realDept: 'print',
      realStaff: 'sm74',
      targetDept: 'print',
      targetStaff: 'bind', // bind is post staff
      isAdmin: true,
    });
    expect(r).toEqual({
      status: 400,
      error: 'ผู้รับงาน "bind" ไม่อยู่ในแผนก "print"',
    });
  });

  it('rejects RESTRICTED_TARGETS for non-admin even same-dept', () => {
    // post/cut → post/diecut_out is same-dept and reachable, but
    // diecut_out is a vendor column — admin only.
    const r = validateReassign({
      realDept: 'post',
      realStaff: 'cut',
      targetDept: 'post',
      targetStaff: 'diecut_out',
      isAdmin: false,
    });
    expect(r).toEqual({ status: 403, error: 'ปลายทาง "diecut_out" สำหรับ admin เท่านั้น' });
  });
});

describe('loadJobDeptStaffFromPostgres', () => {
  beforeEach(() => resetMockPostgres());

  it('reads dept/staff/name from raw and excludes tombstoned rows', async () => {
    queueResult({ rows: [{ dept: 'post', staff: 'bind', name: 'งานทดสอบ' }], rowCount: 1 });

    const r = await loadJobDeptStaffFromPostgres(5001);

    expect(r).toEqual({ dept: 'post', staff: 'bind', name: 'งานทดสอบ' });
    const call = findCallContaining('FROM jobs');
    expect(call).toBeDefined();
    // Guard fields come from the raw snapshot (jobs table is raw-JSONB
    // authoritative) and reassign must only touch live board rows.
    expect(call!.text).toContain("raw->>'dept'");
    expect(call!.text).toContain("raw->>'staff'");
    expect(call!.text).toContain('phase2_deleted_at IS NULL');
    expect(call!.values).toContain(5001);
  });

  it('returns null when the job is missing or tombstoned', async () => {
    queueResult({ rows: [], rowCount: 0 });
    const r = await loadJobDeptStaffFromPostgres(999999);
    expect(r).toBeNull();
  });

  it('throws on invalid job id without querying', async () => {
    await expect(loadJobDeptStaffFromPostgres(0)).rejects.toThrow('Invalid job id');
    await expect(loadJobDeptStaffFromPostgres('abc')).rejects.toThrow('Invalid job id');
    expect(findCallContaining('FROM jobs')).toBeUndefined();
  });
});
