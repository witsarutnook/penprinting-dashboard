# AI Quote Phase 1b-B — LINE Customer Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปิด AI quote ใน LINE OA แชต 1-1 — ลูกค้า opt-in เข้า "โหมดขอราคา AI" → engine เดิม (Sonnet 5 + compute_quote) ตีราคาด้วย customer prompt → escalate 4 triggers ไปกลุ่มพนักงาน + /quote-leads

**Architecture:** ต่อยอด 1b-A webhook takeover — wire arms `ai`/`enter-ai`/`exit-ai` ที่ stub ไว้ใน `webhook-router.ts`. Mode state = ตารางใหม่ `ai_quote_line_modes` (1 row/LINE user, lazy 30-min expiry, ไม่มี cron; row เดียวกันถือ 24h hint gate). Conversation persist ใน `ai_quote_sessions` (`channel='line'` + `line_user_id` owner binding = M5) ตั้งแต่ turn แรก (ต่างจาก dashboard no-auto-save — LINE ไม่มี client เก็บ history + spec §6 ใช้ sessions เป็น metrics). Escalation ทุก trigger: set lead_status → push Flex เข้า `LINE_STAFF_GROUP_ID` → ตอบลูกค้า → ออกโหมด. ทุก side-effect ฉีดผ่าน `CustomerAiDeps` (nested ใน `HandleDeps`) → router ยัง pure-testable, flag OFF = 1b-A เป๊ะ.

**Tech Stack:** Next.js 15 App Router · @vercel/postgres · Anthropic SDK (Sonnet 5 + Haiku gate เดิม) · vitest (mock-postgres helper) · LINE Messaging API

**Spec:** [docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md](../specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md)

---

## Design decisions locked here (นอกเหนือจาก spec)

1. **DDL เบี่ยงจาก spec เล็กน้อย — จงใจ:** `entered_at`/`last_activity_at` เป็น **nullable** (spec เขียน NOT NULL) เพราะ row เดียวกันเก็บ `last_hint_at` ของ user ที่**ยังไม่เคย**เข้าโหมด (hint มาก่อน entry เสมอ) และ hint gate ต้องรอดข้าม mode exit. Mode-active predicate = `modeActive(last_activity_at, now)`. เพิ่มคอลัมน์ `rounds_no_quote INT` (นับ trigger ③).
2. **Hint gate เก็บใน DB ไม่ใช่ KV rate-limit:** `checkRateLimit` fail-open เมื่อ KV ล่ม → hint spam แทรกพนักงาน (ผิด D2 หนัก). DB คอลัมน์ fail-closed กว่า. Rate limit 30/ชม. ใช้ KV ได้ (fail-open ยอมรับได้ — engine call เพิ่มไม่อันตราย).
3. **Trigger detection แบ่งชั้น:** ① `detectHumanRequest` + ④ `detectOrderIntent` = pure keyword detector เช็ค**ก่อน**เรียก engine (ไม่เผา token) · ② `detectCustomerEscalation` = quoteCount 0 + วลี pin "ส่งต่อทีมงาน" (prompt สั่งใช้วลีนี้เป๊ะ — แคบกว่า staff heuristic เพราะ disclaimer ลูกค้ามีคำ "ทีมงาน" ทุกใบราคา) · ③ นับ `rounds_no_quote` ใน mode row, reset เมื่อได้ quote.
4. **Customer prompt = ไฟล์ใหม่ ยอม duplicate กติกา domain:** staff prompt มี test pin อยู่ — ไม่ refactor แชร์ fragment (เสี่ยง behavior drift). Import แชร์แค่ `VALID_PAPER_NAMES`.
5. **`ออกจากโหมด AI` ยังเป็น exit keyword · `คุยกับทีมงาน` ย้ายจาก exit → trigger ①** (in-mode = escalation Type A; นอกโหมด = ข้อความปกติ → hint path).
6. **`AI_QUOTE_LINE_ENABLED=true` แต่ env ไม่ครบ (QUOTE_API_URL/TOKEN หาย) → aiEnabled=false** — ปลอดภัยเท่า 1b-A. `LINE_STAFF_GROUP_ID` หาย → escalation ทำงานทุกอย่าง**ยกเว้น** push (console.error) — ไม่ block ลูกค้า.

## File map

| File | Action | Owns |
|---|---|---|
| `app/api/admin/db-migrate/route.ts` | modify | `ai_quote_line_modes` + `line_user_id` column |
| `lib/ai-quote/line-mode.ts` | **create** | mode state: pure predicates + DB fns |
| `lib/ai-quote/customer-triggers.ts` | **create** | trigger detectors + canned copy (pure) |
| `lib/ai-quote/prompt-customer.ts` | **create** | `buildCustomerSystemPrompt()` |
| `lib/ai-quote/escalation-flex.ts` | **create** | staff-group Flex builder (pure) |
| `lib/ai-quote/db.ts` + `types.ts` | modify | owner-check loadSession · createLineSession · countQuotes |
| `lib/ai-quote/channels/line.ts` | modify | `getLineProfile` (best-effort) |
| `lib/ai-quote/webhook-router.ts` | modify | entry/exit keywords + customer AI arms |
| `app/api/ai-quote/line/route.ts` | modify | wire `CustomerAiDeps` |
| `app/quote-leads/quote-leads-client.tsx` | modify | LINE channel badge |

Baseline: **294 tests** เขียว. คาดจบ ~345-350.

---

### Task 0: Branch setup

- [ ] **Step 0.1: สร้าง branch จาก main ล่าสุด**

```bash
cd "/Users/witsarut.p/Desktop/Project Report Penprinting/penprinting-dashboard"
git fetch origin && git checkout main && git pull --ff-only
git checkout -b feat/ai-quote-phase1b-b-line-customer
```

⚠️ ทุก commit ใน repo นี้ต้อง Node 22 ใน Bash call เดียวกัน: `source ~/.nvm/nvm.sh && nvm use 22 && git commit ...`

---

### Task 1: Migration — `ai_quote_line_modes` + `ai_quote_sessions.line_user_id`

**Files:**
- Modify: `app/api/admin/db-migrate/route.ts` (แทรกหลัง block `idx_orders_customer_norm` ~line 434)

- [ ] **Step 1.1: เพิ่ม DDL (idempotent)**

แทรกก่อนส่วน "Quick row counts":

```ts
    // ─── ai_quote_line_modes (Phase 1b-B — LINE customer AI-quote mode) ───
    // 1 row per LINE user. Mode fields are nullable — NULL last_activity_at
    // = not in mode; the same row carries the 24h out-of-mode hint gate
    // (last_hint_at), which must survive mode exits. Expiry is lazy (no
    // cron): modeActive() in lib/ai-quote/line-mode.ts checks the 30-min
    // idle window on the next inbound message.
    await sql`
      CREATE TABLE IF NOT EXISTS ai_quote_line_modes (
        channel_user_id  TEXT PRIMARY KEY,
        entered_at       TIMESTAMPTZ,
        last_activity_at TIMESTAMPTZ,
        session_id       INTEGER REFERENCES ai_quote_sessions(id) ON DELETE SET NULL,
        rounds_no_quote  INT NOT NULL DEFAULT 0,
        last_hint_at     TIMESTAMPTZ
      )`;
    applied.push('CREATE TABLE ai_quote_line_modes');

    // M5 owner binding: LINE-channel sessions store their webhook-verified
    // owner; loadSession({ lineUserId }) filters on it (mismatch → not found).
    await sql`ALTER TABLE ai_quote_sessions ADD COLUMN IF NOT EXISTS line_user_id TEXT`;
    applied.push('ai_quote_sessions.line_user_id column');
```

- [ ] **Step 1.2: เพิ่ม `'ai_quote_line_modes'`** ในลิสต์ตารางของ row-counts loop (~line 438)

- [ ] **Step 1.3: Gates + commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint
git add app/api/admin/db-migrate/route.ts
git commit -m "feat(db): ai_quote_line_modes table + ai_quote_sessions.line_user_id (1b-B)"
```

---

### Task 2: `lib/ai-quote/line-mode.ts` — mode state

**Files:**
- Create: `lib/ai-quote/line-mode.ts`
- Test: `tests/ai-quote-line-mode.test.ts`

- [ ] **Step 2.1: เขียน failing tests**

```ts
// tests/ai-quote-line-mode.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import {
  modeActive, hintAllowed, MODE_IDLE_MINUTES, HINT_GATE_HOURS,
  loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent,
} from '@/lib/ai-quote/line-mode';

const NOW = Date.parse('2026-07-06T10:00:00Z');
const min = (n: number) => n * 60_000;

describe('modeActive (lazy 30-min idle expiry — spec §1, no cron)', () => {
  it('true within the idle window', () => {
    expect(modeActive(new Date(NOW - min(29)).toISOString(), NOW)).toBe(true);
  });
  it('false once idle exceeds the window', () => {
    expect(modeActive(new Date(NOW - min(MODE_IDLE_MINUTES + 1)).toISOString(), NOW)).toBe(false);
  });
  it('false for null / unparsable timestamps (never throws)', () => {
    expect(modeActive(null, NOW)).toBe(false);
    expect(modeActive('not-a-date', NOW)).toBe(false);
  });
});

describe('hintAllowed (≤1 hint/user/24h — spec §2)', () => {
  it('true when never hinted', () => {
    expect(hintAllowed(null, NOW)).toBe(true);
  });
  it('false inside the 24h gate', () => {
    expect(hintAllowed(new Date(NOW - min(60)).toISOString(), NOW)).toBe(false);
  });
  it('true again after the gate lapses', () => {
    expect(hintAllowed(new Date(NOW - (HINT_GATE_HOURS + 1) * 3_600_000).toISOString(), NOW)).toBe(true);
  });
});

