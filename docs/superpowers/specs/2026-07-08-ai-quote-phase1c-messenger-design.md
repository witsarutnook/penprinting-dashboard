---
title: AI Quote Phase 1c — Messenger channel (Facebook Page) (design)
date: 2026-07-08
status: DESIGNED — approved by คุณนุ๊ก 2026-07-08, awaiting plan+execute session (gate = Meta app check/setup — ดู §5)
supersedes: —
relates: docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md (1b-B), docs/superpowers/specs/2026-06-27-ai-quote-phase1b-line-webhook-takeover-design.md (1b-A), lib/ai-quote/channels/types.ts (seam ที่เตรียมไว้)
---

# AI Quote Phase 1c — เปิด AI quote + slip-verify ใน Facebook Messenger

> **Brainstormed + approved 2026-07-08.** Session ถัดไปเริ่มจาก spec นี้ → invoke `superpowers:writing-plans` → execute.
> หมายเหตุชื่อ phase: 1b-B เคยเรียก "กล่อง/ถุง pricing" ว่า Phase 1c — spec นี้ยึดตาม `channels/types.ts` ที่ประกาศ Messenger = Phase 1c ไว้ก่อน; กล่อง/ถุง pricing ยังไม่มี phase number ใหม่ (ยัง escalate เหมือนเดิม)

## เป้าหมาย

ลูกค้าที่ทักแชต Facebook Page Penprinting เข้า "โหมดขอราคา AI" ได้เหมือนฝั่ง LINE (opt-in + hint) + ส่งสลิปให้ระบบ verify ได้. **Reuse pipeline 1b-B ~80%** — `handleInbound` / engine Sonnet 5 / triggers / mode state / M5 / rate-limit ใช้ตัวเดิมทั้งหมด. งานใหม่จริง = Messenger adapter + route + slip text renderer + wiring.

## Decisions (คุณนุ๊ก 2026-07-08)

| # | เรื่อง | ตัดสินใจ |
|---|---|---|
| D1 | Scope | **AI quoting + slip-verify** — ไม่มี /track /groupid track-customer (Messenger ไม่มีกลุ่ม + ลูกค้าติดตามงานอยู่ฝั่ง LINE แล้ว) |
| D2 | Inbox model | **Hybrid** — opt-in mode เหมือน LINE แต่ **hint เปิดตั้งแต่ day 1** (≤1/user/24h + ปุ่ม 1 แตะ); พนักงานยังตอบ Page inbox เองเป็นหลัก |
| D3 | Escalation | **กลุ่ม LINE พนักงานเดิม** — reuse `pushStaff`/`pushLine` + `buildEscalationFlex` + การ์ดเพิ่มบรรทัด "ช่องทาง: Messenger" (พนักงานไปตอบต่อใน Page inbox) |
| D4 | Approach | **Native adapter ตัวที่ 2** ใน pipeline เดิม (ตาม seam `channel: 'line' | 'messenger'` ที่ 1b-A เตรียมไว้) — ไม่ใช้ third-party platform (เสีย data ownership) ไม่ใช้ bridge worker (สวนสถาปัตยกรรม takeover) |
| D5 | Meta app | **ยังไม่รู้สถานะ — user action เช็ค/สร้างก่อน execute** (ดู §5 จังหวะ 0); dev mode = soft-launch gate ในตัว |

## §1 Architecture & routing

```
Meta webhook ──► app/api/ai-quote/messenger/route.ts  (ใหม่)
                  ├─ GET  = hub.challenge handshake (hub.mode=subscribe + hub.verify_token ตรง → echo challenge)
                  └─ POST = verify X-Hub-Signature-256 → ack 200 ทันที → after() → handleInbound (mirror LINE route)
                              │
                              ▼
                  lib/ai-quote/channels/messenger.ts  (ใหม่ — implement ChannelAdapter เดิม)
```

