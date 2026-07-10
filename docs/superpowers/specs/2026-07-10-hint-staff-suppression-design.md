---
title: HINT-1 — Staff-activity suppression (Messenger) + staff takeover (design)
date: 2026-07-10
status: DESIGNED — approved by คุณนุ๊ก 2026-07-10, awaiting plan+execute
supersedes: —
relates: docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md (1c — Messenger adapter), docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md (1b-B §2 hint gate), AUDIT-BACKLOG.md HINT-1, memory [[feedback_chatbot_hint_needs_staff_suppression]]
---

# HINT-1 — Staff-activity suppression + takeover ใน Messenger

> **ที่มา (incident 2026-07-09):** publish app ~2 ชม. → hint ยิงแทรกกลางดีลใบเสนอราคาที่พนักงาน (Giift) คุยกับลูกค้าจริง (Dee Sudrak) อยู่ — hint เช็คแค่ 24h gate, บอทตาบอด echo โดยจงใจ (skip `is_echo` + ไม่ subscribe `message_echoes`), และ publish ทำให้ทุก conversation ค้างเข้าเงื่อนไข first-hint พร้อมกัน. Mitigated: `AI_QUOTE_MESSENGER_HINT_ENABLED=false`.
> Spec นี้ = เงื่อนไขที่ AUDIT-BACKLOG HINT-1 ตั้งไว้ก่อน re-enable hint.

## เป้าหมาย

บอทต้องรู้ว่า "พนักงานกำลังคุยกับลูกค้าคนนี้อยู่" แล้ว (a) **ไม่ส่ง hint แทรก** (b) **หยุดโหมด AI ทันทีเมื่อพนักงานตอบ** (takeover). ปลายทาง = เปิด `AI_QUOTE_MESSENGER_HINT_ENABLED=true` คืนอย่างปลอดภัย.

**สัญญาณ:** subscribe webhook field `message_echoes` — echo ของข้อความที่ Page ส่งออก. echo ที่ `app_id` **ไม่ใช่ app เรา** (หรือไม่มี `app_id` เช่นส่งจาก Page inbox) = พนักงานตอบเอง.

## Decisions (คุณนุ๊ก 2026-07-10)

| # | เรื่อง | ตัดสินใจ |
|---|---|---|
| D1 | ทิศทาง | **ทำ detector + เปิด hint Messenger คืน** — ไม่ปิด hint ถาวร (ลูกค้าเก่าที่ไม่กดเมนู ☰ ยัง discover AI ได้) |
| D2 | Scope channel | **Messenger เท่านั้น** — LINE ไม่มี webhook ตอนพนักงานตอบจาก OA Manager (ไม่มี equivalent ของ `message_echoes`) → ตรวจไม่ได้โดยสภาพ → **`AI_QUOTE_LINE_HINT_ENABLED` = ปิดถาวร**, rich menu คือทางเข้าหลักของ LINE (ตามแผนเดิม) |
| D3 | Suppression window | **48 ชั่วโมง** — staff ตอบลูกค้าคนไหนภายใน 48 ชม. → ไม่ hint ใส่คนนั้น (ครอบดีลที่คุยข้ามวัน; ลูกค้าเข้า AI เองผ่านเมนู ☰ ได้เสมอ) |
| D4 | Takeover | **staff ตอบ = AI หยุดทันที** — staff echo เคลียร์โหมด AI ของลูกค้าคนนั้น (ปิด gap AI ตอบทับพนักงานระหว่าง takeover; ก่อนหน้านี้กันแค่ทิศ "บอทไม่อ่านข้อความพนักงาน" แต่ไม่ได้หยุดบอทตอบต่อ) |
| D5 | Architecture | **แนวทาง A — echo เข้า pipeline เดิม** เป็น `InboundMessage` kind ใหม่ `'staff-echo'` ผ่าน `routeInbound`/`handleInbound` ตาม injected-deps pattern (ไม่ดักที่ route layer — side-effect ต้องอยู่ใน seam ที่ test ได้) |

## §1 Detection — parse layer (`lib/ai-quote/channels/messenger.ts`)

`parseMessengerEvents(body, opts?: { ourAppId?: string })` — เพิ่ม optional param, จำแนก echo:

| เงื่อนไข | ผล |
|---|---|
| `message.is_echo` + `message.app_id === ourAppId` | **skip** — บอทเราส่งเอง (เกิดทุกครั้งที่ AI ตอบ) |
| `message.is_echo` + `app_id` อื่น **หรือไม่มี** | emit `{ channel:'messenger', kind:'staff-echo', channelUserId: recipient.id }` |
| `message.is_echo` + **`ourAppId` ไม่ได้ส่งมา** (env ไม่ตั้ง) | **skip echo ทุกตัว** = พฤติกรรมปัจจุบันเป๊ะ |

