# AI Quote Phase 1c — Messenger Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> ⚠️ **Reviewer note ([[feedback_plan_verbatim_review_against_spec]]):** ทุก review (per-task + final) ต้องเทียบกับ **spec ต้นทาง** `docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md` ไม่ใช่เทียบกับ plan นี้อย่างเดียว — plan author = single point of failure
>
> ⚠️ **Repo conventions:** git commit ต้องใช้ Node 22 — `source ~/.nvm/nvm.sh && nvm use 22` ใน Bash call เดียวกับ commit ([[feedback_penprinting_dashboard_node22_commit]]). Tests = vitest env node (`npx vitest run <file>`), ไม่มี RTL harness (client .tsx ไม่มี component test — verify โดยโครงสร้าง)

**Goal:** เปิด AI quoting + slip-verify ใน Facebook Messenger ของ Page Penprinting ผ่าน ChannelAdapter ตัวที่ 2 บน pipeline 1b-B เดิม — zero DB migration, zero regression ฝั่ง LINE/dashboard

**Architecture:** `channels/messenger.ts` implement `ChannelAdapter` interface เดิม (signature/parse/send/download) + route `/api/ai-quote/messenger` (GET handshake + POST mirror LINE route) → `handleInbound`/engine/mode/M5/rate-limit reuse ทั้งชุด. จุดแก้ router มีจุดเดียว: `opts.trackEnabled` ปิด track/groupid ฝั่ง Messenger. Slip result = text renderer ใหม่ (Messenger ไม่มี Flex). Escalation push เข้ากลุ่ม LINE พนักงานเดิม + การ์ดบอกช่องทาง

**Tech Stack:** Next.js 15 App Router (route handler + `after()`) · Meta Graph API v23.0 (Send API + webhook) · vitest + mock-postgres helper · Anthropic SDK (เดิม — ไม่แตะ engine)

**Env ใหม่ (คุณนุ๊กตั้งใน Vercel ตอน rollout — ไม่ block dev):** `FB_APP_SECRET` · `FB_PAGE_TOKEN` · `FB_VERIFY_TOKEN` · `AI_QUOTE_MESSENGER_ENABLED` · `AI_QUOTE_MESSENGER_HINT_ENABLED`

---

## File map (ทั้ง phase)

| File | Action | Responsibility |
|---|---|---|
| `lib/ai-quote/channels/messenger.ts` | Create | Meta adapter: signature verify + parse + Send API + download + profile |
| `lib/ai-quote/channels/types.ts` | Modify | docstring `imageMessageId` (Messenger เก็บ attachment URL) |
| `lib/ai-quote/webhook-router.ts` | Modify | `routeInbound` + `HandleDeps` รับ `trackEnabled`; log prefix ตาม channel |
| `lib/ai-quote/db.ts` | Modify | `loadSession` opts generalize `{channel, channelUserId}` + `createMessengerSession` |
| `lib/ai-quote/types.ts` | Modify | `AiQuoteSession.channel` union + docstring `lineUserId` |
| `lib/ai-quote/slip-flex.ts` | Modify | export `classifySlipState`/`fmtAmount`/`fmtDate`/`partyName`/`bankName` (rename `classify` → `classifySlipState`) |
| `lib/ai-quote/slip-messenger.ts` | Create | slip result → Messenger text message 4 สถานะ |
| `lib/ai-quote/escalation-flex.ts` | Modify | `lineUserId` → `channelUserId` + field `channel` + แถว "ช่องทาง" เมื่อ messenger |
| `app/api/ai-quote/messenger/route.ts` | Create | GET handshake + POST webhook + deps wiring |
| `app/api/ai-quote/line/route.ts` | Modify | caller sweep: `loadSession({channel:'line', channelUserId})` |
| `app/quote-leads/quote-leads-client.tsx` | Modify | badge Messenger |
| `RUNBOOK-1c-messenger-setup.md` | Create | Meta app setup + smoke + App Review + rollback (user actions) |
| Tests | Create/Modify | ดูรายละเอียดต่อ task (~35 tests ใหม่) |

---

### Task 0: Branch setup

- [ ] **Step 0.1: สร้าง branch จาก main ล่าสุด**

```bash
cd "/Users/witsarut.p/Desktop/Project Report Penprinting/penprinting-dashboard"
git fetch origin && git checkout main && git pull --ff-only origin main
git checkout -b feat/ai-quote-phase1c-messenger
```

Expected: branch ใหม่ clean จาก origin/main

---

### Task 1: Messenger signature verify

**Files:**
- Create: `lib/ai-quote/channels/messenger.ts`
- Test: `tests/ai-quote-messenger-signature.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// tests/ai-quote-messenger-signature.test.ts
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyMessengerSignature } from '@/lib/ai-quote/channels/messenger';

const SECRET = 'test_app_secret';
function sign(body: string, secret = SECRET): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyMessengerSignature (X-Hub-Signature-256)', () => {
  it('accepts a correctly signed body', () => {
    const body = '{"object":"page","entry":[]}';
    expect(verifyMessengerSignature(body, sign(body), SECRET)).toBe(true);
  });
  it('rejects a tampered body', () => {
    const body = '{"object":"page","entry":[]}';
    expect(verifyMessengerSignature('{"object":"page","entry":[1]}', sign(body), SECRET)).toBe(false);
  });
  it('rejects a signature without the sha256= prefix', () => {
    const body = '{}';
    const bare = crypto.createHmac('sha256', SECRET).update(body, 'utf8').digest('hex');
    expect(verifyMessengerSignature(body, bare, SECRET)).toBe(false);
  });
  it('rejects empty / malformed signature and missing secret', () => {
    expect(verifyMessengerSignature('{}', '', SECRET)).toBe(false);
    expect(verifyMessengerSignature('{}', 'sha256=zznothex', SECRET)).toBe(false);
    expect(verifyMessengerSignature('{}', sign('{}'), '')).toBe(false);
  });
  it('rejects when secret is wrong', () => {
    const body = '{}';
    expect(verifyMessengerSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-signature.test.ts`
Expected: FAIL — `Cannot find module '@/lib/ai-quote/channels/messenger'`

- [ ] **Step 1.3: Write minimal implementation**

```ts
// lib/ai-quote/channels/messenger.ts
// Meta (Facebook Page) Messenger adapter — Phase 1c. Mirrors channels/line.ts:
// pure parse/verify helpers exported for tests, I/O layer + buildMessengerAdapter
// at the bottom. Spec: docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md
import 'server-only';
import crypto from 'node:crypto';
import type { ChannelAdapter, InboundMessage, QuickReply } from './types';

/** Verify Meta webhook signature: header `X-Hub-Signature-256` =
 *  'sha256=' + hex(HMAC-SHA256(rawBody, FB_APP_SECRET)). Constant-time compare;
 *  returns false on any malformed input (never throws). */
export function verifyMessengerSignature(rawBody: string, signature: string, appSecret: string): boolean {
  if (!rawBody || !signature || !appSecret) return false;
  if (!signature.startsWith('sha256=')) return false;
  let expected: Buffer;
  let got: Buffer;
  try {
    expected = crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
    got = Buffer.from(signature.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-signature.test.ts`
Expected: PASS 5/5

