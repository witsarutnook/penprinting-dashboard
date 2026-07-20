# Quote Logs Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** หน้า `/quote-logs` (admin) ดูบทสนทนาลูกค้า↔AI ย้อนหลังทุกช่องทาง + tag ข้อความที่ AI ตอบผิด + per-turn timestamp — spec: [2026-07-20-quote-logs-viewer-design.md](../specs/2026-07-20-quote-logs-viewer-design.md)

**Architecture:** additive ทั้งหมด — `ts?` ใน ConversationTurn stamp ผ่าน helper `mkTurn` จุดสร้าง turn 4 ที่ · ตารางใหม่ `ai_quote_turn_flags` (snapshot กัน index drift) · data layer ใหม่ `lib/ai-quote/logs.ts` (single-query aggregate, NULL-param pattern เดียวกับ slip-metrics) · pages server-component + URL filter state (pattern /board) · client component เฉพาะปุ่ม flag

**Tech Stack:** Next.js 15 App Router (searchParams เป็น Promise — ต้อง await) · vitest + mock-postgres (pin SQL shape) · TDD ทุก layer ที่มี logic

**สำคัญ:** ทุก commit ผ่าน gates: `npm run type-check` / `npx vitest run` / `npm run build` — push ครั้งเดียวตอนจบ Task 5

---

### Task 1: Per-turn timestamp — `mkTurn` helper + stamp 4 จุด

**Files:**
- Modify: `lib/ai-quote/types.ts:38-41` (ConversationTurn)
- Modify: `lib/ai-quote/run.ts` (helper + sanitizeHistory + newHistory)
- Modify: `lib/ai-quote/webhook-router.ts` (3 จุด canned-turn)
- Test: `tests/ai-quote-run.test.ts` (มีอยู่แล้ว — เพิ่ม describe)

- [ ] **Step 1: เขียน tests (RED)** — เพิ่มท้าย `tests/ai-quote-run.test.ts`:

```ts
describe('per-turn timestamp (quote-logs spec 2026-07-20)', () => {
  it('mkTurn stamps role/text/ts (ISO parseable)', () => {
    const t = mkTurn('assistant', 'สวัสดีค่ะ');
    expect(t.role).toBe('assistant');
    expect(t.text).toBe('สวัสดีค่ะ');
    expect(typeof t.ts).toBe('string');
    expect(Number.isNaN(Date.parse(t.ts!))).toBe(false);
  });
  it('sanitizeHistory preserves a valid ts', () => {
    const out = sanitizeHistory([{ role: 'user', text: 'hi', ts: '2026-07-20T10:00:00.000Z' }]);
    expect(out[0].ts).toBe('2026-07-20T10:00:00.000Z');
  });
  it('sanitizeHistory drops an invalid ts but keeps the turn', () => {
    const out = sanitizeHistory([{ role: 'user', text: 'hi', ts: 'not-a-date' }]);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBeUndefined();
  });
});
```

เพิ่ม `mkTurn` ใน import บนสุดของไฟล์ test (จาก `@/lib/ai-quote/run`)

- [ ] **Step 2: รัน test ต้อง RED** — `npx vitest run tests/ai-quote-run.test.ts` → fail (mkTurn is not exported)

- [ ] **Step 3: Implement**

`lib/ai-quote/types.ts` — ConversationTurn:

```ts
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  /** ISO time the turn was created (quote-logs 2026-07-20). Optional —
   *  turns persisted before the feature have none; UI shows order only. */
  ts?: string;
}
```

`lib/ai-quote/run.ts` — helper (วางหลัง `shouldPersistTurn`):

```ts
/** Construct a turn stamped with creation time. Every persist path uses this
 *  so /quote-logs can show per-message times. NOT sent to the model —
 *  toMessages() maps role+text only. */
export function mkTurn(role: 'user' | 'assistant', text: string): ConversationTurn {
  return { role, text, ts: new Date().toISOString() };
}
```

`sanitizeHistory` — แก้ loop body ให้ preserve ts:

```ts
    const { role, text, ts } = t as { role?: unknown; text?: unknown; ts?: unknown };
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || !text.trim()) continue;
    const turn: ConversationTurn = { role, text: text.slice(0, maxLen) };
    if (typeof ts === 'string' && !Number.isNaN(Date.parse(ts))) turn.ts = ts;
    turns.push(turn);
```

`runQuoteTurn` — newHistory (line ~136):