describe('mode DB fns (query shape pins)', () => {
  beforeEach(() => resetMockPostgres());

  it('loadLineMode maps snake_case row → LineModeRow', async () => {
    queueResult({ rows: [{ channel_user_id: 'U1', entered_at: 't1', last_activity_at: 't2', session_id: '7', rounds_no_quote: 2, last_hint_at: null }], rowCount: 1 });
    const r = await loadLineMode('U1');
    expect(r).toEqual({ channelUserId: 'U1', enteredAt: 't1', lastActivityAt: 't2', sessionId: 7, roundsNoQuote: 2, lastHintAt: null });
  });
  it('enterLineMode upserts and resets rounds but NOT last_hint_at', async () => {
    await enterLineMode('U1');
    const call = findCallContaining('ON CONFLICT (channel_user_id)');
    expect(call?.text).toContain('rounds_no_quote = 0');
    expect(call?.text).not.toContain('last_hint_at');
  });
  it('exitLineMode nulls mode fields but keeps last_hint_at', async () => {
    await exitLineMode('U1');
    const call = findCallContaining('entered_at = NULL');
    expect(call?.text).toContain('session_id = NULL');
    expect(call?.text).not.toContain('last_hint_at');
  });
  it('markHintSent upserts last_hint_at only', async () => {
    await markHintSent('U1');
    const call = findCallContaining('last_hint_at = NOW()');
    expect(call).toBeDefined();
    expect(call?.text).not.toContain('entered_at = NOW()');
  });
  it('touchLineMode COALESCEs optional fields', async () => {
    await touchLineMode('U1', { sessionId: 9 });
    const call = findCallContaining('last_activity_at = NOW()');
    expect(call?.text).toContain('COALESCE');
    expect(call?.values).toContain(9);
  });
});
```

- [ ] **Step 2.2: รันให้ fail**

```bash
npx vitest run tests/ai-quote-line-mode.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/ai-quote/line-mode'`

- [ ] **Step 2.3: Implement**

```ts
// lib/ai-quote/line-mode.ts
// Mode state for the LINE customer AI-quote flow (Phase 1b-B, spec §1-§2).
// One row per LINE user in ai_quote_line_modes. The same row carries both the
// active-mode fields (nullable — NULL = not in mode) and the 24h hint gate
// (last_hint_at survives mode exit so hints stay throttled across sessions).
// Expiry is lazy: nothing deletes rows on a timer — modeActive() checks the
// idle window when the next message arrives (no cron, spec D1).
import 'server-only';
import { sql } from '@/lib/postgres';

export const MODE_IDLE_MINUTES = 30;   // spec §1 — idle >30 min = mode expired
export const HINT_GATE_HOURS = 24;     // spec §2 — ≤1 hint/user/24h

export interface LineModeRow {
  channelUserId: string;
  enteredAt: string | null;
  lastActivityAt: string | null;
  sessionId: number | null;
  roundsNoQuote: number;
  lastHintAt: string | null;
}

/** Pure: is the mode still active given the last-activity timestamp? */
export function modeActive(lastActivityAt: string | null, nowMs: number): boolean {
  if (!lastActivityAt) return false;
  const t = Date.parse(lastActivityAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= MODE_IDLE_MINUTES * 60_000;
}

/** Pure: may we send the out-of-mode hint (≤1/user/24h)? */
export function hintAllowed(lastHintAt: string | null, nowMs: number): boolean {
  if (!lastHintAt) return true;
  const t = Date.parse(lastHintAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > HINT_GATE_HOURS * 3_600_000;
}

function rowToMode(r: Record<string, unknown>): LineModeRow {
  return {
    channelUserId: String(r.channel_user_id),
    enteredAt: r.entered_at == null ? null : String(r.entered_at),
    lastActivityAt: r.last_activity_at == null ? null : String(r.last_activity_at),
    sessionId: r.session_id == null ? null : Number(r.session_id),
    roundsNoQuote: Number(r.rounds_no_quote) || 0,
    lastHintAt: r.last_hint_at == null ? null : String(r.last_hint_at),
  };
}

export async function loadLineMode(channelUserId: string): Promise<LineModeRow | null> {
  const { rows } = await sql`SELECT * FROM ai_quote_line_modes WHERE channel_user_id = ${channelUserId}`;
  return rows[0] ? rowToMode(rows[0] as Record<string, unknown>) : null;
}

/** Enter (or re-enter) AI mode. Keeps session_id — a quick re-entry continues
 *  the same conversation; after exit/escalation session_id is already NULL. */
export async function enterLineMode(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, entered_at, last_activity_at, rounds_no_quote)
    VALUES (${channelUserId}, NOW(), NOW(), 0)
    ON CONFLICT (channel_user_id)
    DO UPDATE SET entered_at = NOW(), last_activity_at = NOW(), rounds_no_quote = 0`;
}

/** Refresh the idle window after a handled turn; optionally link the session
 *  and update the no-quote round counter (omit a field to leave it as-is). */
export async function touchLineMode(
  channelUserId: string,
  patch: { sessionId?: number | null; roundsNoQuote?: number | null },
): Promise<void> {
  await sql`
    UPDATE ai_quote_line_modes
       SET last_activity_at = NOW(),
           session_id       = COALESCE(${patch.sessionId ?? null}, session_id),
           rounds_no_quote  = COALESCE(${patch.roundsNoQuote ?? null}, rounds_no_quote)
     WHERE channel_user_id = ${channelUserId}`;
}

/** Leave AI mode (customer exit or escalation hand-off). Keeps last_hint_at —
 *  the 24h hint gate must survive mode exits. */
export async function exitLineMode(channelUserId: string): Promise<void> {
  await sql`
    UPDATE ai_quote_line_modes
       SET entered_at = NULL, last_activity_at = NULL, session_id = NULL, rounds_no_quote = 0
     WHERE channel_user_id = ${channelUserId}`;
}

/** Record that the out-of-mode hint was sent (starts the 24h gate). Upsert —
 *  most users get a hint before they ever enter the mode. */
export async function markHintSent(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, last_hint_at)
    VALUES (${channelUserId}, NOW())
    ON CONFLICT (channel_user_id) DO UPDATE SET last_hint_at = NOW()`;
}
```

- [ ] **Step 2.4: รันให้ผ่าน + commit**

```bash
npx vitest run tests/ai-quote-line-mode.test.ts     # PASS (11 tests)
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint
git add lib/ai-quote/line-mode.ts tests/ai-quote-line-mode.test.ts
git commit -m "feat(ai-quote): LINE mode state — lazy 30-min expiry + 24h hint gate (1b-B §1-§2)"
```

---

### Task 3: `lib/ai-quote/customer-triggers.ts` — trigger detectors + canned copy

**Files:**
- Create: `lib/ai-quote/customer-triggers.ts`
- Test: `tests/ai-quote-customer-triggers.test.ts`

- [ ] **Step 3.1: เขียน failing tests**

```ts
// tests/ai-quote-customer-triggers.test.ts
import { describe, it, expect } from 'vitest';
import {
  detectHumanRequest, detectOrderIntent, detectCustomerEscalation,
  ROUNDS_NO_QUOTE_LIMIT, CUSTOMER_REPLY, TRIGGER_LABEL, INTRO_TEXT, HINT_TEXT, HINT_QUICK_REPLY,
} from '@/lib/ai-quote/customer-triggers';

describe('detectHumanRequest (trigger ① — checked before the engine call)', () => {
  it.each(['ขอคุยกับพนักงานค่ะ', 'คุยกับคนได้มั้ย', 'ติดต่อทีมงานหน่อย', 'ขอสายแอดมิน'])('fires on %s', (t) => {
    expect(detectHumanRequest(t)).toBe(true);
  });
  it('does not fire on a normal spec message', () => {
    expect(detectHumanRequest('โบรชัวร์ A4 1000 ใบ')).toBe(false);
  });
});

describe('detectOrderIntent (trigger ④ — Type B, needs an existing quote)', () => {
  it.each(['สั่งเลยค่ะ', 'ตกลงสั่งตามนี้', 'ยืนยันสั่งทำ', 'เอาตามนี้เลย'])('fires on %s', (t) => {
    expect(detectOrderIntent(t)).toBe(true);
  });
  it('does not fire on a price question', () => {
    expect(detectOrderIntent('ราคาเท่าไหร่คะ')).toBe(false);
  });
  it('does not fire on a spec sentence that merely mentions ordering', () => {
    // "สั่งพิมพ์/จะสั่ง" โผล่ในประโยคบอกสเปกงานปกติ — ห้ามนับเป็นการยืนยันสั่ง
    expect(detectOrderIntent('อยากสั่งพิมพ์โบรชัวร์ 1000 ใบ')).toBe(false);
    expect(detectOrderIntent('ถ้าจะสั่งเพิ่มอีกแบบ ราคาเท่าไหร่คะ')).toBe(false);
  });
});

describe('detectCustomerEscalation (trigger ② — pinned hand-off phrase)', () => {
  it('fires when no quote + the reply contains ส่งต่อทีมงาน', () => {
    expect(detectCustomerEscalation(0, 'งานกล่องขอส่งต่อทีมงานประเมินให้นะคะ')).toBe(true);
  });
  it('does NOT fire on the price disclaimer (ทีมงานยืนยันราคา) when a quote exists', () => {
    expect(detectCustomerEscalation(1, 'ราคา 5 บาท — ราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ')).toBe(false);
  });
  it('does NOT fire on a clarify question without the pinned phrase', () => {
    expect(detectCustomerEscalation(0, 'ขอทราบจำนวนที่ต้องการพิมพ์ค่ะ')).toBe(false);
  });
});

describe('canned copy', () => {
  it('rounds limit is 4 (spec D3)', () => {
    expect(ROUNDS_NO_QUOTE_LIMIT).toBe(4);
  });
  it('every canned reply is polite customer Thai (ค่ะ/นะคะ)', () => {
    for (const text of Object.values(CUSTOMER_REPLY)) expect(text).toMatch(/ค่ะ|นะคะ/);
  });
  it('trigger labels cover all four triggers', () => {
    expect(Object.keys(TRIGGER_LABEL).sort()).toEqual(['human', 'order_intent', 'out_of_scope', 'rounds']);
  });
  it('intro explains scope + how to exit', () => {
    expect(INTRO_TEXT).toContain('โบรชัวร์');
    expect(INTRO_TEXT).toContain('ออก');
  });
  it('hint quick-reply sends an enter keyword', () => {
    expect(HINT_QUICK_REPLY.text).toBe('ขอราคา AI');
    expect(HINT_TEXT).toContain('ทีมงาน');
  });
});
```

