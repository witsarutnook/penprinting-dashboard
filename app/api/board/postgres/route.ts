import { NextResponse } from 'next/server';
import { sql, isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';

export const maxDuration = 30;

/**
 * Bench-only endpoint — returns all jobs from Postgres mirror table.
 * Same shape as `/api/board/sheet` so the bench harness can compare
 * apples to apples: payload + serialise + network.
 *
 * Reads the JSONB `raw` column to reconstruct the exact Sheet job shape
 * (instead of recomposing from explicit columns). This matches what
 * a real migration would do for backwards-compat with v2 client code
 * that already knows the Sheet-shaped Job type.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;

  if (!isPostgresConfigured()) {
    return NextResponse.json(
      { error: 'POSTGRES_URL env var missing' },
      { status: 500 },
    );
  }

  const t0 = performance.now();
  try {
    const { rows } = await sql<{ raw: Record<string, unknown> }>`
      SELECT raw FROM jobs ORDER BY id
    `;
    const jobs = rows.map(r => r.raw);
    const ms = Math.round(performance.now() - t0);
    return NextResponse.json({
      jobs,
      count: jobs.length,
      sourceMs: ms,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