```ts
  const newHistory: ConversationTurn[] = [
    ...input.history,
    mkTurn('user', input.userMessage),
    mkTurn('assistant', reply),
  ];
```

`lib/ai-quote/webhook-router.ts` — เพิ่ม `mkTurn` ใน import จาก `./run` แล้วแก้ 3 จุด:

```ts
// ① human (~line 322):
    await escalate('human',
      [...conversation, mkTurn('user', text), mkTurn('assistant', CUSTOMER_REPLY.human)],
      CUSTOMER_REPLY.human);
// ④ order_intent (~line 329):
    await escalate('order_intent',
      [...conversation, mkTurn('user', text), mkTurn('assistant', CUSTOMER_REPLY.order_intent)],
      CUSTOMER_REPLY.order_intent);
// ③ rounds (~line 358):
    const conv: ConversationTurn[] = [...out.newHistory.slice(0, -1), mkTurn('assistant', CUSTOMER_REPLY.rounds)];
```

- [ ] **Step 4: GREEN + no regression** — `npx vitest run` → ทุก suite ผ่าน (472+ · webhook-router tests เดิมต้องไม่แตก — ถ้า test เดิม pin turn shape เป๊ะๆ `{role, text}` ให้ปรับ expectation รับ field ts เพิ่ม โดยคง assertion เดิม)

- [ ] **Step 5: อัปเดต spec 1a ให้ตรงความจริง** — dashboard session-backed turns **ได้ ts ด้วย** (route ใช้ `out.newHistory` จาก runQuoteTurn เดียวกัน — [app/api/ai-quote/route.ts:75](../../app/api/ai-quote/route.ts)); เฉพาะ pre-session turns ที่ client สร้างเองไม่มี ts. แก้บรรทัด "dashboard: ไม่ stamp ts" ใน spec เป็นข้อความนี้

- [ ] **Step 6: Commit**

```bash
git add lib/ai-quote/types.ts lib/ai-quote/run.ts lib/ai-quote/webhook-router.ts tests/ai-quote-run.test.ts docs/superpowers/specs/2026-07-20-quote-logs-viewer-design.md
git commit -m "feat(quote-logs): per-turn timestamp — mkTurn helper stamps all persist paths"
```

---

### Task 2: DB — ตาราง flags + data layer `lib/ai-quote/logs.ts`

**Files:**
- Modify: `app/api/admin/db-migrate/route.ts` (หลัง block ai_quotes ~line 390)
- Create: `lib/ai-quote/logs.ts`
- Test: `tests/ai-quote-logs.test.ts` (ใหม่ — ใช้ mock-postgres helpers เหมือน tests/ai-quote-db-line.test.ts)

- [ ] **Step 1: Migration** — เพิ่มใน db-migrate route (idempotent):

```ts
    await sql`
      CREATE TABLE IF NOT EXISTS ai_quote_turn_flags (
        id            SERIAL PRIMARY KEY,
        session_id    INTEGER NOT NULL REFERENCES ai_quote_sessions(id) ON DELETE CASCADE,
        turn_index    INTEGER NOT NULL,
        turn_role     TEXT NOT NULL,
        turn_text     TEXT NOT NULL,
        note          TEXT,
        flagged_by    TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(session_id, turn_index)
      )`;
    applied.push('ai_quote_turn_flags table');
    await sql`CREATE INDEX IF NOT EXISTS idx_turn_flags_session ON ai_quote_turn_flags(session_id)`;
    applied.push('idx_turn_flags_session');
```