- [ ] **Step 3.2: รันให้ fail** — `npx vitest run tests/ai-quote-customer-triggers.test.ts` → module not found

- [ ] **Step 3.3: Implement**

```ts
// lib/ai-quote/customer-triggers.ts
// Escalation trigger detection + canned customer-facing copy for the LINE
// customer AI-quote flow (Phase 1b-B, spec §4). Pure module — no I/O — the
// webhook router imports it directly (no injection needed for pure fns).

export type TriggerType = 'human' | 'out_of_scope' | 'rounds' | 'order_intent';

/** ① Customer asks for a human. Checked BEFORE the engine call. */
export function detectHumanRequest(text: string): boolean {
  return /คุยกับ\s*(คน|พนักงาน|ทีมงาน|แอดมิน)|ขอสาย|ติดต่อ\s*(พนักงาน|ทีมงาน|แอดมิน)|โทรกลับ/i.test(text);
}

/** ④ Customer confirms the order (Type B — qualified lead). Only meaningful
 *  when the session already has ≥1 quote (caller checks countQuotes).
 *  Deliberately narrow — confirmation phrasings only. Broad words like
 *  "สั่งพิมพ์/จะสั่ง" appear in ordinary spec sentences ("อยากสั่งพิมพ์โบรชัวร์…")
 *  and a false positive here kicks the customer out of the mode. */
export function detectOrderIntent(text: string): boolean {
  return /สั่งเลย|สั่งตามนี้|ยืนยันสั่ง|ตกลงสั่ง|เอาตามนี้|ตามนี้เลย|ตกลงทำ/i.test(text);
}

/** ② Model handed off (out-of-scope / special paper / discount ask). The
 *  customer prompt pins the exact phrase "ส่งต่อทีมงาน" for hand-offs, so this
 *  stays narrow — the per-quote disclaimer ("ทีมงานยืนยันราคา") never matches
 *  because quoteCount > 0 on those turns. Keep prompt + detector in sync. */
export function detectCustomerEscalation(quoteCount: number, reply: string): boolean {
  return quoteCount === 0 && /ส่งต่อทีมงาน|ให้ทีมงานประเมิน/.test(reply);
}

/** ③ N consecutive engine turns without a successful quote → hand off. */
export const ROUNDS_NO_QUOTE_LIMIT = 4;

/** Fixed replies for the detector-driven triggers (②'s reply is the model's
 *  own hand-off text, so it has no entry here). */
export const CUSTOMER_REPLY: Record<'human' | 'rounds' | 'order_intent', string> = {
  human: 'รับทราบค่ะ ส่งต่อทีมงานแล้วนะคะ เดี๋ยวทีมงานติดต่อกลับโดยเร็วค่ะ 🙏',
  rounds: 'เดี๋ยวให้ทีมงานช่วยดูรายละเอียดให้นะคะ ส่งต่อทีมงานแล้วค่ะ เดี๋ยวติดต่อกลับค่ะ 🙏',
  order_intent: 'รับเรื่องแล้วค่ะ 🛒 ทีมขายจะติดต่อยืนยันราคาและรายละเอียดกับคุณลูกค้าอีกครั้งนะคะ ขอบคุณค่ะ 🙏',
};

/** Staff-facing trigger label (escalation Flex + /quote-leads context). */
export const TRIGGER_LABEL: Record<TriggerType, string> = {
  human: 'ลูกค้าขอคุยกับพนักงาน',
  out_of_scope: 'งานนอกขอบเขต AI',
  rounds: 'คุยหลายรอบยังตีราคาไม่ได้',
  order_intent: 'ลูกค้าพร้อมสั่ง (มีราคาแล้ว)',
};

// ─── Mode lifecycle copy (spec §1-§2, §6) ───

export const INTRO_TEXT =
  'สวัสดีค่ะ 🤖 ตอนนี้คุณลูกค้ากำลังคุยกับระบบประเมินราคาอัตโนมัติของ Penprinting นะคะ\n' +
  'พิมพ์สเปกงานมาได้เลย เช่น "โบรชัวร์ A4 1,000 ใบ" หรือ "หนังสือ A5 100 หน้า 500 เล่ม"\n' +
  '• ตีราคาได้: โบรชัวร์/ใบปลิว · หนังสือ · สมุด\n' +
  '• พิมพ์ "ออก" เมื่อต้องการกลับไปคุยกับทีมงาน\n' +
  'ราคาที่ได้เป็นการประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ';

export const EXIT_TEXT = 'ออกจากโหมดประเมินราคาแล้วค่ะ ✅ ทีมงานจะดูแลต่อจากตรงนี้นะคะ ขอบคุณค่ะ 🙏';

export const HINT_TEXT =
  'ทีมงานจะตอบกลับโดยเร็วค่ะ 🙏\n' +
  'หรือถ้าต้องการราคาประเมินทันที กดปุ่มด้านล่างให้ AI ช่วยคิดราคาได้เลยค่ะ (โบรชัวร์ · หนังสือ · สมุด)';

export const HINT_QUICK_REPLY = { label: '🤖 เริ่มขอราคา AI', text: 'ขอราคา AI' };

export const RATE_LIMIT_TEXT =
  'ขออภัยค่ะ มีการใช้งานถี่เกินไป รบกวนรอสักครู่ หรือรอทีมงานติดต่อกลับนะคะ 🙏';

export const ERROR_TEXT =
  'ขออภัยค่ะ ระบบขัดข้องชั่วคราว รบกวนลองใหม่อีกครั้ง หรือรอทีมงานตอบกลับนะคะ 🙏';
```

- [ ] **Step 3.4: รันให้ผ่าน + commit**

```bash
npx vitest run tests/ai-quote-customer-triggers.test.ts   # PASS
git add lib/ai-quote/customer-triggers.ts tests/ai-quote-customer-triggers.test.ts
git commit -m "feat(ai-quote): customer escalation triggers + canned copy (1b-B §4)"
```

---

### Task 4: `lib/ai-quote/prompt-customer.ts`

**Files:**
- Create: `lib/ai-quote/prompt-customer.ts`
- Test: `tests/ai-quote-prompt-customer.test.ts`

- [ ] **Step 4.1: เขียน failing tests**

```ts
// tests/ai-quote-prompt-customer.test.ts
import { describe, it, expect } from 'vitest';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { VALID_PAPER_NAMES } from '@/lib/ai-quote/prompt';

const p = buildCustomerSystemPrompt();

describe('buildCustomerSystemPrompt (1b-B §3)', () => {
  it('addresses the customer, not staff', () => {
    expect(p).toContain('ลูกค้า');
    expect(p).not.toContain('พนักงานจะวาง');   // staff-prompt framing must not leak
  });
  it('keeps the full known-paper list', () => {
    for (const name of VALID_PAPER_NAMES) expect(p).toContain(name);
  });
  it('pins the hand-off phrase used by detectCustomerEscalation', () => {
    expect(p).toContain('ส่งต่อทีมงาน');
  });
  it('requires the D4 price disclaimer on every quote', () => {
    expect(p).toContain('ราคาประเมินเบื้องต้น');
    expect(p).toContain('VAT 7%');
  });
  it('keeps the assume-and-disclose brochure rule (qty เพียงพอ)', () => {
    expect(p).toContain('จำนวน (qty)');
    expect(p).toContain('Art 120');
  });
  it('forbids self-negotiated discounts (escalate instead)', () => {
    expect(p).toMatch(/ต่อราคา|ส่วนลด/);
  });
});
```

- [ ] **Step 4.2: รันให้ fail** — module not found

- [ ] **Step 4.3: Implement**

```ts
// lib/ai-quote/prompt-customer.ts
// System prompt for the LINE customer-facing AI-quote mode (Phase 1b-B §3).
// Deliberately a separate file from the staff prompt (prompt.ts): different
// audience/voice/escalation phrasing, and the staff text is pinned by its own
// tests — tuning one must not drift the other. Domain rules are duplicated on
// purpose; only VALID_PAPER_NAMES is shared.
// ⚠️ The hand-off phrase "ส่งต่อทีมงาน" is load-bearing: detectCustomerEscalation
// (customer-triggers.ts) keys on it — keep prompt + detector in sync.
import { VALID_PAPER_NAMES } from './prompt';

export function buildCustomerSystemPrompt(): string {
  return `คุณคือผู้ช่วยประเมินราคางานพิมพ์ของโรงพิมพ์ Penprinting กำลังคุยกับ "ลูกค้า" โดยตรงทาง LINE. ใช้ภาษาสุภาพแบบร้านค้า ลงท้าย "ค่ะ" เข้าใจง่าย ไม่ใช้ศัพท์เทคนิคภายใน (ห้ามพูดถึงชื่อพนักงาน เครื่องพิมพ์ แผนก หรือระบบภายใน).

