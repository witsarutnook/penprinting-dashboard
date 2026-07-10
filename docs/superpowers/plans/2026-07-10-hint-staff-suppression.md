# HINT-1 Staff-Activity Suppression (Messenger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** บอทรู้ว่าพนักงานกำลังคุยกับลูกค้าคนไหนอยู่ (Messenger `message_echoes`) → suppress hint 48 ชม. + เตะลูกค้าออกจากโหมด AI เมื่อพนักงานตอบ (takeover) → เปิด `AI_QUOTE_MESSENGER_HINT_ENABLED` คืนได้อย่างปลอดภัย

**Architecture:** echo ที่ `app_id` ไม่ใช่ app เรา = staff ตอบ → เข้า pipeline เดิมเป็น `InboundMessage` kind ใหม่ `'staff-echo'` → `handleInbound` เรียก `recordStaffReply` (upsert เดียว: stamp `last_staff_reply_at` + เคลียร์ mode) — เงียบสนิท. Hint arm เพิ่ม gate `staffActive` (48h) ก่อน 24h gate. Fail-safe ทิศเดียว: `FB_APP_ID` ไม่ตั้ง → skip echo ทุกตัว + hint ปิด (จำแนกพลาด = โหมด AI เด้งหลุดทุกครั้งที่บอทตอบ = ห้ามเสี่ยง)

**Tech Stack:** Next.js 15 App Router · Postgres (`ai_quote_line_modes`) · vitest (mock-postgres helper) · Node 22

**Spec:** [docs/superpowers/specs/2026-07-10-hint-staff-suppression-design.md](../specs/2026-07-10-hint-staff-suppression-design.md) — reviewer ทุกตัวต้อง anchor บน spec นี้ ไม่ใช่ plan ([[feedback_plan_verbatim_review_against_spec]])

**Branch:** `feat/hint-staff-suppression` จาก `main` — commit ต่อ task, PR ตอนจบ

**Gates ทุก task:** รันบน Node 22 (`source ~/.nvm/nvm.sh && nvm use 22`) — vitest ผ่าน `rtk proxy npx vitest run <file>` (rtk filter กลืน output — [[feedback_rtk_git_pull_stale_uptodate]])

---

### Task 1: Pure gate + DB helper (`line-mode.ts`)

**Files:**
- Modify: `lib/ai-quote/line-mode.ts`
- Test: `tests/ai-quote-line-mode.test.ts`

- [ ] **Step 1: Write the failing tests**

แก้ import block ใน `tests/ai-quote-line-mode.test.ts`:

```ts
import {
  modeActive, hintAllowed, staffActive, MODE_IDLE_MINUTES, HINT_GATE_HOURS, STAFF_SUPPRESS_HOURS,
  loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, recordStaffReply,
} from '@/lib/ai-quote/line-mode';
```

เพิ่ม describe ใหม่ต่อท้าย describe `hintAllowed` (ก่อน `mode DB fns`):

```ts
describe('staffActive (48h staff-conversation suppression — HINT-1)', () => {
  it('true when staff replied within the window', () => {
    expect(staffActive(new Date(NOW - min(60)).toISOString(), NOW)).toBe(true);
  });
  it('false once the window lapses', () => {
    expect(staffActive(new Date(NOW - (STAFF_SUPPRESS_HOURS + 1) * 3_600_000).toISOString(), NOW)).toBe(false);
  });
  it('false for null / unparsable timestamps (never throws)', () => {
    expect(staffActive(null, NOW)).toBe(false);
    expect(staffActive('not-a-date', NOW)).toBe(false);
  });
});
```

เพิ่ม 2 เคสใน describe `mode DB fns` + **แก้ expectation ของเคส `loadLineMode maps snake_case row` เดิม** (LineModeRow มี field ใหม่ → toEqual เดิมจะ fail):

