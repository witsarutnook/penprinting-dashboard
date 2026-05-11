import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { loadAllFromAppsScriptForSync } from '@/lib/api';

export const maxDuration = 30;

/**
 * Diagnostic for "ส่งเข้าระบบ" (promoteDraft) validation issues.
 *
 * Surfaces both Postgres + Sheet state of an order so we can pin which
 * source has the missing assignDept/assignStaff that promoteDraft is
 * rejecting on. Used to debug the 2026-05-11 "ขาด: ผู้รับงาน
 * (กราฟิก/พิมพ์)" symptom where the form clearly shows Outsource selected
 * but the server validation thinks the field is empty.
 *
 * Usage: GET /api/admin/diagnose-order?id=202605067
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'Postgres not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const idRaw = url.searchParams.get('id');
  const id = idRaw ? Number(idRaw) : null;
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'Missing or invalid ?id= parameter' }, { status: 400 });
  }

  // Layer 1 — Postgres flat columns + raw JSON
  const pgR = await sql<{
    id: number;
    status: string | null;
    assign_dept: string | null;
    assign_staff: string | null;
    orderer: string | null;
    customer: string | null;
    date_due: string | null;
    phase2_dirty_at: Date | null;
    raw: Record<string, unknown> | null;
  }>`
    SELECT id, status, assign_dept, assign_staff, orderer, customer, date_due, phase2_dirty_at, raw
    FROM orders WHERE id = ${id}::bigint LIMIT 1
  `;
  const pgRow = pgR.rows[0] || null;

  // Layer 2 — Sheet state via Apps Script direct (the path promote-draft uses)
  let sheetOrder: unknown = null;
  let sheetError: string | null = null;
  try {
    const snap = await loadAllFromAppsScriptForSync();
    sheetOrder = snap.orders.find((o) => Number(o.id) === id) || null;
  } catch (err) {
    sheetError = err instanceof Error ? err.message : String(err);
  }

  // Layer 3 — what would promote-draft's missing[] look like for each source?
  function evalValidation(o: { customer?: string | null; date_due?: string | null; dateDue?: string | null; orderer?: string | null; assign_dept?: string | null; assignDept?: string | null; assign_staff?: string | null; assignStaff?: string | null; } | null): { missing: string[]; assignDept: string; assignStaff: string } {
    if (!o) return { missing: ['ORDER NOT FOUND'], assignDept: '', assignStaff: '' };
    const customer = String(o.customer || '').trim();
    const dateDue = String(o.date_due ?? o.dateDue ?? '').trim();
    const orderer = String(o.orderer || '').trim();
    const assignDept = String(o.assign_dept ?? o.assignDept ?? '').trim();
    const assignStaff = String(o.assign_staff ?? o.assignStaff ?? '').trim();
    const missing: string[] = [];
    if (!customer || customer === '-') missing.push('ชื่อลูกค้า');
    if (!dateDue) missing.push('กำหนดส่ง');
    if (!orderer) missing.push('ผู้สั่งงาน');
    if (!assignDept || !assignStaff) missing.push('ผู้รับงาน (กราฟิก/พิมพ์)');
    return { missing, assignDept, assignStaff };
  }

  return NextResponse.json({
    orderId: id,
    postgres: {
      exists: !!pgRow,
      flat: pgRow ? {
        status: pgRow.status,
        assignDept: pgRow.assign_dept,
        assignStaff: pgRow.assign_staff,
        orderer: pgRow.orderer,
        customer: pgRow.customer,
        dateDue: pgRow.date_due,
      } : null,
      rawJson: pgRow?.raw ? {
        assignDept: (pgRow.raw as Record<string, unknown>).assignDept,
        assignStaff: (pgRow.raw as Record<string, unknown>).assignStaff,
        forwardPrint: (pgRow.raw as Record<string, unknown>).forwardPrint,
        status: (pgRow.raw as Record<string, unknown>).status,
      } : null,
      phase2DirtyAt: pgRow?.phase2_dirty_at?.toISOString() ?? null,
    },
    sheet: {
      exists: !!sheetOrder,
      data: sheetOrder,
      error: sheetError,
    },
    validation: {
      postgresFlat: evalValidation(pgRow as never),
      sheet: evalValidation(sheetOrder as never),
    },
    hint: pgRow?.phase2_dirty_at
      ? '⚠️ phase2_dirty_at is set — Postgres has unsynced edits, Sheet may be stale. promote-draft uses Sheet (loadAllFresh) — if Sheet validation fails but Postgres passes, this is a Phase 2 stale-read issue.'
      : 'Compare validation.postgresFlat vs validation.sheet — same missing[] means data consistent; different means stale or schema mismatch.',
  });
}