## หน้าที่
1. อ่านข้อความลูกค้า → สกัดสเปกงานพิมพ์
2. ถ้าสเปกครบ → เรียกเครื่องมือ \`compute_quote\` เพื่อคำนวณราคาจริง (ห้ามเดาราคาเอง)
3. ตอบราคาเป็นภาษาไทย กระชับ อ่านง่ายบนมือถือ

## งานที่ประเมินราคาได้ (3 ชนิดเท่านั้น)
- **โบรชัวร์/ใบปลิว** (brochure): size = A2/A3/A4/A5/ตัด16 · color = "1"/"2"/"4" สี · sides = 1 หรือ 2 หน้า · paperName · qty (จำนวน)
- **หนังสือ** (book): size · qty · cover {paperName, color} · innerA {paperName, color, pages} · innerB {paperName, color, pages} (เนื้อในชุดเดียว → innerB.pages = 0)
- **สมุด** (notebook): เหมือนหนังสือ แต่ size = A4/A5 เท่านั้น

## ชื่อกระดาษที่รู้จัก (paperName ต้องตรงเป๊ะ)
${VALID_PAPER_NAMES.join(' · ')}

### แปลงชื่อกระดาษภาษาพูด → ชื่อในระบบ (ทำก่อนเทียบ list)
- "อาร์ทการ์ด"/"อาร์ตการ์ด" {น้ำหนัก}: 210 → Art 210 · 230 → Art 230 · 300 → Art Card 300 · 350 → Art Card 350. น้ำหนักอื่น (เช่น 260) → ส่งต่อทีมงาน (อย่าเดา)
- "ปอนด์" {น้ำหนัก} → Bond {น้ำหนัก} (เช่น ปอนด์ 80 → Bond 80)
แปลงแล้วตรง list = ใช้ได้เลย. ลูกค้าระบุกระดาษที่ (แปลงแล้ว) อยู่ใน list → ใช้ค่านั้นตีราคาทันที ไม่ต้องถามยืนยัน แม้ต่างจากค่ามาตรฐาน. แปลงแล้วยังไม่อยู่ใน list = กระดาษพิเศษ → ส่งต่อทีมงาน.

## กฎราคา (สำคัญมาก)
- แสดง **ราคาต่อชิ้น** (unitPrice จาก \`compute_quote\`)
- **ก่อน VAT** เสมอ และบอกชัดทุกครั้งว่า "ยังไม่รวม VAT 7%"
- ใช้ตัวเลขจากเครื่องมือ (ปัด ~2 ตำแหน่งได้ แต่แนบเลขเต็มด้วย)
- ห้ามบวกกำไรเพิ่ม · ห้ามให้ส่วนลด/ต่อราคาเอง — ลูกค้าขอต่อราคา/ส่วนลด → ส่งต่อทีมงาน
- **ทุกครั้งที่บอกราคา ปิดท้ายว่า:** "ราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ"

## ห้ามเดาราคา
ราคาทุกตัวต้องมาจาก \`compute_quote\` เท่านั้น. ยังไม่ได้เรียกเครื่องมือ = ห้ามพิมพ์ตัวเลขราคา.

## ⭐ เกณฑ์ "ครบพอตีราคา" — เช็คก่อนถามกลับ
- **โบรชัวร์/ใบปลิว**: รู้ว่าเป็นโบรชัวร์/ใบปลิว + มี **จำนวน (qty)** = ครบแล้ว → ห้ามถามขนาด/สี/หน้า/กระดาษ. เติมค่ามาตรฐานแล้วเรียก \`compute_quote\` ทันที พร้อมแจ้งสมมติฐาน
- **หนังสือ/สมุด**: ต้องมี qty + จำนวนหน้า + กระดาษเนื้อใน + สีเนื้อใน (ปกมีค่ามาตรฐานแล้ว ไม่ต้องถาม)

## ค่ามาตรฐาน (เติมเฉพาะที่ลูกค้า "ไม่ได้พูดถึง" — อย่าถาม)
- โบรชัวร์/ใบปลิว: A4 · 4 สี · 2 หน้า · Art 120
- หนังสือ/สมุด: A5 · เนื้อในชุดเดียว · สีปก 4 สี · กระดาษปก Art 230
ลูกค้าระบุเอง → ใช้ค่าลูกค้าเสมอ.

## กฎ "ทั้งเล่ม"
"X สีทั้งเล่ม" = ปกและเนื้อใน = X สีทั้งคู่ → ห้ามถามสีปก/สีเนื้อในซ้ำ.

## ⛔ ห้ามถามสีปก/กระดาษปกเด็ดขาด
ปกมีค่ามาตรฐาน (4 สี / Art 230) เสมอ — เนื้อในขาวดำก็ไม่ใช่เหตุให้ถามปก. เติมเงียบๆ แล้วแจ้งในบรรทัดสมมติฐาน.

## ต้องถามเสมอ (ห้ามเดา)
- จำนวน (qty) ทุกชนิดงาน
- หนังสือ/สมุด: จำนวนหน้า · กระดาษเนื้อใน · สีเนื้อใน
ถ้าขาดหลายอย่าง → ถามรวมครั้งเดียว สั้นๆ เป็นกันเอง (ห้ามทยอยถามทีละข้อ).

## เมื่อใช้ค่ามาตรฐาน แจ้งสมมติฐานเสมอ
เช่น "📋 ประเมินจาก: A4 / 4 สี / 2 หน้า / Art 120 — ถ้าสเปกต่างจากนี้บอกได้เลยค่ะ ราคาจะเปลี่ยนนะคะ"

## เมื่องานเกินขอบเขต → ส่งต่อทีมงาน (สำคัญ)
กรณีเหล่านี้ **ห้ามตีราคา** และคำตอบต้องมีวลี "**ส่งต่อทีมงาน**" เสมอ (ระบบใช้วลีนี้ตรวจจับการส่งต่อ):
- งานนอก 3 ชนิด: กล่อง / ถุงกระดาษ / นามบัตร / สติกเกอร์ / โปสการ์ด / อื่นๆ
- กระดาษพิเศษนอกรายการ · จำนวนสูงผิดปกติ · ลูกค้าขอต่อราคา/ส่วนลด
ตัวอย่าง: "งานแบบนี้ขอส่งต่อทีมงานประเมินราคาให้นะคะ เดี๋ยวทีมงานติดต่อกลับค่ะ 🙏"
ห้ามใช้วลี "ส่งต่อทีมงาน" ในคำถามขอข้อมูลเพิ่มทั่วไป — ใช้เฉพาะตอนส่งต่อจริงเท่านั้น.

## เมื่อลูกค้าจะสั่งงานจริง
ลูกค้ายืนยันจะสั่ง → ตอบรับสุภาพ บอกว่าทีมขายจะติดต่อยืนยันราคาและรายละเอียด (ห้ามรับออเดอร์/นัดชำระเงินเอง).

## หลายงานในข้อความเดียว
เรียก \`compute_quote\` แยกทีละงาน แล้วสรุปรวมท้ายข้อความ.

ตอบภาษาไทยเสมอ กระชับ อ่านง่ายบนมือถือ ใช้อีโมจิได้เล็กน้อยพองาม.`;
}
```

- [ ] **Step 4.4: รันให้ผ่าน + commit**

```bash
npx vitest run tests/ai-quote-prompt-customer.test.ts   # PASS
git add lib/ai-quote/prompt-customer.ts tests/ai-quote-prompt-customer.test.ts
git commit -m "feat(ai-quote): customer system prompt variant (1b-B §3)"
```

---

### Task 5: `lib/ai-quote/escalation-flex.ts`

**Files:**
- Create: `lib/ai-quote/escalation-flex.ts`
- Test: `tests/ai-quote-escalation-flex.test.ts`

- [ ] **Step 5.1: เขียน failing tests**

```ts
// tests/ai-quote-escalation-flex.test.ts
import { describe, it, expect } from 'vitest';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';

const base = {
  trigger: 'human' as const,
  customerName: 'คุณเอ',
  lineUserId: 'U123',
  lastUserText: 'ขอคุยกับพนักงานค่ะ',
  lastQuote: null,
  sessionId: 42,
};

describe('buildEscalationFlex (1b-B §4)', () => {
  it('is a complete flex message with customer name in altText', () => {
    const f = buildEscalationFlex(base);
    expect(f.type).toBe('flex');
    expect(String(f.altText)).toContain('คุณเอ');
  });
  it('falls back to the LINE userId when no display name', () => {
    const f = buildEscalationFlex({ ...base, customerName: null });
    expect(String(f.altText)).toContain('U123');
  });
  it('order_intent uses the Type B (พร้อมสั่ง) header', () => {
    const f = buildEscalationFlex({ ...base, trigger: 'order_intent' });
    expect(JSON.stringify(f)).toContain('พร้อมสั่ง');
  });
  it('includes the last quote line when present', () => {
    const f = buildEscalationFlex({ ...base, lastQuote: { productType: 'brochure', unitPrice: 4.78 } });
    const s = JSON.stringify(f);
    expect(s).toContain('4.78');
    expect(s).toContain('โบรชัวร์');
  });
  it('links to /quote-leads and truncates long messages', () => {
    const f = buildEscalationFlex({ ...base, lastUserText: 'ก'.repeat(300) });
    const s = JSON.stringify(f);
    expect(s).toContain('dashboard.penprinting.co/quote-leads');
    expect(s).toContain('…');
  });
});
```

- [ ] **Step 5.2: รันให้ fail** — module not found

- [ ] **Step 5.3: Implement**

```ts
// lib/ai-quote/escalation-flex.ts
// Escalation hand-off → Flex card pushed to the staff LINE group (Phase 1b-B
// spec §4). Pure + total like slip-flex.ts: never throws, null-safe fields.
import { TRIGGER_LABEL, type TriggerType } from './customer-triggers';

const ACCENT = '#c8553d'; // Penprinting brand
const TEXT = '#2c2c2a';
const MUTED = '#888780';

export interface EscalationFlexInput {
  trigger: TriggerType;
  customerName: string | null;
  lineUserId: string;
  lastUserText: string;
  lastQuote: { productType: string; unitPrice: number } | null;
  sessionId: number;
}

// Type A (hand-off) = amber alert · Type B (qualified, พร้อมสั่ง) = green
const HEADER: Record<'A' | 'B', { bg: string; fg: string; label: string }> = {
  A: { bg: '#fdf0e7', fg: '#b45309', label: '🔔 AI ส่งต่อลูกค้าให้ทีมงาน' },
  B: { bg: '#e1f5ee', fg: '#0f6e56', label: '🛒 ลูกค้าพร้อมสั่ง (จาก AI)' },
};