```ts
  it('loadLineMode maps snake_case row → LineModeRow', async () => {
    queueResult({ rows: [{ channel_user_id: 'U1', entered_at: 't1', last_activity_at: 't2', session_id: '7', rounds_no_quote: 2, last_hint_at: null, last_staff_reply_at: null }], rowCount: 1 });
    const r = await loadLineMode('U1');
    expect(r).toEqual({ channelUserId: 'U1', enteredAt: 't1', lastActivityAt: 't2', sessionId: 7, roundsNoQuote: 2, lastHintAt: null, lastStaffReplyAt: null });
  });
```

```ts
  it('loadLineMode maps last_staff_reply_at when present', async () => {
    queueResult({ rows: [{ channel_user_id: 'P1', last_staff_reply_at: '2026-07-10T09:00:00Z' }], rowCount: 1 });
    const r = await loadLineMode('P1');
    expect(r?.lastStaffReplyAt).toBe('2026-07-10T09:00:00Z');
  });
  it('recordStaffReply stamps last_staff_reply_at + clears the mode atomically, keeping last_hint_at', async () => {
    await recordStaffReply('PSID9');
    const call = findCallContaining('last_staff_reply_at = NOW()');
    expect(call?.text).toContain('ON CONFLICT (channel_user_id)');
    expect(call?.text).toContain('entered_at = NULL');
    expect(call?.text).toContain('last_activity_at = NULL');
    expect(call?.text).toContain('session_id = NULL');
    expect(call?.text).toContain('rounds_no_quote = 0');
    expect(call?.text).not.toContain('last_hint_at');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && rtk proxy npx vitest run tests/ai-quote-line-mode.test.ts`
Expected: FAIL — `staffActive is not a function` / `recordStaffReply is not a function` + `loadLineMode maps` mismatch

- [ ] **Step 3: Implement in `lib/ai-quote/line-mode.ts`**

เพิ่ม const ใต้ `HINT_GATE_HOURS`:

```ts
export const STAFF_SUPPRESS_HOURS = 48; // HINT-1 — staff replied within → no hint
```

เพิ่ม field ใน `LineModeRow` (ท้าย interface):

```ts
  lastStaffReplyAt: string | null;
```

เพิ่ม pure fn ใต้ `hintAllowed`:

```ts
/** Pure: did staff reply to this customer within the suppression window?
 *  (HINT-1 — Messenger message_echoes). true = never interject with a hint. */
export function staffActive(lastStaffReplyAt: string | null, nowMs: number): boolean {
  if (!lastStaffReplyAt) return false;
  const t = Date.parse(lastStaffReplyAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t <= STAFF_SUPPRESS_HOURS * 3_600_000;
}
```

เพิ่มบรรทัดใน `rowToMode` (ท้าย object):

```ts
    lastStaffReplyAt: toIso(r.last_staff_reply_at),
```

เพิ่ม fn ท้ายไฟล์ (ใต้ `markHintSent`):

```ts
/** Staff replied from the Page inbox (Messenger message_echoes → HINT-1):
 *  stamp the 48h suppression window AND clear the mode in one atomic upsert —
 *  staff takeover stops the AI immediately. Keeps last_hint_at (the 24h hint
 *  gate is an independent axis). Upsert: a customer with no row yet still
 *  gets the suppression window recorded. */
export async function recordStaffReply(channelUserId: string): Promise<void> {
  await sql`
    INSERT INTO ai_quote_line_modes (channel_user_id, last_staff_reply_at)
    VALUES (${channelUserId}, NOW())
    ON CONFLICT (channel_user_id)
    DO UPDATE SET last_staff_reply_at = NOW(),
                  entered_at = NULL, last_activity_at = NULL,
                  session_id = NULL, rounds_no_quote = 0`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run tests/ai-quote-line-mode.test.ts`
Expected: PASS ทุกเคส

- [ ] **Step 5: Commit**

```bash
git add lib/ai-quote/line-mode.ts tests/ai-quote-line-mode.test.ts
git commit -m "feat(ai-quote): staffActive 48h gate + recordStaffReply atomic takeover (HINT-1)"
```

---

### Task 2: Migration — `last_staff_reply_at` column