- [ ] **Step 1.5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/channels/messenger.ts tests/ai-quote-messenger-signature.test.ts && git commit -m "feat(1c): Messenger webhook signature verify (X-Hub-Signature-256)"
```

---

### Task 2: parseMessengerEvents

**Files:**
- Modify: `lib/ai-quote/channels/messenger.ts` (append)
- Modify: `lib/ai-quote/channels/types.ts:16` (docstring)
- Test: `tests/ai-quote-messenger-parse.test.ts`

- [ ] **Step 2.1: Write the failing test**

```ts
// tests/ai-quote-messenger-parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseMessengerEvents } from '@/lib/ai-quote/channels/messenger';

function page(messaging: unknown[]) {
  return { object: 'page', entry: [{ id: 'PAGE1', messaging }] };
}

describe('parseMessengerEvents', () => {
  it('parses a text message', () => {
    const body = page([{ sender: { id: '24680' }, message: { text: 'ขอราคาโบรชัวร์' } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '24680', kind: 'text', text: 'ขอราคาโบรชัวร์',
    }]);
  });
  it('prefers quick_reply.payload over the (20-char-truncated) title text', () => {
    const body = page([{ sender: { id: '1' }, message: { text: '🤖 เริ่มขอราคา A…', quick_reply: { payload: '/ขอราคา AI' } } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '1', kind: 'text', text: '/ขอราคา AI',
    }]);
  });
  it('parses an image attachment (CDN URL carried in imageMessageId)', () => {
    const body = page([{ sender: { id: '2' }, message: { attachments: [{ type: 'image', payload: { url: 'https://cdn.fb/x.jpg' } }] } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '2', kind: 'image', imageMessageId: 'https://cdn.fb/x.jpg',
    }]);
  });
  it('parses a postback', () => {
    const body = page([{ sender: { id: '3' }, postback: { payload: 'ai_quote_start' } }]);
    expect(parseMessengerEvents(body)).toEqual([{
      channel: 'messenger', channelUserId: '3', kind: 'postback', postbackData: 'ai_quote_start',
    }]);
  });
  it('skips echo events (page/staff-sent messages must never enter the pipeline)', () => {
    const body = page([{ sender: { id: 'PAGE1' }, message: { is_echo: true, text: 'ตอบจาก Page inbox' } }]);
    expect(parseMessengerEvents(body)).toEqual([]);
  });
  it('drops non-image attachments (sticker/audio/file) and events without sender', () => {
    expect(parseMessengerEvents(page([{ sender: { id: '4' }, message: { attachments: [{ type: 'audio', payload: { url: 'https://cdn.fb/a.mp3' } }] } }]))).toEqual([]);
    expect(parseMessengerEvents(page([{ message: { text: 'x' } }]))).toEqual([]);
  });
  it('drops non-page objects and malformed bodies (never throws)', () => {
    expect(parseMessengerEvents({ object: 'instagram', entry: [] })).toEqual([]);
    expect(parseMessengerEvents(null)).toEqual([]);
    expect(parseMessengerEvents({})).toEqual([]);
    expect(parseMessengerEvents({ object: 'page', entry: [{}] })).toEqual([]);
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-parse.test.ts`
Expected: FAIL — `parseMessengerEvents is not exported`

- [ ] **Step 2.3: Implement (append to messenger.ts)**

```ts
interface MsgrMessaging {
  sender?: { id?: string };
  message?: {
    is_echo?: boolean;
    text?: string;
    quick_reply?: { payload?: string };
    attachments?: Array<{ type?: string; payload?: { url?: string } }>;
  };
  postback?: { payload?: string };
}

/** Normalize a Meta Page webhook body → text/image/postback messages.
 *  Messenger is 1-on-1 by nature (no groups → sourceType always undefined).
 *  Echo events (page's own sends, incl. staff replying from Page inbox) are
 *  skipped — we also do NOT subscribe to message_echoes; this is defense in
 *  depth. quick_reply.payload beats message.text (title truncates at 20 chars).
 *  A text+attachment combo counts as text (spec: multi-turn image in AI mode
 *  is out of scope; slip images arrive alone). Never throws. */
export function parseMessengerEvents(body: unknown): InboundMessage[] {
  const b = body as { object?: string; entry?: Array<{ messaging?: unknown }> };
  if (b?.object !== 'page' || !Array.isArray(b.entry)) return [];
  const out: InboundMessage[] = [];
  for (const entry of b.entry) {
    const messaging = entry?.messaging;
    if (!Array.isArray(messaging)) continue;
    for (const raw of messaging as MsgrMessaging[]) {
      const psid = raw?.sender?.id;
      if (!psid) continue;
      if (raw.message?.is_echo) continue;   // page's own message → never process
      const base = { channel: 'messenger' as const, channelUserId: psid };
      const text = raw.message?.quick_reply?.payload ?? raw.message?.text;
      if (typeof text === 'string' && text) {
        out.push({ ...base, kind: 'text', text });
        continue;
      }
      const image = raw.message?.attachments?.find((a) => a?.type === 'image' && a?.payload?.url);
      if (image?.payload?.url) {
        out.push({ ...base, kind: 'image', imageMessageId: image.payload.url });
        continue;
      }
      if (raw.postback?.payload) {
        out.push({ ...base, kind: 'postback', postbackData: raw.postback.payload });
      }
      // อื่นๆ (sticker/audio/file/delivery/read) → ทิ้ง
    }
  }
  return out;
}
```

- [ ] **Step 2.4: Update the shared type docstring** — `lib/ai-quote/channels/types.ts:16` เปลี่ยน

```ts
  imageMessageId?: string;      // kind==='image' (ใช้ดึง content)
```

เป็น

```ts
  imageMessageId?: string;      // kind==='image' — LINE: message id (content API) / Messenger: attachment CDN URL
```

- [ ] **Step 2.5: Run test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-parse.test.ts`
Expected: PASS 7/7

- [ ] **Step 2.6: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/channels/messenger.ts lib/ai-quote/channels/types.ts tests/ai-quote-messenger-parse.test.ts && git commit -m "feat(1c): parse Meta Page webhook events → InboundMessage"
```

---

### Task 3: Messenger I/O layer + adapter builder

**Files:**
- Modify: `lib/ai-quote/channels/messenger.ts` (append)
- Test: `tests/ai-quote-messenger-send.test.ts` (pure builders เท่านั้น — fetch layer ไม่ unit-test ตาม convention เดียวกับ LINE I/O)

- [ ] **Step 3.1: Write the failing test**

```ts
// tests/ai-quote-messenger-send.test.ts
import { describe, it, expect } from 'vitest';
import { buildMessengerSendBody, messengerQuickReplies } from '@/lib/ai-quote/channels/messenger';

describe('messengerQuickReplies', () => {
  it('maps generic {label,text} → {content_type,title,payload}', () => {
    expect(messengerQuickReplies([{ label: '🤖 เริ่มขอราคา AI', text: '/ขอราคา AI' }])).toEqual([
      { content_type: 'text', title: '🤖 เริ่มขอราคา AI', payload: '/ขอราคา AI' },
    ]);
  });
  it('returns undefined for empty/missing list', () => {
    expect(messengerQuickReplies([])).toBeUndefined();
    expect(messengerQuickReplies(undefined)).toBeUndefined();
  });
});

describe('buildMessengerSendBody', () => {
  it('wraps a string as a text message with RESPONSE type', () => {
    expect(buildMessengerSendBody('24680', 'สวัสดีค่ะ')).toEqual({
      recipient: { id: '24680' }, messaging_type: 'RESPONSE', message: { text: 'สวัสดีค่ะ' },
    });
  });
  it('attaches quick replies to a text message', () => {
    const body = buildMessengerSendBody('1', 'hint', [{ label: 'L', text: 'T' }]);
    expect((body.message as Record<string, unknown>).quick_replies).toEqual([
      { content_type: 'text', title: 'L', payload: 'T' },
    ]);
  });
  it('passes a ready-made message object through (e.g. slip text message)', () => {
    expect(buildMessengerSendBody('2', { text: 'สลิปถูกต้อง' })).toEqual({
      recipient: { id: '2' }, messaging_type: 'RESPONSE', message: { text: 'สลิปถูกต้อง' },
    });
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-send.test.ts`
Expected: FAIL — not exported

- [ ] **Step 3.3: Implement (append to messenger.ts)**

```ts
// ─── Messenger I/O layer (Meta Send API — Graph v23.0) ───

const GRAPH_API = 'https://graph.facebook.com/v23.0';

function pageToken(): string {
  const t = process.env.FB_PAGE_TOKEN;
  if (!t) throw new Error('FB_PAGE_TOKEN missing');
  return t;
}

/** Pure: generic quick replies → Messenger quick_replies payload. label →
 *  title (Messenger truncates display at 20 chars); text → payload (full text
 *  comes back via quick_reply.payload — parse prefers it over the title). */
export function messengerQuickReplies(qrs?: QuickReply[]) {
  if (!qrs?.length) return undefined;
  return qrs.map((q) => ({ content_type: 'text', title: q.label, payload: q.text }));
}

/** Pure: build the Send API request body. message = plain text (string) or a
 *  ready-made Messenger message object (e.g. buildSlipMessenger output). */
export function buildMessengerSendBody(
  psid: string, message: string | object, qrs?: QuickReply[],
): Record<string, unknown> {
  const quick_replies = messengerQuickReplies(qrs);
  const msg = typeof message === 'string'
    ? { text: message, ...(quick_replies ? { quick_replies } : {}) }
    : { ...(message as Record<string, unknown>), ...(quick_replies ? { quick_replies } : {}) };
  return { recipient: { id: psid }, messaging_type: 'RESPONSE', message: msg };
}

/** ส่งข้อความหา PSID — Messenger ไม่มี reply token, reply = push เสมอ. */
export async function sendMessenger(psid: string, message: string | object, qrs?: QuickReply[]): Promise<void> {
  const res = await fetch(`${GRAPH_API}/me/messages?access_token=${encodeURIComponent(pageToken())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildMessengerSendBody(psid, message, qrs)),
  });
  if (!res.ok) throw new Error(`Messenger send HTTP ${res.status}`);
}

/** ดึง bytes ของรูปจาก attachment CDN URL (ไม่ต้อง auth). URL หมดอายุได้ —
 *  เรียกทันทีที่ webhook มาถึงเท่านั้น ห้าม defer. */
export async function downloadMessengerImage(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Messenger content HTTP ${res.status}`);
  return res.blob();
}

/** Best-effort profile lookup (display name for lead cards / escalation Flex).
 *  Returns null on ANY failure — must never block the reply path. */
export async function getMessengerProfile(psid: string): Promise<{ displayName: string } | null> {
  try {
    const res = await fetch(`${GRAPH_API}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageToken())}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { first_name?: string; last_name?: string };
    const name = [body.first_name, body.last_name].filter(Boolean).join(' ').trim();
    return name ? { displayName: name } : null;
  } catch {
    return null;
  }
}

/** Build the Messenger ChannelAdapter (reply == push — no reply-token concept). */
export function buildMessengerAdapter(appSecret: string): ChannelAdapter {
  return {
    verifySignature: (rawBody, sig) => verifyMessengerSignature(rawBody, sig, appSecret),
    parseEvents: parseMessengerEvents,
    downloadImage: (msg) => downloadMessengerImage(msg.imageMessageId!),
    reply: (msg, message, qrs) => sendMessenger(msg.channelUserId, message, qrs),
    push: (id, text) => sendMessenger(id, text),
  };
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-messenger-send.test.ts`
Expected: PASS 5/5

- [ ] **Step 3.5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/channels/messenger.ts tests/ai-quote-messenger-send.test.ts && git commit -m "feat(1c): Messenger Send API layer + ChannelAdapter builder"
```

---

### Task 4: routeInbound `trackEnabled` + log prefix ตาม channel

**Files:**
- Modify: `lib/ai-quote/webhook-router.ts:61-81` (routeInbound), `:83-102` (HandleDeps), `:136-137` (handleInbound), log strings `:265-268, :293`
- Test: `tests/ai-quote-webhook-router.test.ts` (เพิ่ม describe ใหม่ — ของเดิมห้ามแก้ expectation)

- [ ] **Step 4.1: Write the failing tests (append to ai-quote-webhook-router.test.ts)**

```ts
describe('routeInbound (Messenger — trackEnabled=false, spec 1c §1)', () => {
  const msgr = { channel: 'messenger' as const, channelUserId: 'PSID1' };
  it('routes images to slip', () => {
    const m: InboundMessage = { ...msgr, kind: 'image', imageMessageId: 'https://cdn.fb/x.jpg' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('slip');
  });
  it('track-shaped text becomes ordinary ai text (no /track on Messenger)', () => {
    const m: InboundMessage = { ...msgr, kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: true, trackEnabled: false })).toBe('ai');
  });
  it('groupid command is ignored when AI off (no /groupid on Messenger)', () => {
    const m: InboundMessage = { ...msgr, kind: 'text', text: '/groupid' };
    expect(routeInbound(m, { aiEnabled: false, trackEnabled: false })).toBe('ignore');
  });
  it('postback ai_quote_start still enters the mode', () => {
    const m: InboundMessage = { ...msgr, kind: 'postback', postbackData: 'ai_quote_start' };
    expect(routeInbound(m, { aiEnabled: true, trackEnabled: false })).toBe('enter-ai');
  });
  it('trackEnabled omitted defaults to true (LINE routing unchanged)', () => {
    const m: InboundMessage = { channel: 'line', channelUserId: 'U1', kind: 'text', text: '/track 202606110' };
    expect(routeInbound(m, { aiEnabled: true })).toBe('track');
  });
});
```

- [ ] **Step 4.2: Run to verify the new describe fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-webhook-router.test.ts`
Expected: FAIL เฉพาะเคสที่ pin พฤติกรรมใหม่ — `track-shaped text → ai` (โค้ดเดิมคืน `track`) + `groupid → ignore` (เดิมคืน `groupid`). เคส slip/postback เขียวอยู่แล้ว (vitest ไม่ type-check — extra prop ใน opts ถูกเมิน) — นั่นคือ signal ที่ถูกต้อง

- [ ] **Step 4.3: Implement router change**

`routeInbound` — เปลี่ยน signature + guard 3 command arms:

```ts
/** Pure routing decision. Phase 1b-A passes aiEnabled=false (AI off): images→slip,
 *  /track→track, /groupid→groupid, everything else→ignore. The 'ai'/'enter-ai'/'exit-ai'
 *  arms are exercised once Phase 1b-B turns aiEnabled on (kept here so the table is total).
 *  trackEnabled (default true = LINE) gates the command arms — Messenger (1c D1)
 *  passes false: track/groupid text falls through as ordinary text (ai arm / ignore). */
export function routeInbound(m: InboundMessage, opts: { aiEnabled: boolean; trackEnabled?: boolean }): Route {
  const trackEnabled = opts.trackEnabled ?? true;
  // Explicit commands work anywhere (1-on-1 and groups/rooms):
  //   /groupid → echo the group id · /track <id> → status card (customers can track in their own group)
  if (trackEnabled && m.kind === 'text' && m.text && isGroupIdCommand(m.text)) return 'groupid';
  if (trackEnabled && m.kind === 'text' && m.text) {
    const cmd = parseTrackCommand(m.text);
    if (cmd?.kind === 'order') return 'track';                                  // /track <id> — anywhere
    if (cmd?.kind === 'customer' && (m.sourceType === 'group' || m.sourceType === 'room')) return 'track-customer';
  }
  // ... (ส่วนที่เหลือเดิมเป๊ะ)
```

`HandleDeps` — เพิ่ม field หลัง `aiEnabled: boolean;`:

```ts
  aiEnabled: boolean;
  /** false = ปิด track/groupid command arms (Messenger — spec 1c D1). Default true (LINE). */
  trackEnabled?: boolean;
```

`handleInbound` บรรทัดแรก — ส่งต่อ:

```ts
  const route = routeInbound(m, { aiEnabled: deps.aiEnabled, trackEnabled: deps.trackEnabled });
```

Log prefixes ใน `handleInbound` (3 จุด: escalation push failed / LINE_STAFF_GROUP_ID unset / engine turn failed) — เปลี่ยน literal `[ai-quote/line]` เป็น template ตาม channel:

```ts
console.error(`[ai-quote/${m.channel}] escalation push failed:`, err instanceof Error ? err.message : err);
// ...
console.error(`[ai-quote/${m.channel}] LINE_STAFF_GROUP_ID unset — escalation NOT pushed (lead #${sid})`);
// ...
console.error(`[ai-quote/${m.channel}] engine turn failed:`, err instanceof Error ? err.message : err);
```

- [ ] **Step 4.4: Run the full router suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-webhook-router.test.ts`
Expected: PASS ทั้งไฟล์ — describe เดิมเขียวโดยไม่แก้ expectation (default trackEnabled=true)

- [ ] **Step 4.5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/webhook-router.ts tests/ai-quote-webhook-router.test.ts && git commit -m "feat(1c): routeInbound trackEnabled gate + channel-aware log prefix"
```

---

### Task 5: db generalize — loadSession `{channel, channelUserId}` + createMessengerSession

**Files:**
- Modify: `lib/ai-quote/db.ts:68-78` (loadSession), `:11` (rowToSession cast)
- Modify: `lib/ai-quote/types.ts:44-45` (channel union + docstring)
- Modify: `app/api/ai-quote/line/route.ts:46` (caller sweep)
- Test: Create `tests/ai-quote-db-messenger.test.ts` + Modify `tests/ai-quote-db-line.test.ts`

- [ ] **Step 5.1: Write the failing tests**

```ts
// tests/ai-quote-db-messenger.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockPostgres, queueResult, findCallContaining, sqlCalls } from './helpers/mock-postgres';

vi.mock('@/lib/postgres', () => import('./helpers/mock-postgres'));

import { loadSession, createMessengerSession } from '@/lib/ai-quote/db';

describe('loadSession owner-check — messenger channel (M5, 1c §2)', () => {
  beforeEach(() => resetMockPostgres());

  it('filters on channel AND line_user_id (PSID) in one WHERE', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'messenger', channelUserId: '24680' });
    const call = sqlCalls[0];
    expect(call.text).toContain('channel =');
    expect(call.text).toContain('line_user_id =');
    expect(call.values).toContain('messenger');
    expect(call.values).toContain('24680');
  });
  it('returns null on owner mismatch (never leaks existence)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadSession(7, { channel: 'messenger', channelUserId: 'someone-else' })).toBeNull();
  });
  it('channelUserId without channel fails CLOSED (channel = NULL never matches)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channelUserId: '24680' });
    expect(sqlCalls[0].values).toContain(null);
  });
});

describe('createMessengerSession', () => {
  beforeEach(() => resetMockPostgres());

  it("inserts channel='messenger' + PSID owner + contact 'Messenger'", async () => {
    queueResult({ rows: [{ id: 11, channel: 'messenger', conversation: [], lead_status: 'ใหม่', line_user_id: '24680', customer_name: 'John D', customer_contact: 'Messenger', created_at: 't', updated_at: 't' }], rowCount: 1 });
    const s = await createMessengerSession('24680', 'John D');
    expect(s.id).toBe(11);
    expect(s.channel).toBe('messenger');
    expect(s.lineUserId).toBe('24680');
    const call = findCallContaining('INSERT INTO ai_quote_sessions');
    expect(call?.text).toContain("'messenger'");
    expect(call?.text).toContain("'Messenger'");
    expect(call?.values).toContain('24680');
  });
});
```

แก้ `tests/ai-quote-db-line.test.ts` (opts รูปใหม่ — M5 semantics เดิมเป๊ะ):

```ts
  it('with channelUserId filters on channel=line AND line_user_id', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'line', channelUserId: 'U-A' });
    const call = sqlCalls[0];
    expect(call.text).toContain('channel =');
    expect(call.values).toContain('line');
    expect(call.text).toContain('line_user_id =');
    expect(call.values).toContain('U-A');
  });
  it('returns null on owner mismatch (empty result — never leaks existence)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    expect(await loadSession(7, { channel: 'line', channelUserId: 'U-B' })).toBeNull();
  });
  it('without channelUserId keeps the channel-only scope (staff route unchanged)', async () => {
    queueResult({ rows: [], rowCount: 0 });
    await loadSession(7, { channel: 'dashboard' });
    expect(sqlCalls[0].text).not.toContain('line_user_id');
  });
```

- [ ] **Step 5.2: Run to verify both db test files fail**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-db-messenger.test.ts tests/ai-quote-db-line.test.ts`
Expected: FAIL — `channelUserId`/`createMessengerSession` ยังไม่มี

- [ ] **Step 5.3: Implement**

`lib/ai-quote/types.ts:44-45`:

```ts
  channel: 'dashboard' | 'line' | 'messenger';
  /** Channel-scoped owner binding (M5) — LINE userId หรือ Messenger PSID;
   *  non-null เฉพาะ chat channels. ชื่อ column `line_user_id` เป็น historical
   *  (1b-B) — ไม่ rename กลางอากาศ (spec 1c §2). */
```

`lib/ai-quote/db.ts` — rowToSession cast:

```ts
    channel: (r.channel as 'dashboard' | 'line' | 'messenger') ?? 'dashboard',
```

`loadSession` แทนทั้งฟังก์ชัน:

```ts
/** Load a session by id. Pass `opts.channel` to scope the lookup to a single
 *  channel — the staff chat route passes 'dashboard' so a staff sessionId can
 *  never cross-load a chat-channel session (and vice-versa). Pass
 *  `opts.channelUserId` (chat webhook flows) for the full M5 owner-check:
 *  the session is returned only when channel matches AND the webhook-verified
 *  sender owns it — mismatch → null, indistinguishable from not-found (never
 *  leaks existence). channelUserId requires channel; omitting channel binds
 *  `channel = NULL` which never matches (fail closed). Column line_user_id
 *  stores the channel-scoped user id (LINE userId / Messenger PSID) — the
 *  name is historical. See design-ai-quoting.md §7 + spec 1c §2. */
export async function loadSession(
  id: number,
  opts?: { channel?: 'dashboard' | 'line' | 'messenger'; channelUserId?: string },
): Promise<AiQuoteSession | null> {
  const { rows } = opts?.channelUserId
    ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = ${opts.channel ?? null} AND line_user_id = ${opts.channelUserId}`
    : opts?.channel
      ? await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id} AND channel = ${opts.channel}`
      : await sql`SELECT * FROM ai_quote_sessions WHERE id = ${id}`;
  return rows[0] ? rowToSession(rows[0]) : null;
}
```

เพิ่มท้ายไฟล์ (หลัง createLineSession):

```ts
/** Create a Messenger-channel session bound to its webhook-verified owner
 *  (M5 — mirror createLineSession). line_user_id stores the PSID. */
export async function createMessengerSession(psid: string, displayName?: string | null): Promise<AiQuoteSession> {
  const { rows } = await sql`
    INSERT INTO ai_quote_sessions (channel, line_user_id, conversation, lead_status, customer_name, customer_contact)
    VALUES ('messenger', ${psid}, '[]'::jsonb, 'ใหม่', ${displayName ?? null}, 'Messenger')
    RETURNING *`;
  return rowToSession(rows[0]);
}
```

Caller sweep — `app/api/ai-quote/line/route.ts:46` ใน `loadSessionForUser`:

```ts
      const s = await loadSession(id, { channel: 'line', channelUserId: uid });
```

จากนั้น grep ยืนยันไม่มี caller `lineUserId` เหลือ: `/usr/bin/grep -rn "lineUserId" app/ lib/ --include="*.ts" --include="*.tsx"` — ที่เหลือต้องเป็นแค่ type field ใน types.ts + escalation-flex (จะ generalize ใน Task 6.5/7)

- [ ] **Step 5.4: Run both db test files**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-db-messenger.test.ts tests/ai-quote-db-line.test.ts`
Expected: PASS ทั้งคู่

- [ ] **Step 5.5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/db.ts lib/ai-quote/types.ts app/api/ai-quote/line/route.ts tests/ai-quote-db-messenger.test.ts tests/ai-quote-db-line.test.ts && git commit -m "feat(1c): generalize loadSession owner-check to {channel, channelUserId} + createMessengerSession"
```

---

### Task 6: Slip text renderer (Messenger)

**Files:**
- Modify: `lib/ai-quote/slip-flex.ts` (export `classifySlipState` + formatters — rename `classify` → `classifySlipState`, ใส่ `export` หน้า `fmtAmount`/`fmtDate`/`partyName`/`bankName`; internal call sites อัปเดตตาม — zero behavior change, suite `ai-quote-slip-flex.test.ts` ต้องเขียวโดยไม่แก้)
- Create: `lib/ai-quote/slip-messenger.ts`
- Test: `tests/ai-quote-slip-messenger.test.ts`

- [ ] **Step 6.1: Write the failing test**

```ts
// tests/ai-quote-slip-messenger.test.ts
import { describe, it, expect } from 'vitest';
import { buildSlipMessenger } from '@/lib/ai-quote/slip-messenger';

const success = {
  success: true,
  data: {
    isDuplicate: false, isAccountMatched: true,
    rawSlip: {
      amount: { amount: 1500 }, date: '2026-07-08T03:00:00Z',
      sender: { account: { name: { th: 'สมชาย ใจดี' } }, bank: { name: 'กสิกรไทย' } },
      receiver: { account: { name: { th: 'เพ็ญพรินติ้ง' }, number: '123-4' } },
    },
  },
};

describe('buildSlipMessenger (4 states — copy mirrors slip-flex)', () => {
  it('success → ✅ + amount + sender + bank', () => {
    const m = buildSlipMessenger(success as never);
    expect(m.text).toContain('✅');
    expect(m.text).toContain('฿1,500.00');
    expect(m.text).toContain('สมชาย ใจดี');
    expect(m.text).toContain('กสิกรไทย');
  });
  it('duplicate → เคยส่งแล้ว + แจ้งทีมงาน', () => {
    const m = buildSlipMessenger({ success: true, data: { isDuplicate: true, rawSlip: { amount: { amount: 500 } } } } as never);
    expect(m.text).toContain('เคยส่งแล้ว');
    expect(m.text).toContain('฿500.00');
  });
  it('mismatch → recheck copy, never exposes the destination account (D4)', () => {
    const m = buildSlipMessenger({ success: true, data: { isDuplicate: false, isAccountMatched: false, rawSlip: { receiver: { account: { number: '999-9' } } } } } as never);
    expect(m.text).toContain('ไม่ตรงบัญชี');
    expect(m.text).not.toContain('999-9');
  });
  it('unreadable → resend guidance; null-safe on empty result', () => {
    const m = buildSlipMessenger({ success: false } as never);
    expect(m.text).toContain('ไม่สามารถยืนยันสลิป');
    expect(m.text).toContain('ส่งรูปสลิปใหม่');
  });
});
```

- [ ] **Step 6.2: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-slip-messenger.test.ts`
Expected: FAIL — module ไม่มี

- [ ] **Step 6.3: Export shared helpers from slip-flex.ts**

ใน `lib/ai-quote/slip-flex.ts`: rename `classify` → `classifySlipState` (declaration + 1 call site ใน `buildSlipFlex`) แล้วใส่ `export` หน้า `classifySlipState`, `fmtAmount`, `fmtDate`, `partyName`, `bankName` + export type State:

```ts
export type SlipState = 'success' | 'duplicate' | 'mismatch' | 'unreadable';
// (แทน `type State = ...` เดิม — อัปเดต annotation ภายในไฟล์ตาม)

/** Mirror formatSlipReply priority exactly so the card + its altText always agree. */
export function classifySlipState(r: ThunderVerifyResponse): SlipState { /* body เดิม */ }
export function fmtAmount(n?: number): string | null { /* body เดิม */ }
export function fmtDate(iso?: string): string | null { /* body เดิม */ }
export function partyName(p?: Party): string { /* body เดิม */ }
export function bankName(p?: Party): string | undefined { /* body เดิม */ }
```

- [ ] **Step 6.4: Create slip-messenger.ts**

```ts
// lib/ai-quote/slip-messenger.ts
// Slip-verify result → Messenger text message (Phase 1c). Messenger has no
// LINE Flex — plain text with the same 4-state copy as slip-flex.ts.
// classify + formatters are imported from slip-flex so the LINE card and the
// Messenger text can never disagree. Pure + total: never throws, null-safe.
import { classifySlipState, fmtAmount, fmtDate, partyName, bankName } from './slip-flex';
import type { ThunderVerifyResponse } from './slip';

/** Build the Messenger message object for a slip-verify result — ready for
 *  adapter.reply(). The messenger route injects this as deps.buildSlipFlex. */
export function buildSlipMessenger(result: ThunderVerifyResponse): Record<string, unknown> {
  const state = classifySlipState(result);
  const raw = result.data?.rawSlip;
  const amount = fmtAmount(raw?.amount?.amount);
  const lines: string[] = [];
  if (state === 'success') {
    lines.push('✅ สลิปถูกต้องค่ะ');
    if (amount) lines.push(`ยอดโอน ${amount}`);
    const date = fmtDate(raw?.date ?? raw?.transDate);
    if (date) lines.push(date);
    const sender = partyName(raw?.sender);
    if (sender !== '-') lines.push(`จาก ${[sender, bankName(raw?.sender)].filter(Boolean).join(' · ')}`);
    lines.push('ขอบคุณค่ะ 🙏');
  } else if (state === 'duplicate') {
    lines.push('⚠️ สลิปนี้เคยส่งแล้วค่ะ');
    if (amount) lines.push(`ยอดโอน ${amount}`);
    lines.push('ถ้าเป็นการโอนใหม่ รบกวนแจ้งทีมงานเพิ่มเติมนะคะ 🙏');
  } else if (state === 'mismatch') {
    // D4: never expose the mistaken destination account
    lines.push('❌ ยอดนี้ดูไม่ตรงบัญชีของร้านค่ะ 🙏');
    lines.push('รบกวนตรวจสอบเลขบัญชีปลายทางอีกครั้งนะคะ');
  } else {
    lines.push('ระบบไม่สามารถยืนยันสลิปได้');
    lines.push('รบกวนส่งรูปสลิปใหม่ให้ชัดเจน');
    lines.push('หรือรอทีมงานตรวจสอบอีกครั้ง');
  }
  return { text: lines.join('\n') };
}
```

- [ ] **Step 6.5: Run new suite + slip-flex regression**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-slip-messenger.test.ts tests/ai-quote-slip-flex.test.ts`
Expected: PASS ทั้งคู่ — slip-flex suite เขียว**โดยไม่แก้ไฟล์ test** (พิสูจน์ rename/export = zero behavior)

- [ ] **Step 6.6: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/slip-flex.ts lib/ai-quote/slip-messenger.ts tests/ai-quote-slip-messenger.test.ts && git commit -m "feat(1c): Messenger slip text renderer (shared classify/formatters from slip-flex)"
```

---

### Task 7: Escalation Flex — channel field + แถว "ช่องทาง"

**Files:**
- Modify: `lib/ai-quote/escalation-flex.ts:10-17` (input) + `:39-45` (body rows)
- Modify: `lib/ai-quote/webhook-router.ts:263` (call site)
- Test: Modify `tests/ai-quote-escalation-flex.test.ts` (+ grep `lineUserId` ใน tests อื่นแล้วอัปเดต)

- [ ] **Step 7.1: Write the failing test (append/adjust ai-quote-escalation-flex.test.ts)**

อัปเดต input fixtures เดิมจาก `lineUserId: '...'` → `channel: 'line', channelUserId: '...'` แล้วเพิ่ม:

```ts
  it('messenger escalation carries a "ช่องทาง" row pointing staff to Page inbox', () => {
    const flex = buildEscalationFlex({
      trigger: 'human', customerName: 'John D', channel: 'messenger', channelUserId: '24680',
      lastUserText: 'ขอคุยกับทีมงาน', lastQuote: null, sessionId: 42,
    });
    expect(JSON.stringify(flex)).toContain('ช่องทาง');
    expect(JSON.stringify(flex)).toContain('Messenger');
  });
  it('line escalation has NO channel row (zero visual change vs 1b-B)', () => {
    const flex = buildEscalationFlex({
      trigger: 'human', customerName: null, channel: 'line', channelUserId: 'U1',
      lastUserText: 'x', lastQuote: null, sessionId: 1,
    });
    expect(JSON.stringify(flex)).not.toContain('ช่องทาง');
  });
```

- [ ] **Step 7.2: Run to verify it fails**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-escalation-flex.test.ts`
Expected: FAIL — เคส messenger แดง (impl เดิมไม่มีแถว "ช่องทาง"); เคส line (not.toContain) เขียวอยู่แล้ว

- [ ] **Step 7.3: Implement**

`escalation-flex.ts` input:

```ts
export interface EscalationFlexInput {
  trigger: TriggerType;
  customerName: string | null;
  /** Webhook-verified sender id — LINE userId หรือ Messenger PSID. */
  channelUserId: string;
  channel: 'line' | 'messenger';
  lastUserText: string;
  lastQuote: { productType: string; unitPrice: number } | null;
  sessionId: number;
}
```

ใน `buildEscalationFlex`: `const who = input.customerName || input.channelUserId;` และเพิ่มแถวหลัง `kvRow('เหตุผล', ...)`:

```ts
  if (input.channel === 'messenger') {
    body.push(kvRow('ช่องทาง', 'Facebook Messenger — ตอบต่อใน Page inbox'));
  }
```

`webhook-router.ts:263` call site:

```ts
        await ai.pushStaff(ai.buildEscalationFlex({ trigger, customerName, channel: m.channel, channelUserId: uid, lastUserText: text, lastQuote, sessionId: sid }));
```

grep sweep: `/usr/bin/grep -rn "lineUserId" lib/ tests/ app/ --include="*.ts" --include="*.tsx"` — เหลือได้เฉพาะ `types.ts` (AiQuoteSession field — ชื่อ TS field เดิม `lineUserId` คงไว้, docstring อัปเดตแล้วใน Task 5) + `db.ts` rowToSession. Router escalate test stubs ที่ destructure input → อัปเดตตาม

- [ ] **Step 7.4: Run escalation + router suites**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npx vitest run tests/ai-quote-escalation-flex.test.ts tests/ai-quote-webhook-router.test.ts`
Expected: PASS ทั้งคู่

- [ ] **Step 7.5: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add lib/ai-quote/escalation-flex.ts lib/ai-quote/webhook-router.ts tests/ai-quote-escalation-flex.test.ts tests/ai-quote-webhook-router.test.ts && git commit -m "feat(1c): escalation card carries channel — Messenger leads point staff to Page inbox"
```

---

### Task 8: /quote-leads badge Messenger

**Files:**
- Modify: `app/quote-leads/quote-leads-client.tsx:178-182` (หลัง block badge LINE)

- [ ] **Step 8.1: Implement (ไม่มี component test — repo ไม่มี RTL harness, verify โดยโครงสร้าง + type-check)**

เพิ่มต่อจาก block `{l.channel === 'line' && (...)}`:

```tsx
                        {l.channel === 'messenger' && (
                          <span className="inline-flex items-center rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-blue-200">
                            Messenger
                          </span>
                        )}
```

(union `'messenger'` ผ่าน `AiQuoteSession.channel` จาก Task 5 — ไม่ต้องแก้ type ที่นี่; ถ้า type-check ฟ้องแปลว่า LeadRow ไม่ได้มาจาก types.ts → ตามไปแก้ที่ประกาศจริง)

- [ ] **Step 8.2: Type-check**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check`
Expected: 0 errors

- [ ] **Step 8.3: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add app/quote-leads/quote-leads-client.tsx && git commit -m "feat(1c): Messenger badge on /quote-leads"
```

---

### Task 9: Messenger webhook route

**Files:**
- Create: `app/api/ai-quote/messenger/route.ts`
- Verify: `middleware.ts` matcher ไม่ครอบ `/api/*` (convention — webhook ต้อง public เหมือน LINE route; แค่ grep ยืนยัน ไม่แก้)

- [ ] **Step 9.1: Implement route (mirror LINE route — logic อยู่ใน lib หมดแล้ว, route ไม่มี unit test ตาม convention)**

```ts
// app/api/ai-quote/messenger/route.ts
import { NextResponse, type NextRequest, after } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { buildMessengerAdapter, getMessengerProfile } from '@/lib/ai-quote/channels/messenger';
import { handleInbound, type HandleDeps, type CustomerAiDeps } from '@/lib/ai-quote/webhook-router';
import { isSlipImage, verifyBankSlipImage } from '@/lib/ai-quote/slip';
import { buildSlipMessenger } from '@/lib/ai-quote/slip-messenger';
import { recordSlipCheck } from '@/lib/ai-quote/slip-metrics';
import { runQuoteTurn, sanitizeHistory } from '@/lib/ai-quote/run';
import { runComputeQuote } from '@/lib/ai-quote/tools';
import { buildCustomerSystemPrompt } from '@/lib/ai-quote/prompt-customer';
import { buildEscalationFlex } from '@/lib/ai-quote/escalation-flex';
import { loadSession, createMessengerSession, saveConversation, saveQuote, countQuotes, loadLastQuote, updateLead } from '@/lib/ai-quote/db';
import { loadLineMode, enterLineMode, touchLineMode, exitLineMode, markHintSent, modeActive, hintAllowed } from '@/lib/ai-quote/line-mode';
import { pushLine } from '@/lib/ai-quote/channels/line';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const VISION_MODEL = 'claude-haiku-4-5';
// Same engine decision as LINE/staff (2026-07-02): Sonnet 5 quote engine,
// Haiku on the slip-vision gate.
const MODEL = 'claude-sonnet-5';
const AI_RATE_LIMIT = { limit: 30, windowSec: 3600 };   // spec 1c §2 — per PSID

// track/groupid ปิดฝั่ง Messenger (spec 1c D1) — deps เหล่านี้ unreachable เมื่อ
// trackEnabled=false; stub-throw กันเรียกพลาดเงียบๆ ถ้า routing เปลี่ยนในอนาคต
function unreachable(name: string): never {
  throw new Error(`[ai-quote/messenger] ${name} unreachable (trackEnabled=false, 2026-07-08)`);
}

function buildCustomerAiDeps(anthropic: Anthropic, quoteUrl: string, quoteToken: string): CustomerAiDeps {
  const staffGroupId = process.env.LINE_STAFF_GROUP_ID || null;
  return {
    // mode table (ai_quote_line_modes) is keyed on channel_user_id — PSID rows
    // coexist with LINE userIds (ID spaces disjoint: 'U'+hex vs numeric)
    loadMode: loadLineMode,
    enterMode: enterLineMode,
    touchMode: touchLineMode,
    exitMode: exitLineMode,
    markHintSent,
    modeActive,
    hintAllowed,
    hintEnabled: process.env.AI_QUOTE_MESSENGER_HINT_ENABLED === 'true',
    checkRateLimit: async (uid) => (await checkRateLimit(`ai-quote-msgr:${uid}`, AI_RATE_LIMIT)).ok,
    loadSessionForUser: async (id, uid) => {
      const s = await loadSession(id, { channel: 'messenger', channelUserId: uid });
      return s ? { conversation: s.conversation, customerName: s.customerName } : null;
    },
    createSessionForUser: async (uid) => {
      const profile = await getMessengerProfile(uid);   // best-effort display name
      const s = await createMessengerSession(uid, profile?.displayName ?? null);
      return { id: s.id, customerName: s.customerName };
    },
    saveConversation,
    saveQuote,
    countQuotes,
    loadLastQuote,
    updateLeadStatus: (sessionId, status) => updateLead(sessionId, { leadStatus: status }),
    runTurn: (history, userMessage) =>
      runQuoteTurn(
        { history: sanitizeHistory(history), userMessage: userMessage.slice(0, 4000) },
        { client: anthropic, compute: (inp) => runComputeQuote(inp, { url: quoteUrl, token: quoteToken }), systemPrompt: buildCustomerSystemPrompt(), model: MODEL },
      ),
    buildEscalationFlex,
    // escalation ยัง push เข้ากลุ่ม LINE พนักงานเดิม (spec 1c D3)
    pushStaff: staffGroupId ? (message) => pushLine(staffGroupId, message) : null,
  };
}

async function blobToBase64(b: Blob): Promise<{ data: string; mediaType: string }> {
  const buf = Buffer.from(await b.arrayBuffer());
  return { data: buf.toString('base64'), mediaType: b.type || 'image/jpeg' };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.FB_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: 'not configured' }, { status: 500 });

  const rawBody = await req.text();
  const adapter = buildMessengerAdapter(appSecret);
  if (!adapter.verifySignature(rawBody, req.headers.get('x-hub-signature-256') ?? '')) {
    return new NextResponse('unauthorized', { status: 401 });
  }

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ ok: true }); }
  const messages = adapter.parseEvents(body);
  if (messages.length === 0) return NextResponse.json({ ok: true });

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // AI arms need the quote backend + Anthropic key — flag ON with any env
  // missing degrades safely to slip-only (mirror LINE route guard).
  const quoteUrl = process.env.QUOTE_API_URL;
  const quoteToken = process.env.QUOTE_API_TOKEN;
  const aiEnabled = process.env.AI_QUOTE_MESSENGER_ENABLED === 'true'
    && !!quoteUrl && !!quoteToken && !!process.env.ANTHROPIC_API_KEY;

  // ตอบ 200 ทันที → งานหนัก (Haiku/Thunder/engine) ใน after() แล้วส่งผ่าน Send API
  after(async () => {
    for (const m of messages) {
      try {
        await handleInbound(m, {
          adapter,
          blobToBase64,
          isSlipImage: isSlipImage as HandleDeps['isSlipImage'],
          verifyBankSlipImage,
          // Messenger ไม่มี Flex — slip result เป็น text message (spec 1c §3)
          buildSlipFlex: buildSlipMessenger,
          loadOrder: (() => unreachable('loadOrder')) as unknown as HandleDeps['loadOrder'],
          buildOrderFlex: (() => unreachable('buildOrderFlex')) as HandleDeps['buildOrderFlex'],
          loadRegistrationByGroup: (() => unreachable('loadRegistrationByGroup')) as unknown as HandleDeps['loadRegistrationByGroup'],
          loadActiveJobsByCustomer: (() => unreachable('loadActiveJobsByCustomer')) as unknown as HandleDeps['loadActiveJobsByCustomer'],
          buildCustomerJobsFlex: (() => unreachable('buildCustomerJobsFlex')) as unknown as HandleDeps['buildCustomerJobsFlex'],
          recordSlipCheck,
          anthropic,
          visionModel: VISION_MODEL,
          aiEnabled,
          trackEnabled: false,   // spec 1c D1 — no /track /groupid on Messenger
          aiCustomer: aiEnabled ? buildCustomerAiDeps(anthropic, quoteUrl!, quoteToken!) : undefined,
        });
      } catch (err) {
        console.error('[ai-quote/messenger] handleInbound failed:', err instanceof Error ? err.message : err);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

/** Meta webhook verification handshake (GET ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...)
 *  → echo hub.challenge เมื่อ token ตรง. เรียกครั้งเดียวตอน subscribe ใน app dashboard.
 *  ไม่มี hub params = health probe (mirror LINE route GET). */
export function GET(req: NextRequest): NextResponse {
  const p = req.nextUrl.searchParams;
  if (p.get('hub.mode') === 'subscribe') {
    const expected = process.env.FB_VERIFY_TOKEN;
    if (expected && p.get('hub.verify_token') === expected) {
      return new NextResponse(p.get('hub.challenge') ?? '', { status: 200 });
    }
    return new NextResponse('forbidden', { status: 403 });
  }
  return NextResponse.json({ ok: true, service: 'penprinting messenger webhook' });
}
```

- [ ] **Step 9.2: Verify middleware ไม่ครอบ webhook**

Run: `/usr/bin/grep -n "matcher" middleware.ts`
Expected: matcher ไม่มี pattern ที่ครอบ `/api/ai-quote/*` (LINE webhook public อยู่แล้ว — pattern เดียวกัน)

- [ ] **Step 9.3: Full gates**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: type-check 0 err · lint 0 err (1 warn `slip.ts:71` pre-existing) · tests เขียวทั้ง suite (373 + ~32 ใหม่) · build ผ่าน

- [ ] **Step 9.4: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add app/api/ai-quote/messenger/route.ts && git commit -m "feat(1c): Messenger webhook route — GET handshake + POST pipeline wiring"
```

---

### Task 10: Runbook (user actions — Meta app setup / smoke / App Review / rollback)

**Files:**
- Create: `RUNBOOK-1c-messenger-setup.md` (repo root — convention เดียวกับ `RUNBOOK-1b-a-cutover.md`)

- [ ] **Step 10.1: เขียน runbook** — เนื้อหาต้องครอบ (เขียนเต็มใน execute — โครง + สาระสำคัญบังคับตามนี้):

```markdown
# RUNBOOK — Phase 1c Messenger setup (คุณนุ๊ก actions)

## จังหวะ 0 — Meta app prep
1. เข้า developers.facebook.com ด้วย FB account ที่เป็น admin ของ Page Penprinting
2. เช็ค My Apps: มี app เดิมมั้ย (D5) — มี → ใช้ต่อ + Add Product > Messenger / ไม่มี → Create App ประเภท Business
3. Messenger > Settings: ผูก Page Penprinting → Generate Page Access Token (= FB_PAGE_TOKEN)
4. App Settings > Basic: จด App Secret (= FB_APP_SECRET)
5. ตั้ง FB_VERIFY_TOKEN เอง (random string เช่นจาก `openssl rand -hex 16`)
6. Vercel (project penprinting-dashboard) ตั้ง env 5 ตัว:
   FB_APP_SECRET / FB_PAGE_TOKEN / FB_VERIFY_TOKEN / AI_QUOTE_MESSENGER_ENABLED=true / AI_QUOTE_MESSENGER_HINT_ENABLED=true
   → **Redeploy** (env live ต่อเมื่อ deploy ใหม่)
7. Messenger > Settings > Webhooks: Callback URL = https://dashboard.penprinting.co/api/ai-quote/messenger
   Verify Token = ค่าจากข้อ 5 → Verify and Save (Meta ยิง GET handshake — ต้องผ่านหลัง redeploy แล้วเท่านั้น)
8. Subscribe webhook fields: **messages, messaging_postbacks เท่านั้น** (ห้าม message_echoes)
9. เพิ่มทีมงานที่จะทดสอบเป็น Tester ของ app (App Roles) — dev mode = webhook รับ event เฉพาะคนมี role

## จังหวะ 1 — Soft-launch smoke (dev mode)
- [ ] GET https://dashboard.penprinting.co/api/ai-quote/messenger → {ok, service}
- [ ] tester ทัก Page → ข้อความแรกได้ hint + ปุ่ม (hint gate: ข้อความที่ 2 ใน 24h ต้องเงียบ)
- [ ] กดปุ่ม/พิมพ์ "/ขอราคา AI" → intro → ตีราคา โบรชัวร์ / หนังสือ / สมุด
- [ ] escalation ① "ขอคุยกับทีมงาน" → Flex เข้ากลุ่ม LINE + แถว "ช่องทาง: Facebook Messenger" + lead badge Messenger ใน /quote-leads
- [ ] escalation ④ "สั่งเลย" หลังได้ราคา → lead "กำลังติดตาม"
- [ ] **M5 2-account**: tester คนที่ 2 เข้าโหมด → ต้องไม่เห็นบทสนทนา/ราคาของคนแรก
- [ ] slip: ส่งสลิปจริง → ✅ / ส่งซ้ำ → เคยส่งแล้ว / รูปไม่ใช่สลิป → เงียบ / เช็ค /api/admin/slip-metrics channel=messenger
- [ ] ออกโหมด "จบ"/"ออก" → EXIT_TEXT

## จังหวะ 2 — Go live
1. เช็ค privacy policy URL บน penprinting.co (ไม่มี → เพิ่มก่อนยื่น — งานฝั่ง penprinting-web)
2. App Review: ขอ pages_messaging + อัด screencast flow (ทัก Page → hint → เข้าโหมด → ได้ราคา)
3. Approved → สลับ app เป็น Live
4. ตั้ง persistent menu + ice breakers (Claude เตรียม curl payload — postback ai_quote_start; รัน token ผ่าน read -s ห้ามวางในแชต)

## Rollback
- เร็วสุด: Meta app > Webhooks > unsubscribe Page (เงียบทันที ไม่ต้อง deploy)
- ชั้นสอง: AI_QUOTE_MESSENGER_ENABLED=false + redeploy (เหลือ slip-only)
- LINE channel ไม่กระทบทุกกรณี
```

- [ ] **Step 10.2: Commit**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git add RUNBOOK-1c-messenger-setup.md && git commit -m "docs(1c): Messenger setup runbook — Meta app prep + smoke + App Review + rollback"
```

---

### Task 11: Final review + PR

- [ ] **Step 11.1: Final gates ทั้ง suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22 && npm run type-check && npm run lint && npx vitest run && npm run build`
Expected: เขียวหมด

- [ ] **Step 11.2: Zero-regression check ฝั่ง LINE** — grep ยืนยัน:
- `app/api/ai-quote/line/route.ts` diff มีแค่ `loadSession({channel:'line', channelUserId})` (Task 5)
- router: default `trackEnabled ?? true` → LINE routing เดิมเป๊ะ
- `ai-quote-slip-flex.test.ts` + describe เดิมใน router test ไม่ถูกแก้ expectation
- Copy reuse (spec §3): `/usr/bin/grep -n "LINE\|ไลน์" lib/ai-quote/customer-triggers.ts` → ต้องเจอแค่ใน comment ไม่ใช่ใน string ที่ส่งลูกค้า (INTRO/EXIT/HINT/RATE/ERROR — verify ไว้ตอน plan แล้วว่า neutral, เช็คซ้ำกัน drift)

- [ ] **Step 11.3: Final code review เทียบ SPEC** — reviewer ต้องอ่าน `docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md` แล้วไล่ D1-D5 + §1-§5 + DoD ทีละข้อ against diff จริง (ไม่ใช่ against plan นี้ — [[feedback_plan_verbatim_review_against_spec]])

- [ ] **Step 11.4: เปิด PR**

```bash
source ~/.nvm/nvm.sh && nvm use 22 && git push -u origin feat/ai-quote-phase1c-messenger && gh pr create --title "AI Quote Phase 1c — Messenger channel (opt-in AI quoting + slip verify)" --body "Spec: docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md

- Messenger ChannelAdapter (X-Hub-Signature-256 / parse / Send API / attachment download)
- Route /api/ai-quote/messenger (GET hub.challenge + POST → handleInbound)
- routeInbound trackEnabled gate (no /track /groupid on Messenger)
- loadSession M5 generalized to {channel, channelUserId} + createMessengerSession
- Slip text renderer (Messenger has no Flex) — shared classify/formatters
- Escalation → LINE staff group เดิม + ช่องทาง row + /quote-leads badge
- Zero DB migration · flag OFF = zero behavior change

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR เปิด, Vercel preview build เขียว — **flag/env ยังไม่ตั้ง = merge ได้ปลอดภัย (slip-only route ที่ไม่มีใครยิง)**

---

## หลัง merge (นอก scope plan — บันทึกไว้)

จังหวะ 0-2 ใน RUNBOOK = user actions ทั้งหมด (Meta app, env+redeploy, tester smoke, App Review). Persistent menu / ice breakers payload เตรียมตอน rollout. Revert gate "/" ของ LINE soft launch (TEST-ONLY 2 ไฟล์) เป็นงานแยก — พอ revert แล้ว Messenger ได้ keyword สะอาดอัตโนมัติ