const PRODUCT_LABEL: Record<string, string> = { brochure: 'โบรชัวร์/ใบปลิว', book: 'หนังสือ', notebook: 'สมุด' };

function kvRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: MUTED, flex: 2 },
      { type: 'text', text: value, size: 'sm', color: TEXT, flex: 5, wrap: true },
    ],
  };
}

/** Build the staff-group Flex for an escalation. Complete message object —
 *  ready to pass to pushLine(LINE_STAFF_GROUP_ID, ...). */
export function buildEscalationFlex(input: EscalationFlexInput): Record<string, unknown> {
  const h = HEADER[input.trigger === 'order_intent' ? 'B' : 'A'];
  const who = input.customerName || input.lineUserId;
  const body: Record<string, unknown>[] = [
    kvRow('ลูกค้า', who),
    kvRow('เหตุผล', TRIGGER_LABEL[input.trigger]),
  ];
  if (input.lastQuote) {
    body.push(kvRow(
      'ราคาล่าสุด',
      `${PRODUCT_LABEL[input.lastQuote.productType] ?? input.lastQuote.productType} · ~${input.lastQuote.unitPrice.toFixed(2)} บ./ชิ้น`,
    ));
  }
  if (input.lastUserText) {
    body.push(kvRow('ข้อความ', input.lastUserText.length > 120 ? input.lastUserText.slice(0, 120) + '…' : input.lastUserText));
  }
  return {
    type: 'flex',
    altText: `${h.label}: ${who}`,
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box', layout: 'horizontal', backgroundColor: h.bg, paddingAll: '12px',
        contents: [{ type: 'text', text: h.label, weight: 'bold', size: 'md', color: h.fg, wrap: true }],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px', spacing: 'sm',
        contents: [
          {
            type: 'button', style: 'primary', height: 'sm', color: ACCENT,
            action: { type: 'uri', label: 'เปิด /quote-leads', uri: 'https://dashboard.penprinting.co/quote-leads' },
          },
          { type: 'text', text: `lead #${input.sessionId} · Penprinting AI`, size: 'xxs', color: MUTED, align: 'center' },
        ],
      },
    },
  };
}
```

- [ ] **Step 5.4: รันให้ผ่าน + commit**

```bash
npx vitest run tests/ai-quote-escalation-flex.test.ts   # PASS
git add lib/ai-quote/escalation-flex.ts tests/ai-quote-escalation-flex.test.ts
git commit -m "feat(ai-quote): staff-group escalation Flex card (1b-B §4)"
```

---

### Task 6: `db.ts` — owner-check loadSession · createLineSession · countQuotes (+types)

**Files:**
- Modify: `lib/ai-quote/db.ts`, `lib/ai-quote/types.ts`
- Test: `tests/ai-quote-db-line.test.ts`

- [ ] **Step 6.1: เขียน failing tests**

```ts
// tests/ai-quote-db-line.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSession, createLineSession, countQuotes } from '@/lib/ai-quote/db';

describe('loadSession owner-check (M5 — 1b-B §5)', () => {
  beforeEach(() => resetMockPostgres());

  it('with lineUserId filters on channel=line AND line_user_id', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { lineUserId: 'U-A' });
    const call = sqlCalls[0];
    expect(call.text).toContain("channel = 'line'");
    expect(call.text).toContain('line_user_id =');
    expect(call.values).toContain('U-A');
  });
  it('returns null on owner mismatch (empty result — never leaks existence)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadSession(7, { lineUserId: 'U-B' })).toBeNull();
  });
  it('without lineUserId keeps the channel-only scope (staff route unchanged)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'dashboard' });
    expect(sqlCalls[0].text).not.toContain('line_user_id');
  });
});

describe('createLineSession / countQuotes', () => {
  beforeEach(() => resetMockPostgres());

  it("createLineSession inserts channel='line' + owner + display name", async () => {
    queueResult({ rows: [{ id: 9, channel: 'line', conversation: [], lead_status: 'ใหม่', line_user_id: 'U1', customer_name: 'คุณเอ', created_at: 't', updated_at: 't' }], rowCount: 1 });
    const s = await createLineSession('U1', 'คุณเอ');
    expect(s.id).toBe(9);
    expect(s.lineUserId).toBe('U1');
    const call = findCallContaining('INSERT INTO ai_quote_sessions');
    expect(call?.text).toContain("'line'");
    expect(call?.values).toContain('U1');
  });
  it('countQuotes returns the count (0 on empty)', async () => {
    queueResult({ rows: [{ count: 3 }], rowCount: 1 });
    expect(await countQuotes(9)).toBe(3);
    expect(await countQuotes(9)).toBe(0);   // queue exhausted → default empty
  });
});
```

- [ ] **Step 6.2: รันให้ fail** — `npx vitest run tests/ai-quote-db-line.test.ts` → `createLineSession` is not exported

- [ ] **Step 6.3: Implement**

`lib/ai-quote/types.ts` — เพิ่ม field ใน `AiQuoteSession` (หลัง `channel`):

```ts
  /** LINE owner binding (M5) — non-null only for channel='line' sessions. */
  lineUserId: string | null;
```

`lib/ai-quote/db.ts` — `rowToSession` เพิ่มบรรทัด (หลัง `channel`):

```ts
    lineUserId: (r.line_user_id as string | null) ?? null,
```

แทนที่ `loadSession` เดิมทั้งฟังก์ชัน:

```ts
/** Load a session by id. Pass `opts.channel` to scope the lookup to a single
 *  channel — the staff chat route passes 'dashboard' so a staff sessionId can
 *  never cross-load a LINE-channel session (and vice-versa). Pass
 *  `opts.lineUserId` (LINE flow) for the full M5 owner-check: the session is
 *  returned only when channel='line' AND the webhook-verified sender owns it —
 *  mismatch → null, indistinguishable from not-found (never leaks existence).
 *  See design-ai-quoting.md §7. */
export async function loadSession(
  id: number,
  opts?: { channel?: 'dashboard' | 'line'; lineUserId?: string },
): Promise<AiQuoteSession | null> {
  const { rows } = opts?.lineUserId
    ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = 'line' AND line_user_id = ${opts.lineUserId}`
    : opts?.channel
      ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = ${opts.channel}`
      : await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  return rows[0] ? rowToSession(rows[0]) : null;
}
```

เพิ่ม 2 ฟังก์ชันใหม่ (ท้ายไฟล์):

```ts
/** Create a LINE-channel session bound to its webhook-verified owner (M5).
 *  Unlike the dashboard flow (no-auto-save), LINE persists from the first AI
 *  turn — there is no client to hold history between webhook calls, and spec
 *  §6 counts turns/escalations off ai_quote_sessions. */
export async function createLineSession(lineUserId: string, displayName?: string | null): Promise<AiQuoteSession> {
  const { rows } = await sql`
    INSERT INTO ai_quote_sessions (channel, line_user_id, conversation, lead_status, customer_name, customer_contact)
    VALUES ('line', ${lineUserId}, '[]'::jsonb, 'ใหม่', ${displayName ?? null}, 'LINE')
    RETURNING *`;
  return rowToSession(rows[0]);
}

/** Number of persisted quotes in a session — gates trigger ④ (order intent
 *  is only a qualified lead when a price was actually produced). */
export async function countQuotes(sessionId: number): Promise<number> {
  const { rows } = await sql`SELECT COUNT(*)::int AS count FROM ai_quotes WHERE session_id = ${sessionId}`;
  return Number((rows[0] as { count?: number } | undefined)?.count) || 0;
}
```

- [ ] **Step 6.4: รันให้ผ่านทั้งชุด + commit**

```bash
npx vitest run tests/ai-quote-db-line.test.ts    # PASS
npx vitest run                                    # ทั้ง repo ยังเขียว (rowToSession เพิ่ม field ไม่กระทบ pin เดิม)
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check
git add lib/ai-quote/db.ts lib/ai-quote/types.ts tests/ai-quote-db-line.test.ts
git commit -m "feat(ai-quote): M5 owner-check loadSession + createLineSession + countQuotes (1b-B §5)"
```

---

### Task 7: `channels/line.ts` — `getLineProfile`

**Files:**
- Modify: `lib/ai-quote/channels/line.ts` (เพิ่มหลัง `downloadLineImage`)

- [ ] **Step 7.1: Implement** (best-effort fetch — ไม่มี unit test, มาตรฐานเดียวกับ `pushLine`/`replyLine` ที่เป็น I/O ล้วน)

```ts
/** Best-effort LINE profile lookup (display name for lead cards / escalation
 *  Flex). Returns null on ANY failure — must never block the reply path. */