**Files:**
- Modify: `app/api/admin/db-migrate/route.ts` (~line 442-456 — ai_quote_line_modes section)

- [ ] **Step 1: Add column to CREATE TABLE DDL (fresh installs)**

ใน `CREATE TABLE IF NOT EXISTS ai_quote_line_modes` เพิ่มบรรทัดหลัง `last_hint_at     TIMESTAMPTZ` (ใส่ comma ท้าย last_hint_at):

```ts
        last_hint_at     TIMESTAMPTZ,
        last_staff_reply_at TIMESTAMPTZ
```

- [ ] **Step 2: Add idempotent ALTER (existing DB)**

เพิ่มหลัง `applied.push('CREATE TABLE ai_quote_line_modes');`:

```ts
    // HINT-1 (2026-07-10): staff-activity suppression — staff replied from the
    // Page inbox (Messenger message_echoes) → suppress the out-of-mode hint
    // 48h + clear the mode (takeover). NULL on purpose — no DEFAULT NOW()
    // backfill (that would suppress every existing customer at ALTER time).
    await sql`ALTER TABLE ai_quote_line_modes ADD COLUMN IF NOT EXISTS last_staff_reply_at TIMESTAMPTZ`;
    applied.push('ai_quote_line_modes.last_staff_reply_at column');
```

- [ ] **Step 3: Gates (route ไม่มี unit test — type-check คุม)**

Run: `npm run type-check`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add app/api/admin/db-migrate/route.ts
git commit -m "feat(db): ai_quote_line_modes.last_staff_reply_at (HINT-1, idempotent)"
```

---

### Task 3: Parse — echo classification (`channels/messenger.ts` + `types.ts`)

**Files:**
- Modify: `lib/ai-quote/channels/types.ts` (InboundKind)
- Modify: `lib/ai-quote/channels/messenger.ts` (`MsgrMessaging`, `parseMessengerEvents`)
- Test: `tests/ai-quote-messenger-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

เพิ่มเคสต่อท้าย describe `parseMessengerEvents` (เคส echo-skip เดิมที่ไม่ส่ง `ourAppId` **คงไว้ห้ามแก้** — มันคือ pin ของ fail-safe):

```ts
  // HINT-1: echo classification — only when ourAppId is provided
  it('own-app echo is skipped (the bot echoes every AI reply)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 1234, text: 'AI ตอบ' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([]);
  });
  it('other-app echo → staff-echo carrying the CUSTOMER psid (recipient, not sender)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 263902037430900, text: 'ตอบจาก inbox' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([
      { channel: 'messenger', kind: 'staff-echo', channelUserId: '555' },
    ]);
  });
  it('echo without app_id (Page inbox send) → staff-echo', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '556' }, message: { is_echo: true, text: 'จาก inbox' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([
      { channel: 'messenger', kind: 'staff-echo', channelUserId: '556' },
    ]);
  });
  it('without ourAppId EVERY echo is skipped — fail-safe (misclassified own echo would kick users out of AI mode)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, recipient: { id: '555' }, message: { is_echo: true, app_id: 99, text: 'x' } }]);
    expect(parseMessengerEvents(body)).toEqual([]);
  });
  it('echo without recipient id is dropped (never throws)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, message: { is_echo: true, text: 'x' } }]);
    expect(parseMessengerEvents(body, { ourAppId: '1234' })).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run tests/ai-quote-messenger-parse.test.ts`
Expected: FAIL — echo cases คืน `[]` แทน staff-echo (implementation ยัง skip echo ทุกตัว)

- [ ] **Step 3: Implement**

`lib/ai-quote/channels/types.ts` — แก้ InboundKind + docstring:

```ts
// 'staff-echo' (Messenger message_echoes, HINT-1): staff replied from the Page
// inbox — pure signal, channelUserId = the CUSTOMER psid; never gets a reply.
export type InboundKind = 'text' | 'image' | 'postback' | 'staff-echo';
```

`lib/ai-quote/channels/messenger.ts` — แก้ `MsgrMessaging`:

