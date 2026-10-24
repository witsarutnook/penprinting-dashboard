import { NextRequest, NextResponse } from 'next/server';
import { isPostgresConfigured } from '@/lib/postgres';
import { requireSession } from '@/lib/route-helpers';
import { loadQuoteLogExport, parseExportChannel } from '@/lib/ai-quote/log-export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ONE-SHOT (2026-10-24) — read-only export of customer AI-quote sessions for
 * the น้อง PP eval case set. Admin only. Retire after the pull (PATTERNS §2.5).
 *
 * GET /api/admin/quote-log-export[?channel=line|messenger|customer]
 *   → { exportedAt, count, sessions: [{ id, channel, leadStatus, createdAt,
 *        updatedAt, turns[], quotes[], flags[] }] }
 *   Identity columns are never selected; free text is contact-redacted
 *   (lib/ai-quote/log-export.ts). Default = both customer channels; the staff
 *   'dashboard' channel is a different prompt and is refused (400).
 */
export async function GET(request: NextRequest) {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const parsed = parseExportChannel(request.nextUrl.searchParams.get('channel'));
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid channel — use 'line', 'messenger' or 'customer'" }, { status: 400 });
  }
  if (!isPostgresConfigured()) {
    return NextResponse.json({ error: 'POSTGRES_URL env var missing' }, { status: 500 });
  }

  const sessions = await loadQuoteLogExport(parsed.channels);
  return NextResponse.json({ exportedAt: new Date().toISOString(), count: sessions.length, sessions });
}