export async function getLineProfile(userId: string): Promise<{ displayName: string } | null> {
  try {
    const res = await fetch(`${LINE_API}/profile/${userId}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { displayName?: string };
    return body.displayName ? { displayName: body.displayName } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 7.2: Gates + commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint
git add lib/ai-quote/channels/line.ts
git commit -m "feat(ai-quote): getLineProfile best-effort display-name lookup"
```

---

### Task 8: `webhook-router.ts` — entry/exit keywords ใน `routeInbound`

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts`
- Test: `tests/ai-quote-webhook-router.test.ts` (เพิ่ม describe block)

- [ ] **Step 8.1: เขียน failing tests** (ต่อท้ายไฟล์ test เดิม)

```ts
describe('routeInbound — 1b-B mode keywords (aiEnabled=true)', () => {
  const on = { aiEnabled: true };
  it.each(['ขอราคา', 'ตีราคา', 'ขอราคา AI', 'ขอราคาai', ' ขอราคา '])('enter keyword: %s → enter-ai', (t) => {
    expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('enter-ai');
  });
  it.each(['จบ', 'ออก', 'ออกจากโหมด AI'])('exit keyword: %s → exit-ai', (t) => {
    expect(routeInbound({ ...base, kind: 'text', text: t }, on)).toBe('exit-ai');
  });
  it('a broader ขอราคา sentence is NOT an enter keyword (goes to ai/hint path)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'ขอราคาโบรชัวร์ 1000 ใบ' }, on)).toBe('ai');
  });
  it('คุยกับทีมงาน is no longer an exit keyword — it is an ai turn (trigger ①)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'คุยกับทีมงาน' }, on)).toBe('ai');
  });
  it('keywords are inert when AI is disabled (1b-A regression)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'ขอราคา' }, { aiEnabled: false })).toBe('ignore');
    expect(routeInbound({ ...base, kind: 'text', text: 'ออก' }, { aiEnabled: false })).toBe('ignore');
  });
  it('enter keyword in a group is still ignored (no AI in shared chats)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: 'ขอราคา', sourceType: 'group', groupId: 'G1' }, on)).toBe('ignore');
  });
  it('/track and slip keep priority over AI inside the mode (router order unchanged)', () => {
    expect(routeInbound({ ...base, kind: 'text', text: '/track 202606110' }, on)).toBe('track');
    expect(routeInbound({ ...base, kind: 'image', imageMessageId: 'i' }, on)).toBe('slip');
  });
});
```

- [ ] **Step 8.2: รันให้ fail** — `npx vitest run tests/ai-quote-webhook-router.test.ts` → enter-ai cases FAIL (ปัจจุบันได้ 'ai')

- [ ] **Step 8.3: Implement** — เพิ่ม 2 helper + แทน 3 บรรทัดท้าย `routeInbound`

เพิ่มก่อน `routeInbound`:

```ts
/** Mode entry keywords (spec §1 — exact-ish; a broad "ราคา..." sentence must
 *  NOT enter the mode, it collides with normal staff conversation). */
export function isEnterAiKeyword(text: string): boolean {
  return /^(ขอราคา|ตีราคา)(\s*ai)?$/i.test(text.trim());
}

/** Mode exit keywords (spec §1). "คุยกับทีมงาน" is deliberately NOT here —
 *  in-mode it is escalation trigger ① (hand-off with a staff push), not a
 *  silent exit. */
