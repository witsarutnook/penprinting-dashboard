---
title: AI Quote Phase 1b-B — LINE OA ลูกค้าตีราคาเอง (design)
date: 2026-07-04
status: DESIGNED — approved by คุณนุ๊ก 2026-07-04, awaiting plan+execute session (gate = LINE_STAFF_GROUP_ID env + rich menu setup)
supersedes: —
relates: design-ai-quoting.md §7-§9, docs/superpowers/specs/2026-06-27-ai-quote-phase1b-line-webhook-takeover-design.md (1b-A)
---

# AI Quote Phase 1b-B — เปิด AI quote ใน LINE OA (ลูกค้า 1-1)

> **Brainstormed + approved 2026-07-04.** Execution ตั้งใจเลื่อนไป session แยก (คุณนุ๊กสั่ง "brainstorm ไว้รอก่อน") — session หน้าเริ่มจาก spec นี้ → invoke `superpowers:writing-plans` → execute.

## เป้าหมาย

ลูกค้าใน LINE OA (แชต 1-1) เข้า "โหมดขอราคา AI" ได้เอง → AI สกัด spec + ตีราคาเบื้องต้น (โบรชัวร์/หนังสือ/สมุด) → escalate ให้พนักงานเมื่อเกินขอบเขต/ลูกค้าจะสั่งจริง. Foundation ทั้งหมดมาจาก 1b-A (webhook takeover, slip, /track) — 1b-B แค่ wire arms `ai`/`enter-ai`/`exit-ai` ที่ stub ไว้ + เพิ่ม mode state + customer prompt + escalation push.

## Decisions (คุณนุ๊ก 2026-07-04)

| # | เรื่อง | ตัดสินใจ |
|---|---|---|
| D1 | Mode entry | **Opt-in** — rich menu + keyword ทั้งคู่ + idle timeout (ไม่ always-on, ไม่ intent-gate) |
| D2 | นอกโหมด | **Hint + ปุ่ม 1-แตะ, conservative** — OA มีพนักงานตอบเอง → hint ≤1 ครั้ง/user/24ชม. ห้ามแทรกซ้ำ |
| D3 | Escalation | **ทั้ง 4 triggers** — ①ขอคุยกับคน ②นอกขอบเขต ③วนเกิน ~4 รอบ (Type A, `escalated`) + ④ลูกค้าจะสั่ง (Type B qualified, `กำลังติดตาม`). Destination เดียว: push กลุ่มพนักงาน + lead ใน /quote-leads |
| D4 | Model | **Sonnet 5 engine เดิม + Haiku gates — zero model change** (Haiku เคยพิสูจน์แล้วว่า over-clarify; Opus/Fable = แพง/ช้าเกินงาน; Sonnet 5 intro pricing ถึง 31 ส.ค.) |

## §1 Mode lifecycle

**State:** ตารางใหม่ `ai_quote_line_modes`

```sql
CREATE TABLE IF NOT EXISTS ai_quote_line_modes (
  channel_user_id  text PRIMARY KEY,   -- LINE userId (webhook-verified)
  entered_at       timestamptz NOT NULL,
  last_activity_at timestamptz NOT NULL,
  session_id       bigint,             -- fk ai_quote_sessions (nullable — เซ็ตเมื่อ persist)
  last_hint_at     timestamptz         -- gate hint 24h (§2)
);
```

- **Entry:** rich menu (ส่ง text/postback ที่ router map เป็น `enter-ai`) หรือ keyword exact-ish (`ขอราคา`, `ตีราคา`, `ขอราคา AI`) — ห้ามใช้คำกว้างอย่าง `ราคา` เดี่ยวๆ (ชนบทสนทนาปกติ)
- **In-mode:** ข้อความ text → route `ai` → `runQuoteTurn` (engine เดิม)
- **Exit:** (a) **idle >30 นาที — เช็ค lazy** ตอนข้อความถัดไปเข้า (`last_activity_at` เก่าเกิน = โหมดหมดแล้ว, ข้อความนั้น treat เป็นนอกโหมด; ไม่มี cron) · (b) keyword `จบ`/`ออก` → route `exit-ai` · (c) escalation ทุก trigger — ทั้ง Type A และ B (§4, sales รับช่วงต่อ)
- เข้าโหมด → intro สั้น: บอกว่าคุยกับ AI + ตัวอย่าง input + วิธีออก
- **Priority ของ router ไม่เปลี่ยน:** `/track` / `/groupid` / สลิป มาก่อน AI เสมอ ทั้งใน/นอกโหมด. กลุ่ม = ไม่มี AI เหมือนเดิม (กันสแปม, ตาม 1b-A)