**Adapter contract (จุดต่างจาก LINE):**
- `verifySignature`: header `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 **hex** ของ rawBody ด้วย `FB_APP_SECRET` — timing-safe compare, malformed → false ไม่ throw (mirror `verifyLineSignature`)
- `parseEvents`: `body.object==='page'` → `entry[].messaging[]` → `InboundMessage` (`channel:'messenger'`, `channelUserId` = PSID):
  - `message.text` → kind `text` · `message.quick_reply.payload` → kind `text` โดย**ใช้ payload ไม่ใช่ title** (title โดนตัด 20 ตัวอักษร)
  - `message.attachments[type==='image']` → kind `image`, เก็บ `payload.url` (CDN URL) ไว้ใน `imageMessageId` (update docstring ใน channels/types.ts)
  - `postback.payload` → kind `postback`
  - **skip `is_echo`** (defense in depth — และไม่ subscribe field `message_echoes` ตั้งแต่แรก) → ข้อความที่พนักงานส่งจาก Page inbox ไม่มีวันเข้า pipeline
  - อื่นๆ (sticker/reaction/delivery/read) → ทิ้ง; ไม่มี group/room บน Messenger (`sourceType` undefined เสมอ)
- `downloadImage`: fetch attachment URL ตรงๆ ทันทีที่ webhook มาถึง (ไม่ต้อง auth; URL หมดอายุได้ — ห้าม defer)
- `reply`/`push`: Send API `POST https://graph.facebook.com/v23.0/me/messages?access_token=FB_PAGE_TOKEN` body `{recipient:{id: PSID}, messaging_type:'RESPONSE', message:{text, quick_replies?}}` — Messenger ไม่มี reply token → reply = push by PSID ทั้งคู่
- Quick reply map: generic `{label, text}` → `{content_type:'text', title: label, payload: text}` (สูงสุด 13 ปุ่ม — เรามีปุ่มเดียว)
- Profile lookup (best-effort, mirror `getLineProfile`): `GET /{psid}?fields=first_name,last_name` → `customerName` — fail ทุกกรณี = null ไม่ block

**Route table ต่อ channel** — `routeInbound` รับ `opts.trackEnabled` (LINE = true, Messenger = false; pure + test pin):

| Route | LINE | Messenger |
|---|---|---|
| `ai` / `enter-ai` / `exit-ai` | ✅ | ✅ |
| `slip` (Haiku gate → Thunder → result card) | ✅ | ✅ |
| `track` / `track-customer` / `groupid` | ✅ | ❌ (ข้อความ track-shaped กลายเป็น text ธรรมดา — ในโหมด AI ตอบเอง / นอกโหมดเข้า hint gate; ไม่พังไม่ spam) |

## §2 Data model & M5 — zero DB migration

ยืนยันจาก db-migrate route แล้ว (2026-07-08):
- `ai_quote_sessions.channel` เป็น TEXT **ไม่มี CHECK** → ค่า `'messenger'` ใส่ได้เลย (widen TS union `'dashboard'|'line'|'messenger'` ใน types + rowToSession)
- **คอลัมน์ `line_user_id` เก็บ PSID สำหรับ messenger rows** — ความหมายจริง = "channel-scoped user id" (LINE userId ขึ้นต้น `U`+hex / PSID เป็นเลขล้วน — ID space ไม่ชนกัน). แก้ docstring ใน db.ts; **ไม่ rename column** (กัน broken window ระหว่าง deploy↔migrate บน LINE traffic ที่ live อยู่; rename cosmetic = phase หลัง ถ้าอยากทำ)
- `ai_quote_line_modes` PK = `channel_user_id` กลางอยู่แล้ว → **reuse `line-mode.ts` ทุก function** (mode 30-min lazy expiry + hint gate 24h) — row ของ PSID อยู่ร่วมตารางกับ LINE userId ได้เพราะ ID space ไม่ชน (document assumption ใน docstring)
- `slip_checks.channel` มีอยู่แล้ว → `recordSlipCheck` ส่ง `'messenger'` ได้ทันที, slip-metrics แยก channel ได้เอง

**M5 owner-check (acceptance criterion — ระดับเดียวกับ 1b-B §5):**
1. Create: `createMessengerSession(psid, displayName)` → `channel='messenger'` + `line_user_id=PSID` + `customer_contact='Messenger'`
2. Load: generalize `loadSession` opts `{lineUserId}` → `{channel, channelUserId}` — WHERE บังคับ `channel=<ตาม caller> AND line_user_id=<webhook-verified id>` mismatch → null (indistinguishable from not-found). Sweep caller ฝั่ง LINE ใน deploy เดียวกัน + tests pin SQL shape ทั้ง 2 channel
3. Rate limit: reuse `checkRateLimit` key `ai-quote-msgr:${psid}` 30/ชม. (spec 1b-B §6 เท่ากัน)

## §3 Conversation flow & renderers