export function isExitAiKeyword(text: string): boolean {
  return /^(จบ|ออก|ออกจากโหมด\s*ai)$/i.test(text.trim());
}
```

แทนที่ 3 บรรทัดสุดท้ายของ `routeInbound` (จาก `if (m.kind === 'postback' ...` ถึงก่อน `return 'ignore';`):

```ts
  if (m.kind === 'postback' && m.postbackData === 'ai_quote_start') return 'enter-ai';
  if (m.kind === 'text' && m.text) {
    if (isEnterAiKeyword(m.text)) return 'enter-ai';
    if (isExitAiKeyword(m.text)) return 'exit-ai';
    return 'ai';
  }
```

- [ ] **Step 8.4: รันให้ผ่าน + commit**

```bash
npx vitest run tests/ai-quote-webhook-router.test.ts   # PASS ทั้งไฟล์ (เดิม + ใหม่)
git add lib/ai-quote/webhook-router.ts tests/ai-quote-webhook-router.test.ts
git commit -m "feat(ai-quote): mode entry/exit keywords in routeInbound (1b-B §1)"
```

---

### Task 9: `webhook-router.ts` — customer AI arms ใน `handleInbound` (งานใหญ่สุด)

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts`
- Test: `tests/ai-quote-webhook-router.test.ts` (เพิ่ม 2 describe blocks)

- [ ] **Step 9.1: เขียน failing tests** (ต่อท้ายไฟล์ test เดิม)

```ts
// ─── 1b-B: customer AI arms ───
import type { CustomerAiDeps } from '@/lib/ai-quote/webhook-router';

const ACTIVE_MODE = { channelUserId: 'U1', enteredAt: 't', lastActivityAt: 't', sessionId: 7, roundsNoQuote: 0, lastHintAt: null };
const QUOTE = { productType: 'brochure' as const, spec: {}, result: { unitPrice: 5 }, unitPrice: 5 };

function stubAi(over: Partial<Record<keyof CustomerAiDeps, unknown>> = {}) {
  const calls: string[] = [];
  const pushed: unknown[] = [];
  const ai = {
    loadMode: async () => ACTIVE_MODE,
    enterMode: async () => { calls.push('enter'); },
    touchMode: async () => { calls.push('touch'); },
    exitMode: async () => { calls.push('exit'); },
    markHintSent: async () => { calls.push('hint-sent'); },
    modeActive: () => true,
    hintAllowed: () => true,
    hintEnabled: true,
    checkRateLimit: async () => true,
    loadSessionForUser: async () => ({ conversation: [], customerName: 'คุณเอ' }),
    createSessionForUser: async () => ({ id: 7, customerName: null }),
    saveConversation: async () => { calls.push('save-conv'); },
    saveQuote: async () => { calls.push('save-quote'); return 1; },
    countQuotes: async () => 0,
    updateLeadStatus: async (_id: number, status: string) => { calls.push('status:' + status); },
    runTurn: async () => ({ reply: 'ราคา ~5.00 บ./ชิ้น ยังไม่รวม VAT 7% — ราคาประเมินเบื้องต้นนะคะ ทีมงานยืนยันราคาอีกครั้งค่ะ', quotes: [QUOTE], escalated: false, newHistory: [{ role: 'user' as const, text: 'x' }, { role: 'assistant' as const, text: 'y' }] }),
    buildEscalationFlex: () => ({ type: 'flex', altText: 'ESCALATE' }),
    pushStaff: async (msg: object) => { calls.push('push-staff'); pushed.push(msg); },
    ...over,
  } as unknown as CustomerAiDeps;
  return { ai, calls, pushed };
}

const text1on1 = (text: string): InboundMessage => ({ channel: 'line', channelUserId: 'U1', kind: 'text', text, replyToken: 'rt' });

describe('handleInbound — 1b-B mode lifecycle', () => {
  it('enter-ai keyword enters the mode and sends the intro', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ขอราคา AI'), deps as never);
    expect(calls).toContain('enter');
    expect(String(replies[0])).toContain('ประเมินราคาอัตโนมัติ');
  });
  it('exit keyword in-mode exits and confirms', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ออก'), deps as never);
    expect(calls).toContain('exit');
    expect(String(replies[0])).toContain('ออกจากโหมด');
  });
  it('exit keyword out-of-mode is silent (normal chat word — staff answers)', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ออก'), deps as never);
    expect(calls).not.toContain('exit');
    expect(replies.length).toBe(0);
  });
  it('out-of-mode text → hint + quick-reply, gate marked', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, loadMode: async () => null });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ สนใจงานพิมพ์'), deps as never);
    expect(calls).toContain('hint-sent');
    expect(String(replies[0])).toContain('ทีมงาน');
  });
  it('hint is silent inside the 24h gate', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, hintAllowed: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('hint is silent when hintEnabled=false (soft launch)', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, hintEnabled: false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('in-mode text runs the engine, saves, touches, replies', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000 ใบ'), deps as never);
    expect(calls).toEqual(expect.arrayContaining(['save-quote', 'save-conv', 'touch']));
    expect(String(replies[0])).toContain('5.00');
  });
  it('rate-limited turn declines politely without calling the engine', async () => {
    let engineCalled = false;
    const { ai } = stubAi({ checkRateLimit: async () => false, runTurn: async () => { engineCalled = true; throw new Error('no'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(engineCalled).toBe(false);
    expect(String(replies[0])).toContain('ถี่เกินไป');
  });
  it('engine failure replies the error text (customer never gets silence)', async () => {
    const { ai } = stubAi({ runTurn: async () => { throw new Error('calc 500'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(String(replies[0])).toContain('ขัดข้อง');
  });
  it('owner mismatch on the linked session falls back to a fresh session (M5)', async () => {
    const created: number[] = [];
    const { ai } = stubAi({
      loadSessionForUser: async () => null,   // channel/owner mismatch → null
      createSessionForUser: async () => { created.push(1); return { id: 99, customerName: null }; },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(created.length).toBe(1);
  });
  it('aiEnabled but aiCustomer missing (env not wired) stays silent — 1b-A behaviour', async () => {
    const { replies, deps } = stubDeps({ aiEnabled: true });
    await handleInbound(text1on1('โบรชัวร์ 1000'), deps as never);
    expect(replies.length).toBe(0);
  });
});

describe('handleInbound — 1b-B escalation triggers (spec §4)', () => {
  it('① human request: escalates without an engine call, exits mode', async () => {
    let engineCalled = false;
    const { ai, calls } = stubAi({ runTurn: async () => { engineCalled = true; throw new Error('no'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ขอคุยกับพนักงานค่ะ'), deps as never);
    expect(engineCalled).toBe(false);
    expect(calls).toEqual(expect.arrayContaining(['status:escalated', 'push-staff', 'exit', 'save-conv']));
    expect(String(replies[0])).toContain('ส่งต่อทีมงาน');
  });
  it('④ order intent with an existing quote: Type B → กำลังติดตาม', async () => {
    const { ai, calls } = stubAi({ countQuotes: async () => 1 });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สั่งเลยค่ะ'), deps as never);
    expect(calls).toContain('status:กำลังติดตาม');
    expect(calls).toContain('exit');
    expect(String(replies[0])).toContain('ทีมขาย');
  });
  it('④ order intent WITHOUT a quote goes to the engine instead (must quote first)', async () => {
    let engineCalled = false;
    const { ai, calls } = stubAi({
      countQuotes: async () => 0,
      runTurn: async () => { engineCalled = true; return { reply: 'ขอทราบจำนวนค่ะ', quotes: [], escalated: false, newHistory: [] }; },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สั่งเลยค่ะ'), deps as never);
    expect(engineCalled).toBe(true);
    expect(calls).not.toContain('status:กำลังติดตาม');
  });
  it("② model hand-off (ส่งต่อทีมงาน, no quote): escalates with the model's own reply", async () => {
    const { ai, calls } = stubAi({
      runTurn: async () => ({ reply: 'งานกล่องขอส่งต่อทีมงานประเมินให้นะคะ', quotes: [], escalated: true, newHistory: [] }),
    });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('กล่องใส่สินค้า 500 ใบ'), deps as never);
    expect(calls).toEqual(expect.arrayContaining(['status:escalated', 'push-staff', 'exit']));
    expect(String(replies[0])).toContain('ส่งต่อทีมงาน');
  });
  it('③ 4th no-quote round escalates with the fixed reply', async () => {
    const { ai, calls } = stubAi({
      loadMode: async () => ({ ...ACTIVE_MODE, roundsNoQuote: 3 }),
      runTurn: async () => ({ reply: 'ขอทราบจำนวนหน้าค่ะ', quotes: [], escalated: false, newHistory: [{ role: 'user' as const, text: 'x' }, { role: 'assistant' as const, text: 'ขอทราบจำนวนหน้าค่ะ' }] }),
    });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('หนังสือ'), deps as never);
    expect(calls).toContain('status:escalated');
    expect(String(replies[0])).toContain('ทีมงาน');
  });
  it('a successful quote resets the round counter (no escalation at rounds=3)', async () => {
    const touched: unknown[] = [];
    const { ai, calls } = stubAi({
      loadMode: async () => ({ ...ACTIVE_MODE, roundsNoQuote: 3 }),
      touchMode: async (_uid: string, patch: unknown) => { touched.push(patch); },
    });
    const { deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('โบรชัวร์ 1000 ใบ'), deps as never);
    expect(calls).not.toContain('status:escalated');
    expect(touched[0]).toMatchObject({ roundsNoQuote: 0 });
  });
  it('missing pushStaff (LINE_STAFF_GROUP_ID unset) still escalates + replies (degraded)', async () => {
    const { ai, calls } = stubAi({ pushStaff: null });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('ขอคุยกับพนักงานค่ะ'), deps as never);
    expect(calls).toContain('status:escalated');
    expect(replies.length).toBe(1);
  });
});
```

หมายเหตุ: `stubDeps` เดิมรับ `over` spread เข้า deps อยู่แล้ว — `aiEnabled: true, aiCustomer: ai` ส่งผ่าน `stubDeps({...})` ได้เลย

- [ ] **Step 9.2: รันให้ fail** — ทุก test ใหม่ FAIL (arms ยังเป็น no-op)

- [ ] **Step 9.3: Implement** — แก้ `lib/ai-quote/webhook-router.ts`

imports เพิ่มบนหัวไฟล์:

```ts
import type { ConversationTurn } from './types';
import type { RunQuoteTurnOutput, ProducedQuote } from './run';
import type { LineModeRow } from './line-mode';
import type { EscalationFlexInput } from './escalation-flex';
import {
  detectHumanRequest, detectOrderIntent, detectCustomerEscalation,
  ROUNDS_NO_QUOTE_LIMIT, CUSTOMER_REPLY, INTRO_TEXT, EXIT_TEXT, HINT_TEXT,
  HINT_QUICK_REPLY, RATE_LIMIT_TEXT, ERROR_TEXT, type TriggerType,
} from './customer-triggers';
```

เพิ่ม interface หลัง `HandleDeps` และเพิ่ม field ใน `HandleDeps`:

```ts
/** Side-effecting deps for the 1b-B customer AI arms — everything injectable
 *  so handleInbound stays pure-testable. Pure helpers (trigger detectors,
 *  canned copy) are imported directly, not injected. Absent (undefined) when
 *  AI_QUOTE_LINE_ENABLED is off or QUOTE_API env is missing → 1b-A behaviour. */
export interface CustomerAiDeps {
  loadMode: (uid: string) => Promise<LineModeRow | null>;
  enterMode: (uid: string) => Promise<void>;
  touchMode: (uid: string, patch: { sessionId?: number | null; roundsNoQuote?: number | null }) => Promise<void>;
  exitMode: (uid: string) => Promise<void>;
  markHintSent: (uid: string) => Promise<void>;
  modeActive: (lastActivityAt: string | null, nowMs: number) => boolean;
  hintAllowed: (lastHintAt: string | null, nowMs: number) => boolean;
  hintEnabled: boolean;
  /** true = ผ่าน (30 msg/hr per line_user_id — spec §6). */
  checkRateLimit: (uid: string) => Promise<boolean>;
  /** Owner-checked load (M5): null on mismatch — caller starts fresh. */
  loadSessionForUser: (id: number, uid: string) => Promise<{ conversation: ConversationTurn[]; customerName: string | null } | null>;
  createSessionForUser: (uid: string) => Promise<{ id: number; customerName: string | null }>;
  saveConversation: (id: number, conversation: ConversationTurn[]) => Promise<void>;
  saveQuote: (sessionId: number, q: ProducedQuote) => Promise<number>;
  countQuotes: (sessionId: number) => Promise<number>;
  updateLeadStatus: (sessionId: number, status: 'escalated' | 'กำลังติดตาม') => Promise<void>;
  runTurn: (history: ConversationTurn[], userMessage: string) => Promise<RunQuoteTurnOutput>;
  buildEscalationFlex: (input: EscalationFlexInput) => Record<string, unknown>;
  /** null = LINE_STAFF_GROUP_ID unset → escalation continues, push skipped (logged). */
  pushStaff: ((message: object) => Promise<void>) | null;
}
```

ใน `HandleDeps` เพิ่ม (ท้าย interface):

```ts
  // 1b-B customer AI arms — absent = flag off / env missing (1b-A behaviour).
  aiCustomer?: CustomerAiDeps;
```

แทนที่ comment ท้าย `handleInbound` (`// slip/track/groupid เท่านั้นใน 1b-A...`) ด้วย:

```ts
  // ── Phase 1b-B: customer AI arms (LINE 1-1 only — groups never reach here) ──
  if (route !== 'enter-ai' && route !== 'exit-ai' && route !== 'ai') return;
  const ai = deps.aiCustomer;
  if (!ai) return;   // flag ON but deps not wired (missing env) → 1b-A behaviour
  const uid = m.channelUserId;
  const now = Date.now();

  if (route === 'enter-ai') {
    await ai.enterMode(uid);
    await deps.adapter.reply(m, INTRO_TEXT);
    return;
  }

  const mode = await ai.loadMode(uid);
  const active = mode !== null && ai.modeActive(mode.lastActivityAt, now);

  if (route === 'exit-ai') {
    if (active) {
      await ai.exitMode(uid);
      await deps.adapter.reply(m, EXIT_TEXT);
    }
    // นอกโหมด "จบ"/"ออก" เป็นคำคุยปกติ — เงียบ (พนักงานตอบเอง, ห้ามแทรก)
    return;
  }

  // route === 'ai'
  if (!active) {
    // นอกโหมด (spec §2): hint ≤1/user/24h + ปุ่มเข้าโหมด 1 แตะ. Sub-flag ปิดได้
    // ช่วง soft launch. Gate เก็บใน DB (ไม่ใช้ KV — fail-open จะ spam แชตพนักงาน).
    if (!ai.hintEnabled) return;
    if (mode && !ai.hintAllowed(mode.lastHintAt, now)) return;
    await ai.markHintSent(uid);
    await deps.adapter.reply(m, HINT_TEXT, [HINT_QUICK_REPLY]);
    return;
  }

  if (!(await ai.checkRateLimit(uid))) {
    await ai.touchMode(uid, {});
    await deps.adapter.reply(m, RATE_LIMIT_TEXT);
    return;
  }

  // Load (owner-checked, M5) or create the LINE-channel session. A mismatch
  // returns null and we start fresh — indistinguishable from not-found.
  let sessionId = mode!.sessionId;
  let conversation: ConversationTurn[] = [];
  let customerName: string | null = null;
  if (sessionId) {
    const sess = await ai.loadSessionForUser(sessionId, uid);
    if (sess) { conversation = sess.conversation; customerName = sess.customerName; }
    else sessionId = null;
  }
  if (!sessionId) {
    const created = await ai.createSessionForUser(uid);
    sessionId = created.id;
    customerName = created.customerName;
  }

  const text = m.text!;
  const sid = sessionId;
  const escalate = async (
    trigger: TriggerType, conv: ConversationTurn[], replyText: string,
    lastQuote: { productType: string; unitPrice: number } | null,
  ) => {
    await ai.saveConversation(sid, conv);
    await ai.updateLeadStatus(sid, trigger === 'order_intent' ? 'กำลังติดตาม' : 'escalated');
    if (ai.pushStaff) {
      try {
        await ai.pushStaff(ai.buildEscalationFlex({ trigger, customerName, lineUserId: uid, lastUserText: text, lastQuote, sessionId: sid }));
      } catch (err) {
        console.error('[ai-quote/line] escalation push failed:', err instanceof Error ? err.message : err);
      }
    } else {
      console.error(`[ai-quote/line] LINE_STAFF_GROUP_ID unset — escalation NOT pushed (lead #${sid})`);
    }
    await ai.exitMode(uid);
    await deps.adapter.reply(m, replyText);
  };

  // ① ขอคุยกับคน — ไม่เรียก engine (ไม่เผา token กับข้อความที่ขอ hand-off)
  if (detectHumanRequest(text)) {
    await escalate('human',
      [...conversation, { role: 'user', text }, { role: 'assistant', text: CUSTOMER_REPLY.human }],
      CUSTOMER_REPLY.human, null);
    return;
  }
  // ④ ลูกค้ายืนยันจะสั่ง (Type B) — ต้องมีราคาแล้วเท่านั้น ไม่งั้นปล่อยให้ engine ตีราคาก่อน
  if (detectOrderIntent(text) && (await ai.countQuotes(sid)) > 0) {
    await escalate('order_intent',
      [...conversation, { role: 'user', text }, { role: 'assistant', text: CUSTOMER_REPLY.order_intent }],
      CUSTOMER_REPLY.order_intent, null);
    return;
  }

  let out: RunQuoteTurnOutput;
  try {
    out = await ai.runTurn(conversation, text);
  } catch (err) {
    console.error('[ai-quote/line] engine turn failed:', err instanceof Error ? err.message : err);
    await ai.touchMode(uid, { sessionId: sid });
    await deps.adapter.reply(m, ERROR_TEXT);
    return;
  }
  for (const q of out.quotes) await ai.saveQuote(sid, q);
  const last = out.quotes[out.quotes.length - 1];
  const lastQuote = last ? { productType: last.productType, unitPrice: last.unitPrice } : null;

  // ② model hand-off (นอกขอบเขต/กระดาษพิเศษ/ขอส่วนลด) — ใช้ข้อความ model เอง.
  // ใช้ detector วลี pin ของ customer flow ไม่ใช่ out.escalated (heuristic ฝั่ง
  // staff กว้างเกิน — disclaimer ลูกค้ามีคำ "ทีมงาน" ทุกใบราคา).
  if (detectCustomerEscalation(out.quotes.length, out.reply)) {
    await escalate('out_of_scope', out.newHistory, out.reply, null);
    return;
  }
  // ③ วนหลายรอบไม่ได้ราคา — แทน reply ของ model ด้วยข้อความส่งต่อ
  const rounds = out.quotes.length > 0 ? 0 : mode!.roundsNoQuote + 1;
  if (out.quotes.length === 0 && rounds >= ROUNDS_NO_QUOTE_LIMIT) {
    const conv: ConversationTurn[] = [...out.newHistory.slice(0, -1), { role: 'assistant', text: CUSTOMER_REPLY.rounds }];
    await escalate('rounds', conv, CUSTOMER_REPLY.rounds, lastQuote);
    return;
  }

  await ai.saveConversation(sid, out.newHistory);
  await ai.touchMode(uid, { sessionId: sid, roundsNoQuote: rounds });
  await deps.adapter.reply(m, out.reply);
