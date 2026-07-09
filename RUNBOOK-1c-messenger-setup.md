---
title: Runbook — Phase 1c Messenger setup (Facebook Page)
created: 2026-07-08
spec: docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md
plan: docs/superpowers/plans/2026-07-08-ai-quote-phase1c-messenger.md
status: 🟡 รอคุณนุ๊กทำ (จังหวะ 0-2) — โค้ด Task 1-9 อยู่บน branch `feat/ai-quote-phase1c-messenger`, รอ merge + deploy ก่อนเริ่ม
owner: คุณนุ๊ก (developers.facebook.com / Meta Business Suite / Vercel เป็น user-only); Claude ช่วย health-check + อ่าน log + เตรียม curl payload
---

# 🚀 Runbook — Phase 1c Messenger setup

> **เป้าหมาย:** เปิด AI quoting + slip-verify ใน Facebook Messenger ของ Page Penprinting — reuse pipeline 1b-B เดิม (engine, mode, M5, escalation) ผ่าน ChannelAdapter ตัวที่ 2
>
> **Webhook URL ใหม่:** `https://dashboard.penprinting.co/api/ai-quote/messenger`
>
> **Scope (D1):** AI quoting + slip-verify เท่านั้น — **ไม่มี** `/track` `/groupid` บน Messenger (ลูกค้าติดตามงานฝั่ง LINE/web เหมือนเดิม)

## ⚠️ ก่อนเริ่ม

1. **PR ของ Task 1-9 ต้อง merge เข้า `main` และ deploy ขึ้น production ก่อน** — ถ้ายัง ให้ Claude/คุณนุ๊กเช็คสถานะ PR `feat/ai-quote-phase1c-messenger` ก่อน ไม่งั้น webhook URL ด้านล่างจะยังไม่มีจริงบน production
2. **ตั้ง env ให้ครบก่อน Verify webhook ใน Meta** (เหมือน [[feedback_ai_quote_phase1a]]) — env จะ live เฉพาะ deploy ที่เกิด **หลัง** ตั้งค่า ถ้า Verify ก่อนตั้ง/redeploy → handshake fail (403/timeout)
3. Flag เริ่มต้น: **`AI_QUOTE_MESSENGER_ENABLED` ตั้งเป็น `true` ตั้งแต่จังหวะ 0** (ต่างจาก 1b-A ที่เปิด AI ทีหลัง) — เพราะ dev mode ของ Meta app เป็น gate ในตัวอยู่แล้ว (เห็นเฉพาะ tester)

---

## จังหวะ 0 — Meta app prep