- [ ] **Step 2: เขียน tests (RED)** — `tests/ai-quote-logs.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining, sqlCalls } from './helpers/mock-postgres';
vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));
import { loadQuoteLogSessions, flagTurn, unflagTurn, mergeTimeline } from '@/lib/ai-quote/logs';

describe('loadQuoteLogSessions', () => {
  beforeEach(() => resetMockPostgres());
  it("channel='customer' binds ['line','messenger'] array param", async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({ channel: 'customer' });
    expect(sqlCalls[0].values.some((v) => Array.isArray(v) && v.includes('line') && v.includes('messenger'))).toBe(true);
  });
  it('q filter uses parameterized ILIKE (no string concat)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({ q: 'รัฐกุล' });
    expect(sqlCalls[0].text).toContain('ILIKE');
    expect(sqlCalls[0].values).toContain('%รัฐกุล%');
  });
  it('aggregates counts in the single query (no N+1)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadQuoteLogSessions({});
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0].text).toContain('jsonb_array_length');
  });
});

describe('flagTurn', () => {
  beforeEach(() => resetMockPostgres());
  const conv = [
    { role: 'user', text: 'ขอราคาหนังสือ' },
    { role: 'assistant', text: 'เล่มละ 29.50 บาทค่ะ' },
  ];
  it('snapshots role+text from DB conversation (not caller input)', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });   // load session
    queueResult({ rows: [{ id: 1 }], rowCount: 1 });                // insert
    const r = await flagTurn(7, 1, 'ราคาผิด', 'นุ๊ก');
    expect(r).toBe('ok');
    const ins = findCallContaining('INSERT INTO ai_quote_turn_flags');
    expect(ins.values).toContain('เล่มละ 29.50 บาทค่ะ');
    expect(ins.values).toContain('assistant');
  });
  it('rejects a user-turn index', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    expect(await flagTurn(7, 0, null, 'นุ๊ก')).toBe('not-assistant');
  });
  it('rejects out-of-range index', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    expect(await flagTurn(7, 5, null, 'นุ๊ก')).toBe('not-assistant');
  });
  it('missing session → not-found', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await flagTurn(99, 1, null, 'นุ๊ก')).toBe('not-found');
  });
  it('duplicate (ON CONFLICT DO NOTHING rowCount 0) → duplicate', async () => {
    queueResult({ rows: [{ conversation: conv }], rowCount: 1 });
    queueResult({ rows: [], rowCount: 0 });
    expect(await flagTurn(7, 1, null, 'นุ๊ก')).toBe('duplicate');
  });
});

describe('mergeTimeline', () => {
  const q = (iso: string) => ({ id: 1, productType: 'book', spec: {}, unitPrice: 29.5, createdAt: iso });
  it('interleaves a quote after the last turn with ts <= quote time', () => {
    const turns = [
      { role: 'user' as const, text: 'a', ts: '2026-07-20T10:00:00Z' },
      { role: 'assistant' as const, text: 'b', ts: '2026-07-20T10:00:05Z' },
      { role: 'user' as const, text: 'c', ts: '2026-07-20T10:01:00Z' },
    ];
    const items = mergeTimeline(turns, [q('2026-07-20T10:00:03Z')]);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'quote', 'turn', 'turn']);
  });
  it('no turn has ts → all quotes go to the end', () => {
    const turns = [{ role: 'user' as const, text: 'a' }, { role: 'assistant' as const, text: 'b' }];
    const items = mergeTimeline(turns, [q('2026-07-20T10:00:00Z')]);
    expect(items.map((i) => i.kind)).toEqual(['turn', 'turn', 'quote']);
  });
});
```

- [ ] **Step 3: RED** — `npx vitest run tests/ai-quote-logs.test.ts` → fail (module not found)

- [ ] **Step 4: Implement `lib/ai-quote/logs.ts`**

```ts
// lib/ai-quote/logs.ts — data layer ของ /quote-logs (read + flag write).
// อ่านอย่างเดียวต่อ conversation — ห้ามมี mutation ของ ai_quote_sessions ในไฟล์นี้.
import 'server-only';
import { sql } from '@/lib/postgres';
import type { ConversationTurn } from './types';

const PAGE_SIZE = 50;

export interface QuoteLogFilters {
  channel?: 'line' | 'messenger' | 'dashboard' | 'customer';
  q?: string;
  flaggedOnly?: boolean;
  status?: string;
  page?: number; // 1-based
}

export interface QuoteLogRow {
  id: number;
  channel: string;
  customerName: string | null;
  customerContact: string | null;
  leadStatus: string;
  turnCount: number;
  quoteCount: number;
  flagCount: number;
  updatedAt: string;
}

/** Single-query list + aggregates (NULL-param pattern เดียวกับ slip-metrics).
 *  คืน PAGE_SIZE รายการ + hasMore. */
export async function loadQuoteLogSessions(
  f: QuoteLogFilters,
): Promise<{ rows: QuoteLogRow[]; hasMore: boolean }> {
  const channels =
    f.channel === 'customer' ? ['line', 'messenger'] : f.channel ? [f.channel] : null;
  const q = f.q?.trim() ? `%${f.q.trim()}%` : null;
  const status = f.status?.trim() || null;
  const flaggedOnly = f.flaggedOnly === true;
  const offset = (Math.max(1, f.page ?? 1) - 1) * PAGE_SIZE;
  const { rows } = await sql`
    SELECT s.id, s.channel, s.customer_name, s.customer_contact, s.lead_status,
           jsonb_array_length(s.conversation) AS turn_count,
           (SELECT COUNT(*) FROM ai_quotes aq WHERE aq.session_id = s.id) AS quote_count,
           (SELECT COUNT(*) FROM ai_quote_turn_flags fl WHERE fl.session_id = s.id) AS flag_count,
           s.updated_at
    FROM ai_quote_sessions s
    WHERE (${channels}::text[] IS NULL OR s.channel = ANY(${channels}))
      AND (${q}::text IS NULL OR s.customer_name ILIKE ${q} OR s.customer_contact ILIKE ${q})
      AND (${flaggedOnly} = false OR EXISTS (SELECT 1 FROM ai_quote_turn_flags fx WHERE fx.session_id = s.id))
      AND (${status}::text IS NULL OR s.lead_status = ${status})
    ORDER BY s.updated_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  const page = rows.slice(0, PAGE_SIZE).map((r) => ({
    id: Number(r.id),
    channel: String(r.channel),
    customerName: (r.customer_name as string | null) ?? null,
    customerContact: (r.customer_contact as string | null) ?? null,
    leadStatus: String(r.lead_status ?? 'ใหม่'),
    turnCount: Number(r.turn_count ?? 0),
    quoteCount: Number(r.quote_count ?? 0),
    flagCount: Number(r.flag_count ?? 0),
    updatedAt: String(r.updated_at),
  }));
  return { rows: page, hasMore: rows.length > PAGE_SIZE };
}