- ⚠️ **echo ใช้ `recipient.id` เป็น PSID ลูกค้า** (ใน echo: sender = Page, recipient = ลูกค้า) — interface `MsgrMessaging` เพิ่ม `recipient?: { id?: string }` + `message.app_id?`
- **Fail-safe ทิศเดียว:** จำแนกไม่ได้ → ต้อง "ไม่ทำอะไร" เท่านั้น. ถ้า echo ของบอทเองถูกนับเป็น staff → โหมด AI โดนเตะหลุดทุกครั้งที่บอทตอบ = feature พังทั้งดุ้น. `app_id` ของบอทเรามีเสมอ (ส่งผ่าน `FB_PAGE_TOKEN` ของ app เรา) ดังนั้น "ไม่มี app_id = staff" ปลอดภัยเมื่อ `ourAppId` ถูกตั้งเท่านั้น
- Non-echo events: พฤติกรรมเดิมทุกบรรทัด (text/quick_reply/image/postback)
- LINE adapter ไม่ emit kind นี้ — **LINE zero diff**

## §2 Routing & handling — kind ใหม่ใน pipeline เดิม

- `channels/types.ts`: `InboundMessage.kind` เพิ่ม `'staff-echo'`
- `routeInbound`: `m.kind === 'staff-echo'` → route `'staff-echo'` (เช็คก่อน arms อื่น; ไม่สน `aiEnabled`/`trackEnabled` — แต่ handler ต้องมี deps ถึงทำงาน)
- `handleInbound` arm ใหม่: `await ai.recordStaffReply(uid)` — **เงียบสนิท: ไม่ reply, ไม่แตะ engine, ไม่นับ rate limit**. `deps.aiCustomer` absent → ignore (env ไม่ครบ = โหมด AI ไม่มีทาง active อยู่แล้ว)
- `CustomerAiDeps` เพิ่ม 2 fields: `recordStaffReply(uid)` + `staffActive(lastStaffReplyAt, nowMs)`

## §3 Data — `lib/ai-quote/line-mode.ts` + migration

- **คอลัมน์ใหม่:** `ai_quote_line_modes.last_staff_reply_at TIMESTAMPTZ` (nullable, **ไม่มี DEFAULT** — กัน backfill-to-ALTER-time gotcha [[feedback_postgres_migration_timestamp_gotchas]]) — db-migrate route เพิ่ม `ADD COLUMN IF NOT EXISTS` idempotent
- ตารางนี้ keyed ด้วย `channel_user_id` ใช้ร่วม 2 channel อยู่แล้ว (PSID กับ LINE uid คนละ namespace ไม่ชนกัน) — ฝั่ง LINE คอลัมน์นี้จะ NULL ตลอด
- `LineModeRow` เพิ่ม `lastStaffReplyAt: string | null` (ผ่าน `toIso` เดิม — tolerate ทั้ง Date/string/absent)
- **Pure gate:** `STAFF_SUPPRESS_HOURS = 48` + `staffActive(lastStaffReplyAt: string | null, nowMs: number): boolean` — คู่แฝด `hintAllowed` (null/malformed → false = ไม่ suppress)
- **`recordStaffReply(channelUserId)`** — upsert **statement เดียว atomic**:
  - `last_staff_reply_at = NOW()`
  - เคลียร์โหมด: `entered_at = NULL, last_activity_at = NULL, session_id = NULL, rounds_no_quote = 0` (takeover D4)
  - **คง `last_hint_at` ไว้** (24h hint gate อยู่คนละแกนกับ staff window)
  - `ON CONFLICT (channel_user_id) DO UPDATE` — ลูกค้าที่ไม่เคยมี row ได้ row ใหม่ (บันทึก window ไว้กัน hint ในอนาคต)

## §4 Hint arm — `webhook-router.ts` (จุดเดียวที่ logic เปลี่ยน)

นอกโหมด (`route === 'ai'` && `!active`) — ลำดับ gate ใหม่:

```
if (!ai.hintEnabled) return;
if (mode && ai.staffActive(mode.lastStaffReplyAt, now)) return;   // ← ใหม่: staff คุยอยู่ = เงียบ
if (mode && !ai.hintAllowed(mode.lastHintAt, now)) return;
markHintSent + ส่ง hint
```

- staff gate มาก่อน 24h gate — ลูกค้าที่ staff เพิ่งคุย **ไม่ควรเสีย 24h quota ไปกับ hint ที่ไม่ได้ส่ง** (markHintSent อยู่หลัง gate ทั้งคู่อยู่แล้ว — พฤติกรรมนี้ได้ฟรี)
- ในโหมด: ไม่มีอะไรเปลี่ยน (takeover จัดการผ่าน `recordStaffReply` เคลียร์ mode row — ข้อความถัดไปของลูกค้า `modeActive` = false เอง)