## §2 นอกโหมด — hint

- Text 1-1 ที่ไม่ใช่ command/สลิป และ**ไม่อยู่ในโหมด** → ตอบ hint 1 ข้อความ + **quick-reply ปุ่ม "🤖 เริ่มขอราคา AI"** (กดปุ่ม = ส่ง keyword = เข้าโหมด 1 แตะ)
- Gate: `last_hint_at` ภายใน 24 ชม. → **เงียบ** (พนักงานตอบเองตามปกติ)
- Hint copy ต้องสื่อว่ามีคนจริงด้วย เช่น "ทีมงานจะตอบกลับโดยเร็วค่ะ 🙏 หรือถ้าอยากได้ราคาประเมินทันที กดปุ่มด้านล่างให้ AI ช่วยคิดราคาได้เลย"

## §3 Engine + customer prompt variant

- Engine เดิมทั้งดุ้น: `runQuoteTurn` + `MODEL='claude-sonnet-5'` + `MAX_TOKENS=4096` + compute_quote tool — **ไม่แตะ**
- **ใหม่: customer system prompt variant** (แยกไฟล์/แยก export จาก staff prompt): ภาษาชาวบ้าน สุภาพแบบร้านค้า ("ค่ะ"), ไม่ใช้ศัพท์ภายใน (ชื่อ staff/เครื่องพิมพ์/แผนก), assume-and-disclose เหมือน staff, ทุกราคาปิดท้าย disclaimer D4 ("ราคาประเมินเบื้องต้น ทีมงานยืนยันอีกครั้งค่ะ"), ขอบเขต 3 ประเภท (โบรชัวร์/หนังสือ/สมุด) — นอกนั้น escalate ทันที ห้ามเดา
- Reply ผ่าน adapter เดิม (reply token → fallback push) — Sonnet 5 <10s verified, ห่าง reply-token expiry (~1 นาที) มาก
- Slip pre-filter ยังเป็น Haiku (`VISION_MODEL`) — ไม่แตะ

## §4 Escalation

| Trigger | Type | `lead_status` | AI บอกลูกค้า |
|---|---|---|---|
| ① ขอคุยกับคน/พนักงาน | A | `escalated` | ส่งต่อทีมงานแล้ว เดี๋ยวติดต่อกลับค่ะ |
| ② งานนอกขอบเขต (กล่อง/ถุง/สติกเกอร์/พิเศษ) | A | `escalated` | งานแบบนี้ทีมงานประเมินให้ตรงกว่าค่ะ ส่งต่อแล้วนะคะ |
| ③ วนเกิน ~4 รอบ spec ไม่ครบ/ตีไม่ออก | A | `escalated` | เดี๋ยวให้ทีมงานช่วยดูให้นะคะ |
| ④ ตีราคาได้ → ลูกค้ายืนยันจะสั่ง | B | `กำลังติดตาม` | รับเรื่องแล้วค่ะ ทีมขายจะติดต่อยืนยันราคา+รายละเอียดค่ะ |

**Action ทุก trigger:** (1) persist session เป็น lead (`channel='line'`, `line_user_id`) + เซ็ต status ตามตาราง → (2) **push Flex card เข้ากลุ่มพนักงาน** `LINE_STAFF_GROUP_ID` (สรุป: ลูกค้า userId/ชื่อถ้ามี · spec ที่สกัดได้ · ราคา AI ถ้ามี · trigger type · ลิงก์ `/quote-leads`) → (3) ตอบลูกค้าตามตาราง → (4) **ออกโหมด** (ทั้ง A และ B — sales รับช่วงต่อ)

Reuse ของที่มีแล้ว: `detectEscalation` (M3) · `markEscalated` · `claimLead` conditional UPDATE + 409 (M4) · badge "ต้องประเมินเอง" ใน /quote-leads. เพิ่ม: push helper + trigger ②③④ ใน prompt/logic + channel badge (line/dashboard) ใน /quote-leads list.

## §5 Identity — M5 owner-check (acceptance criterion จาก design-ai-quoting §7)