**Flow ในโหมด = 1b-B ทุกประการ** (intro → ตีราคา → triggers ①②③④ → escalate/exit → ออกโหมด) — `handleInbound` + `CustomerAiDeps` ชุดเดิม ฉีดผ่าน route ใหม่:
- **Entry**: keyword `ขอราคา`/`ตีราคา` ผ่าน `isEnterAiKeyword` ตัวเดียวกับ LINE (gate "/" TEST-ONLY ของ LINE ยัง apply ระหว่าง dev-mode testing — พอ revert หลัง LINE soft launch นิ่ง Messenger ได้ keyword สะอาดอัตโนมัติ ไม่ต้องแก้อะไรเพิ่ม) · postback `ai_quote_start` (payload เดียวกับ LINE rich menu — จาก persistent menu + ice breakers ที่ตั้งหลัง go-live)
- **Hint (D2 — day 1)**: ข้อความ text แรกนอกโหมด → `HINT_TEXT` + quick reply ปุ่มเดียว, gate ≤1/user/24h ใน DB row ของ PSID — copy reuse จาก `customer-triggers.ts` (ตอน implement grep ยืนยัน string ไม่มีคำว่า "LINE" ฝัง — ถ้ามีให้ทำ copy กลางหรือ param)
- **AI turn replies** = plain text + disclaimer เดิม — ไม่ต้องมี renderer ใหม่
- **Slip result**: จุด render ใหม่จุดเดียว — `buildSlipMessenger(result)` คืน **ข้อความ text + emoji 4 สถานะ** (สำเร็จ+ยอด+ธนาคาร / สลิปซ้ำ / ยอดไม่ตรงบัญชี / อ่านไม่ได้ — copy ตาม slip-flex เดิม) ฉีดเข้า `deps.buildSlipFlex` ของ route → **webhook-router ไม่แตะ** (button template สวยๆ = YAGNI ไว้ทีหลัง)
- **Escalation Flex → กลุ่ม LINE**: generalize `EscalationFlexInput.lineUserId` → `{channel, channelUserId}` + การ์ดโชว์ "ช่องทาง: Messenger" (ที่เหลือเหมือนเดิม: ชื่อลูกค้า/trigger/ราคาล่าสุดจาก `loadLastQuote`/ลิงก์ /quote-leads)
- **/quote-leads**: เพิ่ม badge Messenger (keyed on `channel==='messenger'` — pattern เดียวกับ badge LINE)
- **Redelivery**: Meta ส่งซ้ำเมื่อไม่ได้ 200/timeout → posture เดิมเหมือน LINE (soft-state, quote double-insert = accepted display-only)
- **24h messaging window**: ทุกการส่งของเราเป็น response ต่อ inbound ที่เพิ่งเข้า → อยู่ใน window เสมอ; ไม่มี push campaign

## §4 Env & flags

| Var | ใช้ทำอะไร |
|---|---|
| `FB_APP_SECRET` | verify `X-Hub-Signature-256` — ไม่มี = route 500 (mirror LINE_CHANNEL_SECRET) |
| `FB_PAGE_TOKEN` | Send API + profile lookup |
| `FB_VERIFY_TOKEN` | hub.challenge handshake (random string ตั้งเอง) |
| `AI_QUOTE_MESSENGER_ENABLED` | master flag AI arms — composite เหมือน LINE: `flag && QUOTE_API_URL && QUOTE_API_TOKEN && ANTHROPIC_API_KEY` ขาดตัวไหน = slip-only |
| `AI_QUOTE_MESSENGER_HINT_ENABLED` | `true` ตั้งแต่ day 1 (D2 Hybrid) |

Reuse เดิม: `ANTHROPIC_API_KEY` · `QUOTE_API_URL/TOKEN` · `LINE_STAFF_GROUP_ID` + `LINE_CHANNEL_TOKEN` (escalation push). ⚠️ env ตั้งแล้วต้อง **redeploy** ถึง live ([[feedback_ai_quote_phase1a]])

## §5 Rollout — 3 จังหวะ

0. **Prep (คุณนุ๊ก actions — Claude เขียน runbook `RUNBOOK-1c-messenger-setup.md` ให้ตอน execute):**
   - [ ] เช็คใน developers.facebook.com (FB account ที่เป็น admin ของ Page): มี Meta app อยู่แล้วหรือยัง (D5) — มี → เพิ่ม Messenger product / ไม่มี → สร้าง app ประเภท Business
   - [ ] ผูก Page → gen `FB_PAGE_TOKEN` · จด App Secret
   - [ ] ตั้ง webhook `https://dashboard.penprinting.co/api/ai-quote/messenger` + verify token → subscribe fields: `messages`, `messaging_postbacks` (**ไม่** subscribe `message_echoes`)
   - [ ] ตั้ง env 5 ตัว (§4) ใน Vercel → **redeploy**
