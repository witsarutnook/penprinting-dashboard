// lib/ai-quote/log-export.ts
// ONE-SHOT read-only export of customer AI-quote sessions for the น้อง PP eval
// case set (2026-10-24). Pulled once by an admin in the browser, then the
// route + this file + its test are retired (PATTERNS §2.5). Identity columns
// (line_user_id, customer_name, customer_contact) are never selected, and
// every free-text field passes through redactContact so phone numbers, emails,
// LINE ids and account numbers typed into the chat never reach the repo.
import 'server-only';
import { sql } from '@/lib/postgres';
import type { ConversationTurn } from './types';

export interface ExportedTurn { role: 'user' | 'assistant'; text: string; ts?: string }
export interface ExportedQuote { productType: string; spec: Record<string, unknown>; unitPrice: number; createdAt: string }
export interface ExportedFlag { turnIndex: number; note: string | null }
export interface ExportedSession {
  id: number;
  channel: string;
  leadStatus: string;
  createdAt: string;
  updatedAt: string;
  turns: ExportedTurn[];
  quotes: ExportedQuote[];
  flags: ExportedFlag[];
}

const LINE_ID = /\bU[0-9a-f]{32}\b/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Thai mobile/landline: "0" or "+66" prefix, 9-10 digits, optional space/dash
// separators. Lookarounds keep it out of longer digit runs (order ids, prices).
const PHONE = /(?<![\d,.])(?:\+66[\s-]?|0)\d(?:[\s-]?\d){7,8}(?![\d,.])/g;
// Anything 10+ digits long with optional separators that is not a phone.
const ACCOUNT = /(?<![\d,.])\d(?:[\s-]?\d){9,}(?![\d,.])/g;

/** Mask contact details in free text. Prices ("1,500 บาท"), quantities and
 *  9-digit order ids (never start with 0) are untouched. */
export function redactContact(text: string): string {
  return text
    .replace(LINE_ID, '[line-id]')
    .replace(EMAIL, '[อีเมล]')
    .replace(PHONE, '[โทร]')
    .replace(ACCOUNT, '[เลขบัญชี]');
}

export type ExportChannel = 'line' | 'messenger';

/** ?channel= → customer channels to export. Absent / "customer" = both.
 *  "dashboard" (staff prompt) is a different flow and is refused. */
export function parseExportChannel(raw: string | null): { ok: true; channels: ExportChannel[] } | { ok: false } {
  if (raw === null || raw === 'customer') return { ok: true, channels: ['line', 'messenger'] };
  if (raw === 'line' || raw === 'messenger') return { ok: true, channels: [raw] };
  return { ok: false };
}

export async function loadQuoteLogExport(channels: ExportChannel[]): Promise<ExportedSession[]> {
  const { rows: ss } = await sql`
    SELECT id, channel, lead_status, conversation, created_at, updated_at
    FROM ai_quote_sessions
    WHERE channel = ANY(${channels as unknown as string}::text[])
    ORDER BY id ASC`;
  if (ss.length === 0) return [];
  const ids = ss.map((r) => Number(r.id));
  const [{ rows: qs }, { rows: fs }] = await Promise.all([
    sql`
      SELECT session_id, product_type, spec, unit_price, created_at FROM ai_quotes
      WHERE session_id = ANY(${ids as unknown as string}::int[]) ORDER BY created_at ASC`,
    sql`
      SELECT session_id, turn_index, note FROM ai_quote_turn_flags
      WHERE session_id = ANY(${ids as unknown as string}::int[]) ORDER BY turn_index ASC`,
  ]);
  const quotesBy = new Map<number, ExportedQuote[]>();
  for (const r of qs) {
    const sid = Number(r.session_id);
    const list = quotesBy.get(sid) ?? [];
    list.push({
      productType: String(r.product_type),
      spec: (r.spec as Record<string, unknown>) ?? {},
      unitPrice: Number(r.unit_price),
      createdAt: String(r.created_at),
    });
    quotesBy.set(sid, list);
  }
  const flagsBy = new Map<number, ExportedFlag[]>();
  for (const r of fs) {
    const sid = Number(r.session_id);
    const list = flagsBy.get(sid) ?? [];
    list.push({ turnIndex: Number(r.turn_index), note: r.note == null ? null : redactContact(String(r.note)) });
    flagsBy.set(sid, list);
  }
  return ss.map((s) => {
    const id = Number(s.id);
    const conv = ((s.conversation as ConversationTurn[] | null) ?? []);
    return {
      id,
      channel: String(s.channel),
      leadStatus: String(s.lead_status ?? 'ใหม่'),
      createdAt: String(s.created_at),
      updatedAt: String(s.updated_at),
      turns: conv.map((t) => ({ role: t.role, text: redactContact(String(t.text ?? '')), ts: t.ts })),
      quotes: quotesBy.get(id) ?? [],
      flags: flagsBy.get(id) ?? [],
    };
  });
}