## §5 Route wiring — `app/api/ai-quote/messenger/route.ts` เท่านั้น

- **env ใหม่ `FB_APP_ID`** (App ID จากหน้า Meta App dashboard — ค่า public) → ส่งเป็น `ourAppId` เข้า `parseEvents`
- `hintEnabled = AI_QUOTE_MESSENGER_HINT_ENABLED === 'true' && !!process.env.FB_APP_ID` — fail-closed ซ้อน: ไม่มี app id = จำแนก echo ไม่ได้ = hint ต้องไม่เปิด
- wire `recordStaffReply` + `staffActive` เข้า `CustomerAiDeps`
- **LINE route (`app/api/ai-quote/line/route.ts`): diff = wiring 2 บรรทัด, zero behavior change** — `CustomerAiDeps` เพิ่ม required fields จึงต้อง wire `recordStaffReply`/`staffActive` ด้วย แต่ `staffActive` ไม่มีวัน true บน LINE (คอลัมน์ NULL ตลอด — ไม่มีใครเขียน) และ LINE adapter ไม่ emit staff-echo · test pin ว่า LINE hint arm พฤติกรรมเดิมเป๊ะ

## §6 Error handling

- `recordStaffReply` ล้ม (เช่น echo มาก่อน migrate apply) → `console.error` prefix `[ai-quote/messenger]` + **ไม่ throw ต่อ** — webhook ต้อง ack 200 เสมอ (Meta นับ error สะสมแล้ว disable webhook ได้)
- `staff-echo` arm ไม่มี reply path = ไม่มีความเสี่ยง reply ผิดคน

## §7 Testing (TDD — vitest, pattern เดิมของแต่ละไฟล์)

| ไฟล์ test | เคส |
|---|---|
| `ai-quote-messenger.test.ts` (parse) | echo จาก app เรา → skip · echo app อื่น → staff-echo + PSID จาก **recipient** · echo ไม่มี app_id → staff-echo · ไม่ส่ง ourAppId → echo ทุกตัว skip (พฤติกรรมเดิม pin) · non-echo ไม่กระทบ |
| `ai-quote-line-mode` / db tests | `staffActive` window 48h (ก่อน/หลัง/null/malformed) · SQL shape `recordStaffReply` (set staff ts + เคลียร์ mode + **คง last_hint_at**) |
| `ai-quote-webhook-router.test.ts` | staff-echo → `recordStaffReply` called + **ไม่มี reply** · hint suppressed เมื่อ `staffActive` true · hint ปกติเมื่อ >48h · staff gate ไม่กิน 24h quota (markHintSent ไม่ถูกเรียก) · deps absent → เงียบ |

## §8 Rollout (runbook — user actions ตามลำดับ)

1. Deploy code (merge → Vercel auto)
2. `GET /api/admin/db-migrate` — verify มี `ADD COLUMN last_staff_reply_at`
3. Vercel env `FB_APP_ID` + **redeploy** (env live ต่อเมื่อ deploy ใหม่ — [[feedback_ai_quote_phase1a]])
4. Meta App dashboard → Webhooks → Page subscription → **เพิ่ม field `message_echoes`**
5. **Verify (critical ก่อนเปิด hint):**
   - โหมด AI ยังคุยได้หลายเทิร์น — บอทตอบแล้ว**ไม่เตะตัวเองหลุดโหมด** (พิสูจน์การจำแนก app_id ถูก)
   - staff ตอบจาก Page inbox → ลูกค้า test อยู่ในโหมด → โหมดหลุดจริง (takeover)
   - staff ตอบแล้ว → ลูกค้า test (นอกโหมด) พิมพ์ข้อความ → **ไม่มี hint**
6. `AI_QUOTE_MESSENGER_HINT_ENABLED=true` + redeploy

**Rollback:** hint flag = false + redeploy (แบบ incident เดิม) — detector/takeover คงอยู่ได้ไม่มีพิษ (มีแต่ประโยชน์: takeover ทำงานแม้ hint ปิด). ถอนสุด = unsubscribe `message_echoes`.

## §9 Non-goals

- LINE staff detection — เป็นไปไม่ได้โดยสภาพ platform (D2); `AI_QUOTE_LINE_HINT_ENABLED` ถือเป็นปิดถาวร, ทางเข้า LINE = rich menu (รอรูปดีไซน์)
- Heuristic จากฝั่งข้อความลูกค้า (เช่น "ลูกค้าพิมพ์หลายข้อความรอ staff") — สัญญาณ echo ตรงกว่าและพอ
- Admin UI แสดง staff activity · การ re-enter โหมดอัตโนมัติหลัง takeover