1. **Soft launch (ฟรี — dev mode คือ gate):** app โหมด Development = webhook รับ event เฉพาะคนที่มี role ใน app → เพิ่มทีมงานเป็น tester แล้ว smoke บน Messenger จริง: เข้า/ออกโหมด · ตีราคา 3 ประเภท · escalation ①④ (② ③ optional — detector มี unit test แล้ว) · **M5 2-account** · slip 4 สถานะ · hint gate 24h · ลูกค้าจริงระหว่างนี้ = Page inbox ปกติ พนักงานตอบเอง ไม่โดนบอทแทรก
2. **Go live:** ยื่น **Meta App Review ขอ `pages_messaging`** (ต้องมี: privacy policy URL — เช็คว่า penprinting.co มีหรือยัง ถ้าไม่มี = งานเล็กฝั่ง penprinting-web ก่อนยื่น · screencast สาธิต flow · app icon; อาจติด Business Verification สำหรับ advanced access) → approved → สลับ Live → ตั้ง persistent menu + ice breakers ผ่าน Graph API (Claude เตรียม script/payload ให้)

**Rollback 2 ชั้น:** เร็วสุด = unsubscribe webhook ใน Meta app dashboard (เงียบทันที ไม่ต้อง deploy) · ชั้นสอง = `AI_QUOTE_MESSENGER_ENABLED=false` + redeploy (เหลือ slip-only) — LINE channel ไม่กระทบทุกกรณี

## Files ที่คาดว่าแตะ (leads — grep จริงตอน plan)

`lib/ai-quote/channels/messenger.ts` ใหม่ (adapter + signature + parse + Send API) · `app/api/ai-quote/messenger/route.ts` ใหม่ (GET handshake + POST + deps wiring mirror LINE route) · `lib/ai-quote/slip-messenger.ts` ใหม่ (text renderer 4 สถานะ) · `lib/ai-quote/webhook-router.ts` (`routeInbound` + `opts.trackEnabled`) · `lib/ai-quote/db.ts` (loadSession generalize + createMessengerSession + docstring line_user_id) · `lib/ai-quote/types.ts` (channel union) · `lib/ai-quote/escalation-flex.ts` (channel field + บรรทัดช่องทาง) · `app/quote-leads/*` (badge Messenger) · `middleware.ts`/convention check (API self-guard — mirror LINE route ไม่เข้า matcher) · `RUNBOOK-1c-messenger-setup.md` ใหม่ · tests: adapter parse (text/image/postback/quick-reply/echo/malformed) + signature + route table per channel + slip renderer 4 states + M5 SQL shape messenger + createMessengerSession (คาด ~30-40 tests ใหม่)

## Out of scope (1c)

- /track + track-customer + /groupid บน Messenger (D1 — ลูกค้าติดตามงานฝั่ง LINE/web ตามเดิม)
- Facebook comment-to-Messenger (private replies) + Instagram DM (adapter ที่ 3 — ค่อยว่ากันถ้าต้องการ)
- Button/generic template สวยๆ สำหรับ slip card (text ก่อน — YAGNI)
- Handover Protocol ของ Meta (opt-in mode + is_echo skip พอสำหรับ coexistence กับ Page inbox)
- กล่อง/ถุง pricing (ยัง escalate เหมือนเดิม)
- Rename column `line_user_id` → `channel_user_id` (cosmetic — ทำ phase หลังพร้อม migration ที่มี window ปลอดภัย)

## Definition of done

- Gates เขียว Node 22 (type-check/lint/tests/build) + tests ใหม่ครอบ adapter/signature/route-table/renderer/M5-messenger
- Zero regression ฝั่ง LINE + dashboard: flag/env Messenger ไม่ตั้ง = พฤติกรรมเดิมเป๊ะ (router tests เดิมต้องเขียวโดยไม่แก้ expectation นอกจาก signature ใหม่ของ opts)
- Soft-launch smoke ครบ (§5 จังหวะ 1) โดยทีมงานบน Messenger จริง — รวม **M5 2-account** + slip 4 สถานะ
- Escalation จาก Messenger → Flex เข้ากลุ่ม LINE พนักงาน มีบรรทัด "ช่องทาง: Messenger" + lead ขึ้น /quote-leads พร้อม badge
- App Review approved + Live = ลูกค้าจริงเข้าโหมดผ่าน hint/persistent menu ได้ (จังหวะ 2 — ไม่ block DoD ของ execute session; นับเป็น rollout gate แยก)