- [ ] **0.1** เข้า [developers.facebook.com](https://developers.facebook.com) ด้วย FB account ที่เป็น **admin ของ Page Penprinting**
- [ ] **0.2** เช็ค **My Apps**: มี app เดิมอยู่แล้วมั้ย (D5)
  - มี → ใช้ต่อ + **Add Product > Messenger**
  - ไม่มี → **Create App** เลือกประเภท **Business**
- [ ] **0.3** ใน **Messenger > Settings**: ผูก **Page Penprinting** เข้ากับ app → **Generate Page Access Token** → เก็บไว้ (= `FB_PAGE_TOKEN`)
- [ ] **0.4** ใน **App Settings > Basic**: จด **App Secret** (= `FB_APP_SECRET`)
- [ ] **0.5** ตั้ง **`FB_VERIFY_TOKEN`** เอง — random string ที่ Claude/คุณนุ๊กกำหนด เช่น
  ```bash
  openssl rand -hex 16
  ```
- [ ] **0.6** Vercel (project `penprinting-dashboard`) → **Settings > Environment Variables** (Production) ตั้ง env 5 ตัว:

  | Env | ค่า |
  |---|---|
  | `FB_APP_SECRET` | จาก 0.4 |
  | `FB_PAGE_TOKEN` | จาก 0.3 |
  | `FB_VERIFY_TOKEN` | จาก 0.5 |
  | `AI_QUOTE_MESSENGER_ENABLED` | `true` |
  | `AI_QUOTE_MESSENGER_HINT_ENABLED` | `true` |

  → **Redeploy** (env live ต่อเมื่อ deploy ใหม่เท่านั้น — ห้ามข้ามขั้นตอนนี้)
- [ ] **0.7** รอ deploy ✅ แล้วเช็ค health probe (Claude รันให้ได้ ไม่ต้องใช้ secret):
  ```
  GET https://dashboard.penprinting.co/api/ai-quote/messenger
  → {"ok":true,"service":"penprinting messenger webhook"}
  ```
- [ ] **0.8** กลับไป **Messenger > Settings > Webhooks**:
  - **Callback URL** = `https://dashboard.penprinting.co/api/ai-quote/messenger`
  - **Verify Token** = ค่าจาก 0.5
  - กด **Verify and Save** (Meta ยิง GET handshake ทันที — **ต้องทำหลัง redeploy 0.6 แล้วเท่านั้น** ไม่งั้น `FB_VERIFY_TOKEN` ยังไม่มีบน production → ได้ 403)
- [ ] **0.9** **Subscribe fields**: ติ๊กเฉพาะ **`messages`** และ **`messaging_postbacks`** — **ห้ามติ๊ก `message_echoes`** (โค้ด skip `is_echo` เป็น defense-in-depth อยู่แล้ว แต่ subscribe เพิ่มจะทำให้ traffic เข้าเยอะเกินจำเป็น)
- [ ] **0.10** เพิ่มทีมงานที่จะช่วยทดสอบเป็น **Tester** ใน **App Roles** — เพราะ app ยังอยู่ **dev mode** = webhook รับ event เฉพาะคนที่มี role ใน app (นี่คือ soft-launch gate ธรรมชาติ ไม่ต้องทำอะไรเพิ่ม)

---

## จังหวะ 1 — Soft-launch smoke (dev mode)

ทดสอบบน Messenger จริงกับ Page Penprinting โดยทีมงานที่เพิ่มเป็น tester แล้ว (0.10) — ลูกค้าทั่วไปยังไม่เห็นอะไรเปลี่ยน (dev mode)

- [ ] **1.1 Health probe** — `GET https://dashboard.penprinting.co/api/ai-quote/messenger` → `{"ok":true,"service":"penprinting messenger webhook"}`
- [ ] **1.2 Hint + gate 24h** — tester ทัก Page ครั้งแรก (ข้อความอะไรก็ได้ นอกโหมด) → ต้องได้ hint text + ปุ่ม "🤖 เริ่มขอราคา AI" กลับมา → ทักข้อความที่ 2 ในช่วง 24 ชม.เดียวกัน → **ต้องเงียบ** (hint gate ≤1/user/24h)
- [ ] **1.3 เข้าโหมด** — กดปุ่ม หรือพิมพ์ **`/ขอราคา AI`** (ต้องมี `/` นำหน้า — ดู ⚠️ หมายเหตุท้ายไฟล์) → ได้ intro text
- [ ] **1.4 ตีราคา** — ลองสเปกจริง 3 ประเภท: **โบรชัวร์** / **หนังสือ** / **สมุด** → ต้องได้ราคาประเมิน + disclaimer
- [ ] **1.5 Escalation ① "ขอคุยกับทีมงาน"** — พิมพ์ประมาณ "ขอคุยกับทีมงาน" → ต้องเห็น:
  - Flex card เข้า**กลุ่ม LINE พนักงานเดิม** (ช่องทาง escalation เหมือน 1b-B)
  - การ์ดมีแถว **"ช่องทาง: Facebook Messenger"** (แถวนี้มีเฉพาะ Messenger — LINE escalation ไม่มี)
  - Lead ขึ้นที่ `/quote-leads` พร้อม **badge สีน้ำเงิน "Messenger"**
- [ ] **1.6 Escalation ④ "สั่งเลย"** — หลังได้ราคาแล้วพิมพ์ยืนยันสั่ง (เช่น "สั่งเลย") → lead status เปลี่ยนเป็น **"กำลังติดตาม"**
- [ ] **1.7 M5 — 2-account isolation (สำคัญ)** — ให้ tester คนที่ 2 (คนละ FB account) เข้าโหมดพร้อมกัน → **ต้องไม่เห็นบทสนทนา/ราคาของคนแรก** (owner-check ผูกกับ PSID ที่ Meta verify มาให้ ไม่ใช่ session id เดา)
- [ ] **1.8 Slip — 4 เคส**
  - ส่งรูปสลิปโอนเงินจริง → ตอบ `✅ สลิปถูกต้องค่ะ` + ยอด + ธนาคาร
  - ส่งสลิปใบเดิมซ้ำ → ตอบ `⚠️ สลิปนี้เคยส่งแล้วค่ะ`
  - ส่งรูปที่ไม่ใช่สลิป (เช่นรูปงานพิมพ์) → **เงียบ ไม่ตอบ** (Haiku pre-filter กรองก่อน ไม่กิน Thunder quota)
  - เช็ค `GET /api/admin/slip-metrics?channel=messenger` (ต้อง login admin) — ดูยอด `thunder_calls`/`images` ขยับขึ้นตามที่ทดสอบ
    - ✅ **filter แยก channel มีแล้ว (2026-07-09 `db2eebd`):** `?channel=line` / `?channel=messenger` — ไม่ใส่ = รวมทุกช่องทางเหมือนเดิม (response มี field `channel: 'all'`), ค่าอื่น → 400
- [ ] **1.9 ออกจากโหมด** — พิมพ์ **"จบ"** หรือ **"ออก"** → ได้ EXIT_TEXT ("ออกจากโหมดประเมินราคาแล้วค่ะ...")

> ระหว่างจังหวะนี้ ลูกค้าทั่วไปที่ทัก Page ยังคุยกับพนักงานผ่าน Page inbox ปกติ — บอทไม่แทรก (dev mode = เห็นเฉพาะ tester)

---

## จังหวะ 2 — Go live

- [x] **2.1** ✅ **มีแล้ว (2026-07-09)**: `https://penprinting.co/privacy-policy` — live บน penprinting-web (ครอบทุก touchpoint: เว็บ/LINE/Messenger/ออเดอร์ + เปิดเผยว่ามี AI ช่วยตอบ + ขั้นตอนขอลบข้อมูลครบ) → คุณนุ๊กกรอกใน **Meta App Settings → Basic → Privacy Policy URL** และช่อง **Data Deletion Instructions URL ใช้ URL เดียวกันได้** (ข้อ 6 ของหน้ามีขั้นตอนลบข้อมูล)
- [ ] **2.2** ยื่น **App Review ขอสิทธิ์ `pages_messaging`** (คู่มือละเอียด — เพิ่ม 2026-07-09):
  - **Pre-check 3 อย่าง**: ① app icon 1024×1024 (App Settings → Basic) ② ~~privacy/data-deletion URL~~ ✅ 7/09 ③ **Business Verification** ของ portfolio Penprinting (business.facebook.com → Settings → Security Center) — advanced access มักบังคับ, ถ้ายังไม่ verified เริ่มก่อนได้เลย (เอกสารจดทะเบียนบริษัท/DBD)
  - **ยื่น**: developers.facebook.com → app AI Quoting → **App Review → Permissions and Features** → ค้น `pages_messaging` → **Request advanced access** → ไปที่ App Review → Requests กรอกฟอร์ม
  - **Use-case text (EN) — วางในช่อง "Tell us how you'll use this permission"**:
    > Our app is an automated price-quotation assistant for Penprinting Co., Ltd., a commercial printing house in Khon Kaen, Thailand. When a customer messages our Facebook Page ("Penprinting"), the app uses pages_messaging to reply within the standard 24-hour window: (1) it greets the customer and offers an opt-in "AI quote" mode via a quick-reply button; (2) once the customer opts in, it answers print-job questions and returns an instant price estimate (brochures, books, flyers); (3) it verifies bank-transfer slip images that customers send when paying; and (4) it hands the conversation off to our human staff whenever the customer asks for a person or the request is out of scope. The bot only responds to users who message our Page first, customers can exit the mode at any time, and our staff can take over in the Page inbox at any moment. Conversations are in Thai — the screencast includes captions explaining each step.
  - **Screencast** (1-2 นาที, mp4, บัญชี tester): ① เปิดแชท Page ② ทัก → เห็น hint+ปุ่ม "ขอราคา AI" ③ กดปุ่ม → พิมพ์สเปก (ใบปลิว A4 4สี 1,000) → ได้ราคา ④ "ขอคุยกับทีมงาน" → hand-off ⑤ "จบ" → ออกโหมด — ใส่ caption อังกฤษต่อช็อต
  - ⚠️ **hint gate ≤1/24ชม.** — บัญชีที่เพิ่งได้ hint จะไม่เห็นช็อต ② → รอ 24 ชม. หรือใช้ **tester คนที่ 2** (จังหวะเดียวกับ M5 2-account test — ทำคู่กัน)
  - รอผล 2-3 วัน – ~2 สัปดาห์; ระหว่างรอ dev mode ใช้ได้ปกติ
- [ ] **2.3** รอ **Approved** → สลับ app จาก **Development → Live**
- [ ] **2.4** ตั้ง **persistent menu + ice breakers** ผ่าน Graph API (postback payload `ai_quote_start` — payload เดียวกับปุ่มเข้าโหมดของ LINE rich menu)
  - Claude เตรียม curl payload ให้ตอน rollout จริง
  - **Token ต้องใส่ผ่าน `read -s` ในเทอร์มินัลของคุณนุ๊กเอง — ห้ามวาง `FB_PAGE_TOKEN` ลงในแชต**

---

## 🔙 Rollback (2 ชั้น)

| ชั้น | วิธี | ผล |
|---|---|---|
| **เร็วสุด** | Meta App Dashboard → **Messenger > Settings > Webhooks** → **unsubscribe** Page | เงียบทันที ไม่ต้อง deploy โค้ดใหม่ |
| **ชั้นสอง** | Vercel: `AI_QUOTE_MESSENGER_ENABLED=false` → **redeploy** | เหลือ slip-only (AI arm ปิด เหมือน 1b-A เดิม) |

**LINE channel ไม่กระทบทุกกรณี** — โค้ดแยก adapter คนละไฟล์ ปิด/พัง Messenger ไม่มีทางลามไป `/api/ai-quote/line`

---

## ⚠️ หมายเหตุ — gate "/" TEST-ONLY ของ LINE ยัง apply กับ Messenger

`isEnterAiKeyword` (`lib/ai-quote/webhook-router.ts`) เป็นฟังก์ชันร่วมที่ทั้ง LINE และ Messenger เรียกใช้ตัวเดียวกัน ตอนนี้ยังล็อกให้ต้องพิมพ์ **`/ขอราคา AI`** (มี `/` นำหน้า) เพราะเป็น soft-launch gate ของฝั่ง LINE (2026-07-07) ที่ยังไม่ revert — เพื่อกัน**ลูกค้าจริง**พิมพ์ "ขอราคา"/"ตีราคา" เฉยๆ แล้วหลุดเข้าโหมด AI โดยไม่ตั้งใจ

**ผลต่อ Messenger:** ระหว่าง soft launch ปุ่ม hint จะส่งข้อความ `/ขอราคา AI` (มี `/`) ให้อัตโนมัติอยู่แล้ว (quick reply payload) — ไม่กระทบ flow ปกติ กระทบเฉพาะถ้า tester พิมพ์เองแบบไม่มี `/`

**เมื่อ LINE soft launch นิ่งแล้ว** (revert TEST-ONLY 2 ไฟล์ตามที่ระบุใน `webhook-router.ts`/`customer-triggers.ts`) — Messenger จะได้ keyword สะอาด ("ขอราคา"/"ตีราคา" ไม่ต้องมี `/`) พร้อมกันโดยอัตโนมัติ ไม่ต้องแก้อะไรเพิ่มฝั่ง Messenger

---

## 📋 Behavior reference (จากโค้ดจริง — verify ไว้ 2026-07-08)

**Webhook flow** (`app/api/ai-quote/messenger/route.ts`):
1. POST → ถ้าไม่มี `FB_APP_SECRET` → **500** "not configured"
2. verify signature (header `X-Hub-Signature-256`, HMAC-SHA256 hex ของ raw body) → ผิด → **401**
3. parse events — เฉพาะ `object === 'page'`; ข้าม `is_echo` (ข้อความที่พนักงานตอบเองจาก Page inbox ไม่มีวันเข้า pipeline)
4. **ack 200 ทันที** → งานหนักรันใน `after()` แล้ว reply ผ่าน Meta Send API
5. per message:
   - **image** → `isSlipImage` (Haiku vision, fail-safe=true) → ไม่ใช่สลิป **เงียบ** (ไม่เรียก Thunder) → ใช่ → `verifyBankSlipImage` (Thunder) → reply **text** (`buildSlipMessenger` — ไม่มี Flex บน Messenger)
   - **text/postback** → `routeInbound` กับ `trackEnabled: false` (spec 1c D1) → เข้า/ออกโหมด AI / คุยในโหมด — `/track`, `/groupid` **ไม่ทำงาน**บน Messenger (ข้อความ track-shaped ตกไปเป็น text ธรรมดา)

**GET handshake** (`app/api/ai-quote/messenger/route.ts`):
- ไม่มี `hub.*` params → health probe: `{"ok":true,"service":"penprinting messenger webhook"}`
- `hub.mode=subscribe` + `hub.verify_token` ตรงกับ `FB_VERIFY_TOKEN` → echo `hub.challenge` กลับ (200)
- token ไม่ตรง หรือ `FB_VERIFY_TOKEN` ยังไม่ตั้ง → **403** forbidden

**Env ที่โค้ดอ่านจริง:**

| Env | ไฟล์ | ถ้าไม่มี |
|---|---|---|
| `FB_APP_SECRET` | `route.ts` (POST) + `channels/messenger.ts` (`verifyMessengerSignature`) | POST webhook ตอบ 500 "not configured" |
| `FB_PAGE_TOKEN` | `channels/messenger.ts` (`pageToken()` — Send API + profile lookup) | ส่ง/ดึงชื่อลูกค้า throw error (webhook ยัง ack 200 แต่ reply ไม่ออก) |
| `FB_VERIFY_TOKEN` | `route.ts` (GET handshake) | Verify ใน Meta dashboard ได้ 403 forbidden |
| `AI_QUOTE_MESSENGER_ENABLED` | `route.ts` (POST — composite `aiEnabled`) | AI โหมดปิด เหลือ slip-only |
| `AI_QUOTE_MESSENGER_HINT_ENABLED` | `route.ts` (`buildCustomerAiDeps.hintEnabled`) | ไม่มี hint/ปุ่มเชิญเข้าโหมด (ยังตอบสลิป/โหมดที่เข้าด้วยคำสั่งตรงได้ปกติ) |
| `ANTHROPIC_API_KEY` (reuse จาก 1a/1b) | `route.ts` (POST) | Haiku pre-filter + engine ใช้ไม่ได้ → `aiEnabled` composite = false → เหลือ slip-only |
| `QUOTE_API_URL` / `QUOTE_API_TOKEN` (reuse) | `route.ts` (POST) | เหมือนข้างบน — engine เรียกไม่ได้ → slip-only |
| `LINE_STAFF_GROUP_ID` (reuse) | `route.ts` (`buildCustomerAiDeps.pushStaff`) | escalation ไม่ push เข้ากลุ่ม LINE (log error เงียบ ลูกค้าไม่เห็นผลกระทบ) |

**นอก scope (1c, D1):** `/track`, `/groupid`, `track-customer` บน Messenger — ลูกค้าติดตามงานยังใช้ฝั่ง LINE/เว็บเหมือนเดิม
