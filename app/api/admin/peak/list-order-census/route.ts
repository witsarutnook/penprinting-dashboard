import 'server-only';
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { createPeakClient } from '@/lib/peak/mcp-client';
import { createPeakReader } from '@/lib/peak/read';
import { peakErrorLabel } from '@/lib/peak/error-label';
import { bangkokTodayISO } from '@/lib/jobs';
import { addDaysISO } from '@/lib/peak-order/mapper';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PAGE_SIZE = 50; // same as lib/peak/read.ts
const MAX_PAGES = 10;
const TOP = 15;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v).sort() : []);

/**
 * TEMPORARY read-only census (PATTERNS §2.5, census variant) — delete this route
 * and tests/peak-list-order-census.test.ts once the "5 ใบล่าสุด" ordering fix is
 * verified on production.
 *
 * Question it answers (prod 2026-11-17): `newestQuotations` takes the tail of
 * Peak's `list_quotation` and calls it newest, but the admin "ทดสอบ" answered
 * QO-…110 while QO-…111–118 already existed. Where do the highest codes sit in
 * the order Peak actually sends, and does a quotation carry a field that says
 * when it was last touched?
 *
 * GET only, admin only, no params, reads Peak only. Returns document codes,
 * issue dates and field NAMES; the only values are those of date/status-like
 * fields of one quotation. Customer names, amounts and line text are not returned.
 */
export async function GET() {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;

  const t0 = Date.now();
  try {
    const client = createPeakClient();
    const reader = createPeakReader(client);
    const dateStart = addDaysISO(bangkokTodayISO(), -30);

    const first = await reader.listQuotations({ dateStart, page: 1 });
    const pages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
    const pagesRead = Math.min(pages, MAX_PAGES);

    const flat: Array<{ code: string; issuedDate: string; i: number; page: number }> = [];
    const wire: Array<{ page: number; rows: string[] }> = [];
    for (let p = 1; p <= pagesRead; p++) {
      const rows = p === 1 ? first.rows : (await reader.listQuotations({ dateStart, page: p })).rows;
      wire.push({ page: p, rows: rows.map((r) => `${r.code} ${r.issuedDate}`) });
      for (const r of rows) flat.push({ code: r.code, issuedDate: r.issuedDate, i: flat.length, page: p });
    }

    const topByCode = flat
      .slice()
      .sort((a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0))
      .slice(0, TOP);
    const tailNewestFirst = flat
      .slice(-5)
      .reverse()
      .map((r) => r.code);
    let dateInversions = 0;
    for (let i = 1; i < flat.length; i++) if (flat[i].issuedDate < flat[i - 1].issuedDate) dateInversions++;

    // Field names of the raw payloads — best effort, never fails the census.
    let listEnvelopeKeys: string[] = [];
    let listRowKeys: string[] = [];
    let quotationKeys: string[] = [];
    const quotationDateLike: Record<string, string | number | boolean> = {};
    try {
      const raw = await client.call('list_quotation', { dateStart: dateStart.replaceAll('-', ''), limit: 1, page: 1 });
      const body = isObj(raw) ? raw.PeakQuotations : undefined;
      listEnvelopeKeys = keysOf(body);
      const list = isObj(body) && Array.isArray(body.quotations) ? body.quotations : [];
      listRowKeys = keysOf(list[0]);
    } catch {
      // keep the empty lists
    }
    try {
      const code = topByCode[0]?.code;
      if (code) {
        const raw = await client.call('get_quotation', { code });
        const body = isObj(raw) ? raw.PeakQuotations : undefined;
        const list = isObj(body) && Array.isArray(body.quotations) ? body.quotations : [];
        const q = list.find(isObj);
        quotationKeys = keysOf(q);
        for (const k of quotationKeys) {
          const v = (q as Obj)[k];
          if (!/date|time|updat|modif|creat|status|approv|accept/i.test(k)) continue;
          if (typeof v === 'string') quotationDateLike[k] = v.slice(0, 40);
          else if (typeof v === 'number' || typeof v === 'boolean') quotationDateLike[k] = v;
        }
      }
    } catch {
      // keep what we have
    }

    return NextResponse.json({
      ok: true,
      dateStart,
      total: first.total,
      pageSize: PAGE_SIZE,
      pages,
      pagesRead,
      topByCode,
      tailNewestFirst,
      dateInversions,
      listEnvelopeKeys,
      listRowKeys,
      quotationKeys,
      quotationDateLike,
      wire,
      ms: Date.now() - t0,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: peakErrorLabel(err) });
  }
}