export interface QuoteLogQuote {
  id: number;
  productType: string;
  spec: Record<string, unknown>;
  unitPrice: number;
  createdAt: string;
}

export interface TurnFlag {
  id: number;
  sessionId: number;
  turnIndex: number;
  turnRole: string;
  turnText: string;
  note: string | null;
  flaggedBy: string;
  createdAt: string;
}

export interface QuoteLogDetail {
  id: number;
  channel: string;
  customerName: string | null;
  customerContact: string | null;
  leadStatus: string;
  conversation: ConversationTurn[];
  quotes: QuoteLogQuote[];
  flags: TurnFlag[];
  createdAt: string;
  updatedAt: string;
}

export async function loadQuoteLogDetail(id: number): Promise<QuoteLogDetail | null> {
  const { rows } = await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  if (rows.length === 0) return null;
  const s = rows[0];
  const { rows: qs } = await sql`
    SELECT id, product_type, spec, unit_price, created_at FROM ai_quotes
    WHERE session_id = ${id} ORDER BY created_at ASC`;
  const { rows: fs } = await sql`
    SELECT * FROM ai_quote_turn_flags WHERE session_id = ${id} ORDER BY turn_index ASC`;
  return {
    id: Number(s.id),
    channel: String(s.channel),
    customerName: (s.customer_name as string | null) ?? null,
    customerContact: (s.customer_contact as string | null) ?? null,
    leadStatus: String(s.lead_status ?? 'ใหม่'),
    conversation: (s.conversation as ConversationTurn[]) ?? [],
    quotes: qs.map((r) => ({
      id: Number(r.id),
      productType: String(r.product_type),
      spec: (r.spec as Record<string, unknown>) ?? {},
      unitPrice: Number(r.unit_price),
      createdAt: String(r.created_at),
    })),
    flags: fs.map(rowToFlag),
    createdAt: String(s.created_at),
    updatedAt: String(s.updated_at),
  };
}

function rowToFlag(r: Record<string, unknown>): TurnFlag {
  return {
    id: Number(r.id),
    sessionId: Number(r.session_id),
    turnIndex: Number(r.turn_index),
    turnRole: String(r.turn_role),
    turnText: String(r.turn_text),
    note: (r.note as string | null) ?? null,
    flaggedBy: String(r.flagged_by),
    createdAt: String(r.created_at),
  };
}

/** Worklist view — flags ทุก session เรียงใหม่→เก่า พร้อม customer context. */
export async function loadAllFlags(page = 1): Promise<{ rows: (TurnFlag & { channel: string; customerName: string | null })[]; hasMore: boolean }> {
  const offset = (Math.max(1, page) - 1) * PAGE_SIZE;
  const { rows } = await sql`
    SELECT fl.*, s.channel, s.customer_name
    FROM ai_quote_turn_flags fl
    JOIN ai_quote_sessions s ON s.id = fl.session_id
    ORDER BY fl.created_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`;
  return {
    rows: rows.slice(0, PAGE_SIZE).map((r) => ({
      ...rowToFlag(r),
      channel: String(r.channel),
      customerName: (r.customer_name as string | null) ?? null,
    })),
    hasMore: rows.length > PAGE_SIZE,
  };
}

