import { STAFF, type Dept } from './board';

/**
 * Forward (ส่งต่องาน) logic — port of `FW_TARGETS` + `computeFromType` from
 * WP `production-monitoring.js:425-434`. Used by `/api/jobs/forward` to
 * validate target picks server-side and by the card UI to render dropdowns.
 *
 * Source-of-truth: keep in sync if WP STAFF/FW_TARGETS changes (the production
 * Apps Script doesn't enforce target-vs-source — frontend filtering is the gate).
 *
 * v5.11.0 added `diecut_in` between `bind` and `diecut_out` in post dept;
 * `post_diecut_in` is its own fromType key.
 */

export type FromType =
  | 'graphic'
  | 'print'
  | 'print_outsource'
  | 'post_cut'
  | 'post_bind'
  | 'post_diecut_in'
  | 'post_diecut_out'
  | 'any';

export interface ForwardTarget {
  /** Staff id at the destination (e.g. 'sm74', 'ship'). */
  value: string;
  /** Display label including dept prefix when crossing dept boundaries. */
  label: string;
  /** Destination dept ('print' / 'post' — graphic is never a forward target). */
  dept: Dept;
}

/** Restricted target staff — admin only (vendor / outsource columns). */
export const RESTRICTED_TARGETS: ReadonlySet<string> = new Set(['outsource', 'diecut_out']);

/** Map fromType → list of valid forward targets. Mirrors WP FW_TARGETS exactly. */
export const FW_TARGETS: Record<FromType, ForwardTarget[]> = {
  graphic: [
    ...STAFF.print.map((s) => ({ value: s.id, label: `[พิมพ์] ${s.name}`, dept: 'print' as Dept })),
    ...STAFF.post.map((s) => ({ value: s.id, label: `[หลังพิมพ์] ${s.name}`, dept: 'post' as Dept })),
  ],
  print: [
    ...STAFF.post
      .filter((s) => s.id !== 'ship')
      .map((s) => ({ value: s.id, label: s.name, dept: 'post' as Dept })),
    { value: 'ship', label: 'รอจัดส่ง', dept: 'post' },
  ],
  print_outsource: [{ value: 'ship', label: 'รอจัดส่ง', dept: 'post' }],
  post_cut: [
    { value: 'bind', label: 'เข้าเล่ม', dept: 'post' },
    { value: 'diecut_in', label: 'ไดคัท(ภายใน)', dept: 'post' },
    { value: 'diecut_out', label: 'ไดคัท(นอก)', dept: 'post' },
    { value: 'ship', label: 'รอจัดส่ง', dept: 'post' },
  ],
  post_bind: [
    { value: 'diecut_in', label: 'ไดคัท(ภายใน)', dept: 'post' },
    { value: 'ship', label: 'รอจัดส่ง', dept: 'post' },
  ],
  post_diecut_in: [
    { value: 'bind', label: 'เข้าเล่ม', dept: 'post' },
    { value: 'ship', label: 'รอจัดส่ง', dept: 'post' },
  ],
  post_diecut_out: [{ value: 'ship', label: 'รอจัดส่ง', dept: 'post' }],
  any: [{ value: 'ship', label: 'รอจัดส่ง', dept: 'post' }],
};

/** Compute fromType from a job's current dept+staff. `ship` returns null —
 *  ship is terminal (use moveToShipped, not forward). */
export function computeFromType(dept: string, staff: string): FromType | null {
  if (dept === 'graphic') return 'graphic';
  if (dept === 'print') return staff === 'outsource' ? 'print_outsource' : 'print';
  if (dept === 'post') {
    if (staff === 'cut') return 'post_cut';
    if (staff === 'bind') return 'post_bind';
    if (staff === 'diecut_in') return 'post_diecut_in';
    if (staff === 'diecut_out') return 'post_diecut_out';
    if (staff === 'ship') return null; // terminal
  }
  return 'any';
}

/** Targets visible to a given role. Strips RESTRICTED_TARGETS for non-admin. */
export function getVisibleTargets(fromType: FromType, isAdmin: boolean): ForwardTarget[] {
  const all = FW_TARGETS[fromType];
  if (isAdmin) return all;
  return all.filter((t) => !RESTRICTED_TARGETS.has(t.value));
}

export interface ReassignCheck {
  /** Job's dept as read from Postgres — never client-supplied. */
  realDept: string;
  /** Job's staff as read from Postgres — never client-supplied. */
  realStaff: string;
  targetDept: string;
  targetStaff: string;
  isAdmin: boolean;
}

/** Server-side validate a reassign (same-dept staff swap for all roles,
 *  cross-dept for admin only). Takes the REAL dept/staff read from Postgres
 *  — there is no client-dept parameter, so a lying client cannot make a
 *  cross-dept move look same-dept (M-reassign-client-dept-trust, audit
 *  2026-07-21). Returns null if valid, {status, error} otherwise. */
export function validateReassign(c: ReassignCheck): { status: number; error: string } | null {
  // No-op guard — must compare BOTH dept and staff (admin cross-dept move
  // back to the same row is still a no-op).
  if (c.targetDept === c.realDept && c.targetStaff === c.realStaff) {
    return { status: 400, error: 'ผู้รับงานเดิมแล้ว — ไม่ต้องย้าย' };
  }
  if (c.targetDept !== c.realDept && !c.isAdmin) {
    return { status: 403, error: 'ย้ายข้ามแผนกสำหรับ admin เท่านั้น' };
  }
  const validInDept = STAFF[c.targetDept as Dept]?.some((s) => s.id === c.targetStaff);
  if (!validInDept) {
    return { status: 400, error: `ผู้รับงาน "${c.targetStaff}" ไม่อยู่ในแผนก "${c.targetDept}"` };
  }
  if (!c.isAdmin && RESTRICTED_TARGETS.has(c.targetStaff)) {
    return { status: 403, error: `ปลายทาง "${c.targetStaff}" สำหรับ admin เท่านั้น` };
  }
  return null;
}

/** Server-side validate that a (targetDept, targetStaff) pair is reachable from
 *  the given source. Returns null if valid, error string otherwise. */
export function validateForwardTarget(
  fromDept: string,
  fromStaff: string,
  targetDept: string,
  targetStaff: string,
  isAdmin: boolean,
): string | null {
  const fromType = computeFromType(fromDept, fromStaff);
  if (!fromType) return `ไม่สามารถส่งต่อจาก ${fromDept}/${fromStaff} (terminal column)`;
  const targets = getVisibleTargets(fromType, isAdmin);
  const match = targets.find((t) => t.value === targetStaff && t.dept === targetDept);
  if (!match) {
    if (RESTRICTED_TARGETS.has(targetStaff) && !isAdmin) {
      return `ปลายทาง "${targetStaff}" สำหรับ admin เท่านั้น`;
    }
    return `ปลายทาง ${targetDept}/${targetStaff} ไม่ใช่เป้าหมายที่ถูกต้องจาก ${fromDept}/${fromStaff}`;
  }
  return null;
}