```

อัปเดต docstring ของ `handleInbound`: ลบประโยค "'ai'/'enter-ai'/'exit-ai' routes are no-ops until 1b-B wires them" → "1b-B wires the customer AI arms via deps.aiCustomer (absent = 1b-A behaviour)."

- [ ] **Step 9.4: รันให้ผ่านทั้งไฟล์ + ทั้ง repo + commit**

```bash
npx vitest run tests/ai-quote-webhook-router.test.ts   # PASS
npx vitest run                                          # ทั้ง repo เขียว
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint
git add lib/ai-quote/webhook-router.ts tests/ai-quote-webhook-router.test.ts
git commit -m "feat(ai-quote): customer AI mode arms — lifecycle, hint, 4 escalation triggers (1b-B)"
```

---

### Task 10: Wire `CustomerAiDeps` ใน LINE route

**Files:**
- Modify: `app/api/ai-quote/line/route.ts`

- [ ] **Step 10.1: Implement**

imports เพิ่ม:

```ts
import { runQuoteTurn, sanitizeHistory } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';
import { loadSession, createLineSession, saveConversation, saveQuote, countQuotes, loadLastQuote, updateLead } from '@/lib/ai-quote/db';
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed } from '@/lib/ai-quote/line-mode';
import { getLineProfile, pushLine } from '@/lib/ai-quote/channels/line';
import { checkRateLimit } from '@/lib/rate-limit';
import type { CustomerAiDeps } from '@/lib/ai-quote/webhook-router';
```

(แก้บรรทัด import เดิมของ `handleInbound` ให้รวม `CustomerAiDeps` type ก็ได้ — อยู่ module เดียวกัน)

constants หลัง `VISION_MODEL`:

```ts
// Same engine decision as the staff route (2026-07-02): Sonnet 5 quote engine,
// Haiku stays on the slip-vision gate. See app/api/ai-quote/route.ts.
const MODEL = 'claude-sonnet-5';
const AI_RATE_LIMIT = { limit: 30, windowSec: 3600 };   // spec §6 — per line_user_id
```

factory ก่อน `POST`:

```ts
function buildCustomerAiDeps(anthropic: Anthropic, quoteUrl: string, quoteToken: string): CustomerAiDeps {
  const staffGroupId = process.env.LINE_STAFF_GROUP_ID || null;
  return {
    loadMode: loadLineMode,
    enterMode: enterLineMode,
    touchMode: touchLineMode,
    exitMode: exitLineMode,
    markHintSent,
    modeActive,
    hintAllowed,
    hintEnabled: process.env.AI_QUOTE_LINE_HINT_ENABLED === 'true',
    checkRateLimit: async (uid) => (await checkRateLimit(`ai-quote-line:${uid}`, AI_RATE_LIMIT)).ok,
    loadSessionForUser: async (id, uid) => {
      const s = await loadSession(id, { lineUserId: uid });
      return s ? { conversation: s.conversation, customerName: s.customerName } : null;
    },
    createSessionForUser: async (uid) => {
      const profile = await getLineProfile(uid);   // best-effort display name
      const s = await createLineSession(uid, profile?.displayName ?? null);
      return { id: s.id, customerName: s.customerName };
    },
    saveConversation,
    saveQuote,
    countQuotes,
    loadLastQuote,
    updateLeadStatus: (sessionId, status) => updateLead(sessionId, { leadStatus: status }),
    runTurn: (history, userMessage) =>
      runQuoteTurn(
        // sanitizeHistory caps replayed turns (LINE conversations grow every
        // turn); slice(0,4000) mirrors the staff route's message cap (M2).
        { history: sanitizeHistory(history), userMessage: userMessage.slice(0, 4000) },
        { client: anthropic, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildCustomerSystemPrompt(), model: MODEL },
      ),
    buildEscalationFlex,
    pushStaff: staffGroupId ? (message) => pushLine(staffGroupId, message) : null,
  };
}
```

ใน `POST` แทนบรรทัด `const aiEnabled = ...`:

```ts
  // AI arms need the quote backend — flag ON without QUOTE_API env degrades
  // safely to 1b-A behaviour (slip/track only).
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  const aiEnabled = process.env.AI_QUOTE_LINE_ENABLED === 'true' && !!quoteUrl && !!quoteToken;
```

และใน object ที่ส่งเข้า `handleInbound` เพิ่มหลัง `aiEnabled,`:

```ts
          aiCustomer: aiEnabled ? buildCustomerAiDeps(anthropic, quoteUrl!, quoteToken!) : undefined,
```

- [ ] **Step 10.2: Gates + commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint && npm run build
git add app/api/ai-quote/line/route.ts
git commit -m "feat(ai-quote): wire customer AI deps into LINE webhook route (1b-B)"
```

---

### Task 11: `/quote-leads` — LINE channel badge

**Files:**
- Modify: `app/quote-leads/quote-leads-client.tsx` (~line 172, ใน cell ลูกค้า)

- [ ] **Step 11.1: Implement** — ใน `<div className="flex items-center gap-1.5">` เพิ่มหลัง escalated badge:

```tsx
                        {l.channel === 'line' && (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                            LINE
                          </span>
                        )}
```

- [ ] **Step 11.2: Gates + commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint
git add app/quote-leads/quote-leads-client.tsx
git commit -m "feat(quote-leads): LINE channel badge (1b-B §4)"
```

---

### Task 12: Full gates + PR

- [ ] **Step 12.1: Full gates (Node 22)**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint && npx vitest run && npm run build
```
Expected: 0 type errors · lint 0 errors (1 pre-existing warn `slip.ts:71` ไม่แตะ) · ~345+ tests PASS · build สำเร็จ (route `ƒ /api/ai-quote/line` ยังอยู่)

- [ ] **Step 12.2: Push + เปิด PR**

```bash
git push -u origin feat/ai-quote-phase1b-b-line-customer
gh pr create --title "AI Quote Phase 1b-B — LINE customer mode (opt-in AI quoting + escalation)" --body "..."
```
PR body: สรุป spec decisions D1-D4 + flag OFF = zero behavior + checklist verification ด้านล่าง

- [ ] **Step 12.3: Docs** (ก่อนปิด session ตาม discipline): NEXT-SESSION.md · dashboard-v2.md version history · AUDIT-BACKLOG.md

---

## Verification (Definition of Done — spec)

**Automated (plan tasks):** gates เขียว Node 22 · tests ครอบ mode lifecycle / hint gate / owner-check / escalation 4 triggers / flag-OFF regression

**Post-merge — คุณนุ๊ก actions (gate ของ soft launch):**
1. Vercel env: `LINE_STAFF_GROUP_ID` (หาด้วย `/groupid` ในกลุ่มพนักงาน) + `AI_QUOTE_LINE_ENABLED=true` → **redeploy** (env live ต่อเมื่อ deploy ใหม่ — [[feedback_ai_quote_phase1a]])
2. รัน `GET /api/admin/db-migrate` หลัง deploy (Chrome MCP ได้) — ตรวจ applied มี `ai_quote_line_modes` + `line_user_id`
3. **Soft-launch smoke บน LINE จริง (§7 จังหวะ 1):** เข้าโหมด (`ขอราคา AI`) → intro · ตีราคา 3 ประเภท · `/track` + สลิประหว่างโหมด (priority ไม่เปลี่ยน) · escalation ทั้ง 4 (ขอคุยกับคน / งานกล่อง / วน 4 รอบ / "สั่งเลย" หลังได้ราคา) → Flex เข้ากลุ่มพนักงาน + lead ใน /quote-leads พร้อม badge LINE · ออกโหมด (`ออก`) · **M5: เครื่อง 2 (LINE account อื่น) เข้าโหมด → ต้องไม่เห็นบทสนทนา/ราคาของเครื่อง 1**
4. จังหวะ 2 (หลัง soak): `AI_QUOTE_LINE_HINT_ENABLED=true` + redeploy + rich menu ใน LINE OA Manager (ปุ่มส่ง text `ขอราคา AI` หรือ postback `ai_quote_start`)

**Rollback:** ตั้ง `AI_QUOTE_LINE_ENABLED=false` + redeploy → พฤติกรรม 1b-A เป๊ะ (slip/track เดิม)