/** Tag ข้อความ AI ว่าตอบผิด. Snapshot role+text จาก DB ฝั่ง server (ไม่รับจาก
 *  client — กัน mismatch). ON CONFLICT DO NOTHING → 'duplicate'. */
export async function flagTurn(
  sessionId: number,
  turnIndex: number,
  note: string | null,
  flaggedBy: string,
): Promise<'ok' | 'not-found' | 'not-assistant' | 'duplicate'> {
  const { rows } = await sql`SELECT conversation FROM ai_quote_sessions WHERE id = ${sessionId}`;
  if (rows.length === 0) return 'not-found';
  const conv = (rows[0].conversation as ConversationTurn[]) ?? [];
  const turn = conv[turnIndex];
  if (!turn || turn.role !== 'assistant') return 'not-assistant';
  const { rowCount } = await sql`
    INSERT INTO ai_quote_turn_flags (session_id, turn_index, turn_role, turn_text, note, flagged_by)
    VALUES (${sessionId}, ${turnIndex}, ${turn.role}, ${turn.text.slice(0, 1000)}, ${note}, ${flaggedBy})
    ON CONFLICT (session_id, turn_index) DO NOTHING`;
  return rowCount === 0 ? 'duplicate' : 'ok';
}

export async function unflagTurn(sessionId: number, turnIndex: number): Promise<boolean> {
  const { rowCount } = await sql`
    DELETE FROM ai_quote_turn_flags WHERE session_id = ${sessionId} AND turn_index = ${turnIndex}`;
  return rowCount > 0;
}

// ── Timeline merge (pure — testable) ──────────────────────────────
export type TimelineItem =
  | { kind: 'turn'; index: number; turn: ConversationTurn }
  | { kind: 'quote'; quote: QuoteLogQuote };

/** แทรก quote cards ระหว่าง turns ตามเวลา: quote วางหลัง turn สุดท้ายที่
 *  ts <= quote.createdAt. Turn เก่าไม่มี ts เลย → quotes ทั้งหมดต่อท้าย. */
export function mergeTimeline(turns: ConversationTurn[], quotes: QuoteLogQuote[]): TimelineItem[] {
  const anyTs = turns.some((t) => t.ts);
  const items: TimelineItem[] = [];
  const remaining = [...quotes].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let lastTs: number | null = null;
  turns.forEach((turn, index) => {
    items.push({ kind: 'turn', index, turn });
    if (turn.ts) lastTs = Date.parse(turn.ts);
    if (!anyTs || lastTs === null) return;
    // quote เกิดก่อนหรือเท่ากับ ts ของ turn ถัดไป → วางตรงนี้
    const nextTs = nextTurnTs(turns, index);
    while (remaining.length > 0 && Date.parse(remaining[0].createdAt) >= 0
      && Date.parse(remaining[0].createdAt) <= (nextTs ?? Infinity)
      && Date.parse(remaining[0].createdAt) >= lastTs - 60_000) {
      if (nextTs !== null && Date.parse(remaining[0].createdAt) > nextTs) break;
      items.push({ kind: 'quote', quote: remaining.shift()! });
    }
  });
  for (const q of remaining) items.push({ kind: 'quote', quote: q });
  return items;
}

function nextTurnTs(turns: ConversationTurn[], from: number): number | null {
  for (let i = from + 1; i < turns.length; i++) {
    if (turns[i].ts) return Date.parse(turns[i].ts!);
  }
  return null;
}
```

⚠️ ถ้า `mergeTimeline` ข้างบนทำให้ test case แรกไม่ผ่านตามลำดับที่ pin — ปรับ implementation จน GREEN โดย**ห้ามแก้ expectation ใน test** (test คือ spec ของ placement)

- [ ] **Step 5: GREEN** — `npx vitest run tests/ai-quote-logs.test.ts` ผ่านหมด แล้ว `npx vitest run` ทั้ง suite

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/db-migrate/route.ts lib/ai-quote/logs.ts tests/ai-quote-logs.test.ts
git commit -m "feat(quote-logs): flags table migration + logs data layer (single-query list, snapshot flags, timeline merge)"
```

