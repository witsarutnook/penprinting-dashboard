import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Seed (or re-seed upward) the Postgres `counters.nextId` job-id counter —
 * admin only. Run RIGHT BEFORE flipping ALLOCATE_IDS_IN_POSTGRES, ideally in
 * a low-traffic window. See migration-plan-id-allocation.md §7 Step 0.
 *
 * The computed seed = max job id ever observed across jobs ∪ shipped ∪
 * cancelled ∪ audit_log (audit_log catches admin-hard-deleted jobs that left
 * no row), + 1.
 *
 * Safe to run repeatedly: the upsert is GREATEST(...) — the counter only ever
 * rises, never falls. So an in-flight Apps Script mint between this call and
 * the flag flip can be absorbed by simply re-running this endpoint.
 *
 * ⚠️ The Apps Script `config.nextId` (Google Sheet) is the current authority.
 * Compare the returned `nextIdCounter` against it. If the Sheet value is
 * HIGHER, re-run with `?min=<sheet config.nextId>` so the counter is lifted
 * to the Sheet's value (the Sheet value is already "next free", used as-is —
 * no +1). Minting from a too-low counter would collide with existing ids.
 *
 * Does NOT seed orderCounter_* — mintOrderId() self-seeds via its
 * orders-table cross-check (orders are never deleted, so MAX is reliable).
 */
export async function GET(req: Request) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing' },
      { status: 500 },
    );
  }

  const minParam = Number(new URL(req.url).searchParams.get('min') || 0);

  try {
    // Highest job id ever observed. audit_log.target_id is bounded to the
    // job-id range (< 1e8) to exclude 9-digit order ids.
    const maxR = await sql<{
      jobs: string; shipped: string; cancelled: string; audit: string;
    }>`
      SELECT
        COALESCE((SELECT MAX(id) FROM jobs), 0)::text                          AS jobs,
        COALESCE((SELECT MAX(id) FROM shipped), 0)::text                       AS shipped,
        COALESCE((SELECT MAX(id) FROM cancelled), 0)::text                     AS cancelled,
        COALESCE((SELECT MAX(target_id) FROM audit_log
                   WHERE target_id BETWEEN 1 AND 99999999), 0)::text           AS audit
    `;
    const m = maxR.rows[0] ?? { jobs: '0', shipped: '0', cancelled: '0', audit: '0' };
    const maxObserved = {
      jobs: Number(m.jobs),
      shipped: Number(m.shipped),
      cancelled: Number(m.cancelled),
      audit: Number(m.audit),
    };
    const computedSeed = Math.max(
      100,
      maxObserved.jobs,
      maxObserved.shipped,
      maxObserved.cancelled,
      maxObserved.audit,
    ) + 1;
    // `?min` (the Sheet's config.nextId, if higher) is already "next free" —
    // used as-is, not +1. The computed seed (from MAX) needs the +1.
    const seed = Math.max(computedSeed, Number.isFinite(minParam) ? minParam : 0);

    const r = await sql<{ value: string }>`
      INSERT INTO counters (key, value) VALUES ('nextId', ${seed})
      ON CONFLICT (key) DO UPDATE SET value = GREATEST(counters.value, ${seed})
      RETURNING value::text
    `;

    return NextResponse.json({
      ok: true,
      nextIdCounter: Number(r.rows[0]?.value ?? seed),
      computedSeed,
      minApplied: minParam || undefined,
      maxObserved,
      hint:
        'เทียบ nextIdCounter กับ config.nextId ใน Google Sheet — ' +
        'ถ้า Sheet สูงกว่า ให้รันซ้ำด้วย ?min=<ค่า config.nextId> ก่อนเปิด flag',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