```ts
interface MsgrMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };   // echo: sender = Page → ลูกค้าอยู่ที่ recipient
  message?: {
    is_echo?: boolean;
    app_id?: number | string;    // echo: app ที่ส่งข้อความนั้น (ไม่มี = Page inbox)
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { payload?: string };
}
```

แก้ signature + echo branch ใน `parseMessengerEvents` — แทนบรรทัด `if (raw.message?.is_echo) continue;` เดิม (ย้ายขึ้นก่อนเช็ค `psid` เพราะ echo ใช้ recipient) และ update docstring ของ fn:

```ts
/** Normalize a Meta Page webhook body → text/image/postback/staff-echo messages.
 *  Messenger is 1-on-1 by nature (no groups → sourceType always undefined).
 *  Echo events (page's own sends): with opts.ourAppId set, an echo whose
 *  app_id ≠ ours (or missing — Page inbox) = staff replied → 'staff-echo'
 *  carrying the CUSTOMER psid (recipient); our own echoes are skipped.
 *  Without ourAppId ALL echoes are skipped (fail-safe: misclassifying our own
 *  echo as staff would kick the user out of AI mode on every bot reply).
 *  quick_reply.payload beats message.text (title truncates at 20 chars).
 *  A text+attachment combo counts as text. Never throws. */
export function parseMessengerEvents(body: unknown, opts?: { ourAppId?: string }): InboundMessage[] {
  const b = body as { object?: string; entry?: Array<{ messaging?: unknown }> };
  if (b?.object !== 'page' || !Array.isArray(b.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of b.entry) {
    const messaging = entry?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const raw of messaging as MsgrMessaging[]) {
      if (raw?.message?.is_echo) {
        const appId = raw.message.app_id == null ? null : String(raw.message.app_id);
        const customer = raw.recipient?.id;
        if (opts?.ourAppId && customer && appId !== opts.ourAppId) {
          out.push({ channel: 'messenger', kind: 'staff-echo', channelUserId: customer });
        }
        continue;   // echo ของบอทเอง / ourAppId ไม่ตั้ง / ไม่มี recipient → ทิ้ง
      }
      const psid = raw?.sender?.id;
      if (!psid) continue;
      const base = { channel: 'messenger' as const, channelUserId: psid };
      // ... (ส่วน text/image/postback เดิมทุกบรรทัด — ห้ามแตะ)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run tests/ai-quote-messenger-parse.test.ts tests/ai-quote-messenger-send.test.ts`
Expected: PASS ทุกเคสรวมเคสเดิม (เคส echo-skip เดิมผ่านเพราะไม่ส่ง ourAppId)

- [ ] **Step 5: Commit**

```bash
git add lib/ai-quote/channels/types.ts lib/ai-quote/channels/messenger.ts tests/ai-quote-messenger-parse.test.ts
git commit -m "feat(ai-quote): classify Messenger echoes → staff-echo kind (HINT-1, fail-safe without FB_APP_ID)"
```

---

### Task 4: Router — staff-echo arm + hint staff gate (`webhook-router.ts`)

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts` (Route union, `routeInbound`, `CustomerAiDeps`, `handleInbound`)
- Test: `tests/ai-quote-webhook-router.test.ts`

- [ ] **Step 1: Write the failing tests**

แก้ fixture ใน `tests/ai-quote-webhook-router.test.ts`:

`ACTIVE_MODE` เพิ่ม field:

```ts
const ACTIVE_MODE = { channelUserId: 'U1', enteredAt: 't', lastActivityAt: 't', sessionId: 7, roundsNoQuote: 0, lastHintAt: null, lastStaffReplyAt: null };
```

`stubAi` เพิ่ม 2 stubs (ใต้ `hintEnabled: true,`):

```ts
    staffActive: () => false,
    recordStaffReply: async () => { calls.push('staff-reply'); },