---

### Task 3: API — `POST/DELETE /api/ai-quote/flags`

**Files:**
- Create: `app/api/ai-quote/flags/route.ts`
- Test: เพิ่ม describe ใน `tests/ai-quote-logs.test.ts` ไม่ต้อง (route บาง logic อยู่ใน flagTurn แล้ว) — route validation ทดสอบผ่าน manual smoke (pattern เดียวกับ leads route ที่ไม่มี route-level test)

- [ ] **Step 1: Implement**

```ts
// app/api/ai-quote/flags/route.ts — tag/untag ข้อความ AI ว่าตอบผิด (admin)
import { NextResponse, type NextRequest } from 'next/server';
import { requireSession } from '@/lib/route-helpers';
import { flagTurn, unflagTurn } from '@/lib/ai-quote/logs';
import { appendAuditToPostgres } from '@/lib/postgres-write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseIds(body: Record<string, unknown>): { sessionId: number; turnIndex: number } | null {
  const sessionId = Number(body.sessionId);
  const turnIndex = Number(body.turnIndex);
  if (!Number.isInteger(sessionId) || sessionId <= 0) return null;
  if (!Number.isInteger(turnIndex) || turnIndex < 0) return null;
  return { sessionId, turnIndex };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = parseIds(body);
  if (!ids) return NextResponse.json({ error: 'sessionId/turnIndex ไม่ถูกต้อง' }, { status: 400 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) || null : null;

  const result = await flagTurn(ids.sessionId, ids.turnIndex, note, session.user);
  if (result === 'not-found') return NextResponse.json({ error: 'ไม่พบ session' }, { status: 404 });
  if (result === 'not-assistant') return NextResponse.json({ error: 'tag ได้เฉพาะข้อความ AI' }, { status: 422 });
  if (result === 'duplicate') return NextResponse.json({ error: 'ข้อความนี้ tag แล้ว' }, { status: 409 });

  await appendAuditToPostgres({
    action: 'flagAiTurn',
    role: session.role,
    user: session.user,
    targetId: ids.sessionId,
    summary: `🚩 tag AI ตอบผิด — session #${ids.sessionId} turn ${ids.turnIndex}${note ? ` (${note.slice(0, 80)})` : ''}`,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const session = await requireSession(['admin']);
  if (session instanceof NextResponse) return session;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = parseIds(body);
  if (!ids) return NextResponse.json({ error: 'sessionId/turnIndex ไม่ถูกต้อง' }, { status: 400 });

  const removed = await unflagTurn(ids.sessionId, ids.turnIndex);
  if (!removed) return NextResponse.json({ error: 'ไม่พบ tag' }, { status: 404 });

  await appendAuditToPostgres({
    action: 'unflagAiTurn',
    role: session.role,
    user: session.user,
    targetId: ids.sessionId,
    summary: `ลบ tag AI ตอบผิด — session #${ids.sessionId} turn ${ids.turnIndex}`,
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Gates + commit**

```bash
npm run type-check && npx vitest run
git add app/api/ai-quote/flags/route.ts
git commit -m "feat(quote-logs): flags API — POST/DELETE admin-gated + audit_log"
```

---

### Task 4: หน้า `/quote-logs` + `/quote-logs/[id]` + nav + middleware

**Files:**
- Create: `app/quote-logs/page.tsx` (list + view=flags)
- Create: `app/quote-logs/[id]/page.tsx` (transcript)
- Create: `app/quote-logs/[id]/flag-button.tsx` (client component)
- Modify: `components/nav-config.ts` (~line 62 — section 'AI Quote')
- Modify: `middleware.ts` (~line 37 — matcher)

- [ ] **Step 1: List page** — `app/quote-logs/page.tsx` (โครง auth ตาม [app/quote-leads/page.tsx](../../app/quote-leads/page.tsx) แต่ admin เท่านั้น; **Next 15: searchParams เป็น Promise ต้อง await**):

```tsx
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { loadQuoteLogSessions, loadAllFlags } from '@/lib/ai-quote/logs';

export const dynamic = 'force-dynamic';

const CHANNEL_LABEL: Record<string, string> = {
  line: 'LINE', messenger: 'Messenger', dashboard: 'ทีมงาน',
};

export default async function QuoteLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/board');
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const view = sp.view === 'flags' ? 'flags' : 'list';
  // ...render ตาม view (ดู Step 1a/1b)
}
```

- **Step 1a — view=list**: call `loadQuoteLogSessions({ channel: sp.channel as any, q: sp.q, flaggedOnly: sp.flagged === '1', status: sp.status, page })` → filter chips เป็น `<Link>` ที่ toggle query param (pattern /board) : ทั้งหมด · ลูกค้า (channel=customer) · LINE · Messenger · ทีมงาน · 🚩 เฉพาะที่ tag · escalated → ตารางคอลัมน์ตาม spec (id / ช่องทาง / ลูกค้า ("–" เมื่อ NULL, dashboard = "ทีมงาน") / lead_status badge / เทิร์น / quotes / 🚩 / updated_at โซน Bangkok) → แถวเป็น `<Link href={/quote-logs/${id}}>` → ปุ่ม "หน้าถัดไป" เมื่อ hasMore (`?page=N+1` คง filter เดิม)
- **Step 1b — view=flags**: call `loadAllFlags(page)` → ลิสต์การ์ด: ข้อความ snapshot (line-clamp) · โน้ต · flagged_by · เวลา · ช่องทาง+ลูกค้า · ลิงก์ `/quote-logs/${sessionId}#turn-${turnIndex}` — แท็บสลับ list/flags บนหัวหน้า

- [ ] **Step 2: Transcript page** — `app/quote-logs/[id]/page.tsx` (**Next 15: params เป็น Promise**):

```tsx
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { DashboardShell } from '@/components/dashboard-shell';
import { loadQuoteLogDetail, mergeTimeline } from '@/lib/ai-quote/logs';
import { FlagButton } from './flag-button';

export const dynamic = 'force-dynamic';

export default async function QuoteLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/board');
  const { id } = await params;
  const detail = await loadQuoteLogDetail(Number(id));
  if (!detail) notFound();

  const items = mergeTimeline(detail.conversation, detail.quotes);
  const flagByIndex = new Map(detail.flags.map((f) => [f.turnIndex, f]));
  // render: header + timeline + detached flags
}
```

Render กติกา:
- บับเบิล: `id={'turn-' + index}` · user = ซ้าย (พื้นเทา) · assistant = ขวา (พื้น accent อ่อน) · ใต้บับเบิล: เวลา (ถ้า `turn.ts`) format Bangkok
- **Flag anchor guard**: flag ผูกกับบับเบิลเมื่อ `flagByIndex.get(index)?.turnText === turn.text.slice(0, 1000)` — mismatch (index drift) → ไม่ผูก, ไปแสดงใน section "🚩 tags ที่ index ไม่ตรงแล้ว (ดูจาก snapshot)" ท้ายหน้า
- บับเบิล assistant: render `<FlagButton sessionId turnIndex flagged={...} note={...} />`
- quote card (kind=quote): 🧮 productType label + spec ย่อ (`JSON.stringify` compact/keys หลัก) + `unitPrice` — เมื่อไม่มี ts เลย mergeTimeline ต่อท้ายให้แล้ว ใส่หัวข้อ "การคำนวณราคา" ก่อน quote block ต่อเนื่องท้าย transcript
- conversation ว่าง → empty state "session นี้ไม่มีข้อความ (เข้าโหมดแล้วไม่ได้คุย)"
- Header: ช่องทาง · ลูกค้า · lead_status · เวลาเริ่ม/ล่าสุด · ลิงก์กลับ `/quote-logs` + ลิงก์ `/quote-leads` เมื่อ leadStatus ≠ 'ใหม่'

- [ ] **Step 3: FlagButton client component** — `app/quote-logs/[id]/flag-button.tsx`:

```tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function FlagButton({ sessionId, turnIndex, flagged, note }: {
  sessionId: number; turnIndex: number; flagged: boolean; note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = (method: 'POST' | 'DELETE') => start(async () => {
    const res = await fetch('/api/ai-quote/flags', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(method === 'POST' ? { sessionId, turnIndex, note: draft } : { sessionId, turnIndex }),
    });
    if (!res.ok) { alert((await res.json().catch(() => ({}))).error ?? 'ผิดพลาด'); return; }
    setOpen(false); setDraft('');
    router.refresh();
  });
  // render: flagged ? (🚩 + note + ปุ่มลบ) : (ปุ่ม 🚩 เล็กจางๆ → เปิด popover textarea + ยืนยัน)
}
```

- [ ] **Step 4: nav + middleware**

`components/nav-config.ts` — ต่อจากรายการ `/quote-leads` (line ~62):

```ts
      { href: '/quote-logs', label: 'AI Logs', icon: IconMessageSquare, adminOnly: true },
```

(ถ้าไม่มี `IconMessageSquare` ใน [lib/icons.tsx](../../lib/icons.tsx) → ใช้ icon ที่มีอยู่ที่สื่อความ chat/log ได้ หรือเพิ่ม outline SVG ใหม่ตาม convention ไฟล์นั้น — **ห้าม emoji**)

`middleware.ts` matcher เพิ่ม:

```ts
    '/quote-logs/:path*',
```

- [ ] **Step 5: Gates + commit**

```bash
npm run type-check && npx vitest run && npm run build
git add app/quote-logs components/nav-config.ts middleware.ts
git commit -m "feat(quote-logs): admin log viewer — session list + transcript timeline + flag UI + nav"
```

---

### Task 5: ลิงก์ไขว้ /quote-leads + preview smoke + push

**Files:**
- Modify: `app/quote-leads/quote-leads-client.tsx` (หรือไฟล์ client ที่ render แถว lead — เช็คชื่อจริงด้วย `ls app/quote-leads/`)

- [ ] **Step 1: เพิ่มลิงก์ "ดูบทสนทนา"** ในแถว lead — **เฉพาะ `currentRole === 'admin'`** (sales เข้า /quote-logs ไม่ได้ ซ่อนปุ่มกัน redirect งง):

```tsx
{currentRole === 'admin' && (
  <Link href={`/quote-logs/${lead.id}`} className="text-xs text-ink-3 underline">
    ดูบทสนทนา
  </Link>
)}
```

(lead.id = ai_quote_sessions.id ตัวเดียวกัน — ยืนยัน field name จริงในไฟล์ก่อนแก้)

- [ ] **Step 2: Full gates**

```bash
npm run type-check && npm run lint && npx vitest run && npm run build
```

Expected: เขียวหมด (lint warning `slip.ts _r` = pre-existing ยอมรับได้)

- [ ] **Step 3: Preview smoke ในเบราว์เซอร์ (dev server + preview_start)**

1. `npm run dev` → login admin → `/quote-logs` เห็น session list จริงจาก DB dev/prod? (**local dev ชี้ DB จริง** — ระวัง: การ tag ใน local = เขียนตาราง prod ถ้า env ชี้ prod ➜ ใช้ session dashboard ทดสอบ แล้วลบ tag ทิ้ง)
2. เปิด transcript ของ session LINE จริง → บับเบิลเรียงถูก, quotes แสดง (session เก่าไม่มี ts → section ท้าย)
3. Tag ข้อความ AI 1 อัน + โน้ต → 🚩 ติด → refresh ยังอยู่ → `?view=flags` เห็น + ลิงก์ anchor กระโดดถูก → ลบ tag
4. Filter: `?channel=customer` เหลือ line+messenger · `?q=` ค้นชื่อ · `?flagged=1`
5. Logout → login role sales (ถ้ามี test password) → `/quote-logs` เด้ง `/board` · nav ไม่โชว์ "AI Logs"
6. `/quote-leads` (admin) → เห็นลิงก์ "ดูบทสนทนา" → คลิกแล้วถึง transcript

- [ ] **Step 4: Commit + push (ครั้งเดียว)**

```bash
git add app/quote-leads/
git commit -m "feat(quote-logs): cross-link ดูบทสนทนา from quote-leads rows (admin only)"
git push
```

- [ ] **Step 5: Post-deploy**

1. รอ Vercel deploy → dashboard smoke workflow เขียว (`gh run list --repo witsarutnook/penprinting-dashboard --limit 2`)
2. **แจ้งคุณนุ๊ก pending actions**: ① กด `https://dashboard.penprinting.co/api/admin/db-migrate` (สร้างตาราง `ai_quote_turn_flags`) — ก่อน migrate หน้า /quote-logs จะ 500 เพราะ query flags count ② เปิด `/quote-logs` ดู log จริง + ลอง tag 1 อัน

⚠️ **ลำดับ deploy note**: โค้ด query ตาราง flags จะพังจนกว่า migrate จะรัน — ถ้าต้องการ zero-window ให้คุณนุ๊กกด db-migrate ทันทีหลัง deploy Ready (ตาราง sessions/quotes มีอยู่แล้ว — เฉพาะหน้า /quote-logs ใหม่ที่รอ migrate, หน้าอื่นไม่กระทบ)