1. สร้าง session ฝั่ง LINE: `channel='line'` + `line_user_id` = sender จาก webhook (HMAC-verified แล้วโดย 1b-A route)
2. โหลด: `loadSession(id, { channel: 'line' })` **+ เช็ค `line_user_id` === sender** — mismatch → 404 (ไม่ leak ว่า session มีจริง)
3. Channel scope มีแล้ว (prep 2026-06-26: staff route ใช้ `{channel:'dashboard'}`) — 1b-B เพิ่ม owner-check ทับ
4. Migration idempotent ใน db-migrate: `ai_quote_line_modes` + `ALTER TABLE ai_quote_sessions ADD COLUMN IF NOT EXISTS line_user_id text` (เช็คก่อน — design §8 ระบุ column ไว้แต่ต้อง verify ว่า migration จริงมีหรือยัง)

## §6 Guardrails

- `AI_QUOTE_LINE_ENABLED` (มีแล้ว, no-op stub) = master switch — OFF = พฤติกรรม 1b-A เป๊ะ (zero regression path)
- Rate limit ต่อ `line_user_id`: ~30 ข้อความ/ชม. (reuse `lib/rate-limit`) — เกิน = ข้อความสุภาพแนะนำรอทีมงาน + ไม่เรียก engine
- Message cap 4000 chars (M2 มีแล้วใน engine)
- Metrics: นับ turn/escalation ผ่าน `ai_quote_sessions` ที่มีอยู่ (ไม่สร้างตาราง metrics ใหม่ใน 1b-B — YAGNI, ดูจาก /quote-leads ได้)

## §7 Rollout — 2 จังหวะ

1. **Soft launch:** flag ON + keyword เท่านั้น (ไม่ตั้ง rich menu, hint ปิดด้วย sub-flag หรือ constant) → ทีมงานทดสอบใน LINE จริง: เข้า/ออกโหมด · ตีราคา 3 ประเภท · escalation ทั้ง 4 · /track+สลิประหว่างโหมด · owner-check (2 เครื่อง)
2. **Full launch:** เปิด hint + คุณนุ๊กตั้ง rich menu ใน LINE OA Manager

**คุณนุ๊ก actions (gate ของ execute session):**
- [ ] หา group id กลุ่มพนักงาน (พิมพ์ `/groupid` ในกลุ่ม — feature 1b-A มีแล้ว) → ตั้ง `LINE_STAFF_GROUP_ID` ใน Vercel env → **redeploy** (env live ต่อเมื่อ deploy ใหม่)
- [ ] จังหวะ 2: rich menu ใน LINE Official Account Manager (ปุ่มส่ง text "ขอราคา AI")
- [ ] รัน db-migrate หลัง deploy (Chrome MCP ได้)

## Files ที่คาดว่าแตะ (leads — grep จริงตอน plan)

`lib/ai-quote/webhook-router.ts` (wire 3 routes + hint) · `lib/ai-quote/line-mode.ts` ใหม่ (state load/save/lazy-expiry) · `lib/ai-quote/prompt-customer.ts` ใหม่ (หรือ variant ใน prompt.ts) · `lib/ai-quote/escalation-push.ts` ใหม่ (Flex → staff group) · `lib/ai-quote/db.ts` (owner-check + createSession line_user_id) · `app/api/ai-quote/line/route.ts` (flag + deps wiring) · `app/api/admin/db-migrate/route.ts` (table + column) · `app/quote-leads/*` (channel badge) · tests: mode state machine (pure) · router routing in/out of mode · owner-check · escalation triggers · hint gate

## Out of scope (1b-B)

- Messenger channel (gate = Meta App Review — architecture channel-agnostic รองรับแล้ว)
- กล่อง/ถุง pricing (= Phase 1c, ระหว่างนี้ escalate)
- Metrics table แยก / dashboard analytics ของ AI line
- Multi-turn image input ในโหมด AI (สลิปยัง route แยกเหมือนเดิม)

## Definition of done

- Gates เขียว Node 22 (type-check/lint/tests/build) + tests ใหม่ครอบ mode/owner-check/escalation/hint-gate
- Soft-launch smoke ครบ (§7 จังหวะ 1) โดยทีมงานบน LINE จริง
- M5 owner-check verified: user B โหลด session ของ A → 404
- Flag OFF = zero behavior change vs 1b-A (regression test)