```

เพิ่มเคส `routeInbound` (ใน describe routing เดิม):

```ts
  it('staff-echo kind routes to staff-echo regardless of aiEnabled/trackEnabled', () => {
    const m: InboundMessage = { channel: 'messenger', channelUserId: '555', kind: 'staff-echo' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('staff-echo');
    expect(routeInbound(m, { aiEnabled: true })).toBe('staff-echo');
  });
```

เพิ่ม describe ใหม่ท้ายไฟล์:

```ts
describe('handleInbound — HINT-1 staff-echo + hint suppression', () => {
  const staffEcho: InboundMessage = { channel: 'messenger', channelUserId: '555', kind: 'staff-echo' };

  it('staff-echo records the staff reply and stays completely silent', async () => {
    const { ai, calls } = stubAi();
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(staffEcho, deps as never);
    expect(calls).toContain('staff-reply');
    expect(replies.length).toBe(0);
  });
  it('staff-echo without aiCustomer deps is a no-op', async () => {
    const { replies, deps } = stubDeps({ aiEnabled: false });
    await expect(handleInbound(staffEcho, deps as never)).resolves.toBeUndefined();
    expect(replies.length).toBe(0);
  });
  it('staff-echo recordStaffReply failure is swallowed (webhook must never 500)', async () => {
    const { ai } = stubAi({ recordStaffReply: async () => { throw new Error('column missing'); } });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await expect(handleInbound(staffEcho, deps as never)).resolves.toBeUndefined();
    expect(replies.length).toBe(0);
  });
  it('hint is silent while a staff conversation is active — and does NOT burn the 24h quota', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, staffActive: () => true });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ สนใจงานพิมพ์'), deps as never);
    expect(calls).not.toContain('hint-sent');
    expect(replies.length).toBe(0);
  });
  it('hint fires again once the staff window lapses', async () => {
    const { ai, calls } = stubAi({ modeActive: () => false, staffActive: () => false });
    const { replies, deps } = stubDeps({ aiEnabled: true, aiCustomer: ai });
    await handleInbound(text1on1('สวัสดีค่ะ'), deps as never);
    expect(calls).toContain('hint-sent');
    expect(replies.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run tests/ai-quote-webhook-router.test.ts`
Expected: FAIL — routeInbound คืน `'ignore'` แทน `'staff-echo'` · staff-echo cases ไม่เรียก recordStaffReply · เคส staff-active hint ยังส่ง hint

- [ ] **Step 3: Implement in `lib/ai-quote/webhook-router.ts`**

Route union:

```ts
export type Route = 'slip' | 'track' | 'track-customer' | 'groupid' | 'ai' | 'enter-ai' | 'exit-ai' | 'staff-echo' | 'ignore';
```

`routeInbound` — บรรทัดแรกของ body:

```ts
  // Staff echo (Messenger message_echoes — HINT-1): pure signal, classified
  // before every other arm; independent of aiEnabled/trackEnabled.
  if (m.kind === 'staff-echo') return 'staff-echo';
```

`CustomerAiDeps` — เพิ่ม 2 fields (ใต้ `hintEnabled: boolean;`):

```ts
  /** true = staff replied to this customer within the 48h suppression window (HINT-1). */
  staffActive: (lastStaffReplyAt: string | null, nowMs: number) => boolean;
  /** Staff replied (Messenger echo): stamp last_staff_reply_at + clear the mode (takeover). */
  recordStaffReply: (uid: string) => Promise<void>;
```

`handleInbound` — เพิ่ม arm หลังบรรทัด `const route = routeInbound(...)` (ก่อน `if (route === 'slip')`):

```ts
  if (route === 'staff-echo') {
    // Silent by design: record the takeover, never reply, never touch the engine.
    // Errors are swallowed (e.g. webhook fires before the column migration) —
    // Meta disables webhooks that keep failing, so this path must never throw.
    try {
      await deps.aiCustomer?.recordStaffReply(m.channelUserId);
    } catch (err) {
      console.error(`[ai-quote/${m.channel}] recordStaffReply failed:`, err instanceof Error ? err.message : err);
    }
    return;
  }
```

Hint arm — แทรก staff gate ระหว่าง `if (!ai.hintEnabled) return;` กับ 24h gate:

```ts
    if (!ai.hintEnabled) return;
    // HINT-1: staff talked to this customer within 48h → never interject.
    // Checked BEFORE the 24h gate so a suppressed hint doesn't burn the quota.
    if (mode && ai.staffActive(mode.lastStaffReplyAt, now)) return;
    if (mode && !ai.hintAllowed(mode.lastHintAt, now)) return;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `rtk proxy npx vitest run tests/ai-quote-webhook-router.test.ts`
Expected: PASS ทุกเคส (เดิม + ใหม่)

- [ ] **Step 5: Commit**

```bash
git add lib/ai-quote/webhook-router.ts tests/ai-quote-webhook-router.test.ts
git commit -m "feat(ai-quote): staff-echo arm (silent takeover) + hint staff-active gate (HINT-1)"
```

---

### Task 5: Route wiring — messenger + LINE

**Files:**
- Modify: `lib/ai-quote/channels/messenger.ts` (`buildMessengerAdapter` — ourAppId param)
- Modify: `app/api/ai-quote/messenger/route.ts`
- Modify: `app/api/ai-quote/line/route.ts` (wiring 2 บรรทัด — zero behavior)

- [ ] **Step 1: `buildMessengerAdapter` รับ ourAppId**

```ts
/** Build the Messenger ChannelAdapter (reply == push — no reply-token concept).
 *  ourAppId (FB_APP_ID) enables echo classification → 'staff-echo' (HINT-1);
 *  omitted = every echo skipped (fail-safe). */
export function buildMessengerAdapter(appSecret: string, ourAppId?: string): ChannelAdapter {
  return {
    verifySignature: (rawBody, sig) => verifyMessengerSignature(rawBody, sig, appSecret),
    parseEvents: (body) => parseMessengerEvents(body, { ourAppId }),
    downloadImage: (msg) => downloadMessengerImage(msg.imageMessageId!),
    reply: (msg, message, qrs) => sendMessenger(msg.channelUserId, message, qrs),
    push: (id, text) => sendMessenger(id, text),
  };
}
```

- [ ] **Step 2: Messenger route (`app/api/ai-quote/messenger/route.ts`)**

แก้ import line-mode (เพิ่ม `staffActive`, `recordStaffReply`):

```ts
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed, staffActive, recordStaffReply } from '@/lib/ai-quote/line-mode';
```

แก้จุดสร้าง adapter ใน `POST`:

```ts
  const adapter = buildMessengerAdapter(appSecret, process.env.FB_APP_ID);
```

ใน `buildCustomerAiDeps` — แก้ `hintEnabled` + wire 2 deps (ใต้ `hintAllowed,`):

```ts
    hintAllowed,
    staffActive,
    recordStaffReply,
    // HINT-1 fail-closed: no FB_APP_ID = echoes can't be classified = the
    // suppression signal doesn't exist → hint must stay off.
    hintEnabled: process.env.AI_QUOTE_MESSENGER_HINT_ENABLED === 'true' && !!process.env.FB_APP_ID,
```

- [ ] **Step 3: LINE route (`app/api/ai-quote/line/route.ts`) — interface compliance เท่านั้น**

แก้ import (เพิ่ม `staffActive`, `recordStaffReply`) + wire ใน `buildCustomerAiDeps` ใต้ `hintAllowed,`:

```ts
    staffActive,       // never true on LINE — no staff-reply signal writes the column
    recordStaffReply,  // unreachable — LINE adapter never emits staff-echo
```

(`hintEnabled` ของ LINE **ห้ามแตะ** — flag ปิดถาวรตาม spec D2)

- [ ] **Step 4: Full gates**

Run: `npm run type-check && npx next lint && rtk proxy npx vitest run && rtk proxy npm run build`
Expected: 0 err / 0 err / ทุก test ผ่าน / build สำเร็จ

- [ ] **Step 5: Commit**

```bash
git add lib/ai-quote/channels/messenger.ts app/api/ai-quote/messenger/route.ts app/api/ai-quote/line/route.ts
git commit -m "feat(ai-quote): wire FB_APP_ID echo classification + staff deps; hint fail-closed without app id (HINT-1)"
```

---

### Task 6: Runbook + PR

**Files:**
- Create: `RUNBOOK-hint1-staff-suppression.md`

- [ ] **Step 1: เขียน runbook**

```markdown
# RUNBOOK — HINT-1: เปิด hint Messenger คืน (staff-activity suppression)

> Spec: docs/superpowers/specs/2026-07-10-hint-staff-suppression-design.md
> ทุก step เป็น user action (คุณนุ๊ก) เว้นที่ระบุ — **ทำตามลำดับ ห้ามข้าม**

## 1. Deploy code
merge PR → Vercel auto-deploy → รอ Ready

## 2. Apply migration
เบราว์เซอร์ admin: `GET https://dashboard.penprinting.co/api/admin/db-migrate`
→ applied ต้องมี `ai_quote_line_modes.last_staff_reply_at column`

## 3. ตั้ง FB_APP_ID + redeploy
- Meta App dashboard (app "AI Quoting") → App ID ตัวเลขบนหัวหน้า dashboard (ค่า public)
- Vercel env `FB_APP_ID` = ตัวเลขนั้น → **Redeploy** (env live ต่อเมื่อ deploy ใหม่)

## 4. Subscribe message_echoes
Meta App dashboard → Messenger → API Settings → Webhooks (Page subscription ของ Penprinting)
→ เพิ่ม field `message_echoes` (คงของเดิม `messages`, `messaging_postbacks` ไว้)

## 5. Verify (critical — ก่อนเปิด hint flag)
- [ ] **บอทไม่เตะตัวเอง**: เข้าโหมด AI (เมนู ☰) → คุย 2-3 เทิร์น → AI ต้องตอบต่อเนื่องไม่หลุดโหมด
      (ถ้าหลุดหลังบอทตอบ = การจำแนก app_id ผิด → ปิด subscribe message_echoes แล้วแจ้ง Claude ทันที)
- [ ] **Takeover**: บัญชี test เข้าโหมด AI → พนักงานตอบจาก Page inbox → ข้อความถัดไปของ test
      ต้องไม่ถูก AI ตอบ (โหมดโดนเคลียร์)
- [ ] **Suppress**: หลังพนักงานตอบ → บัญชี test (นอกโหมด) พิมพ์ข้อความธรรมดา → ต้องไม่มี hint

## 6. เปิด hint
Vercel env `AI_QUOTE_MESSENGER_HINT_ENABLED=true` → **Redeploy**
(⚠️ LINE: `AI_QUOTE_LINE_HINT_ENABLED` ปิดถาวร — ไม่มี staff signal บน LINE, ทางเข้า = rich menu)

## Rollback
`AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy (แบบ incident 7/09) — detector/takeover
คงอยู่ได้ไม่มีพิษ (takeover มีประโยชน์แม้ hint ปิด). ถอนสุด = เอา `message_echoes` ออกจาก subscription
```

- [ ] **Step 2: Commit + push + PR**

```bash
git add RUNBOOK-hint1-staff-suppression.md
git commit -m "docs: HINT-1 rollout runbook"
git push -u origin feat/hint-staff-suppression
gh pr create --title "HINT-1: staff-activity suppression + takeover (Messenger)" --body "..."
```

---

## Verification checklist (ก่อน merge)

- [ ] Gates เขียว Node 22: type-check 0 err · lint 0 err · vitest ทั้ง suite · build
- [ ] Reviewer anchor บน **spec** (ไม่ใช่ plan) — spec §1-§9 ครบ
- [ ] LINE zero behavior change: diff LINE route = import + 2 บรรทัด wiring เท่านั้น
- [ ] เคส echo-skip เดิม (ไม่มี ourAppId) ยังผ่าน — fail-safe pin อยู่
