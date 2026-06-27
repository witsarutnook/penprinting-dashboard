---
name: AI Quoting — Research + Design Doc
description: ระบบ AI ออกใบเสนอราคางานพิมพ์อัตโนมัติ — เชื่อม dashboard + calculator + LINE OA + (optional) PEAK
status: IN PROGRESS — Phase 0 ✅ + Phase 1a ✅ live (merged) + Phase 1b-A ✅ built+reviewed 2026-06-27 (PR #11 — dashboard ถือ LINE webhook เต็มตัว: slip Thunder API + /track parity, AI ยังปิด, รอ cutover+merge). ถัดไป = Phase 1b-B (เปิด AI). ดู spec/plan ใหม่ docs/superpowers/{specs,plans}/2026-06-27-ai-quote-phase1b-*
created: 2026-05-17
author: Claude + คุณนุ๊ก
tags: [dashboard, ai, quoting, design-doc]
---

# AI Quoting — Research + Design Doc

> สถานะ: **Phase 0 ✅ DONE (2026-06-17)** + **Phase 1a ✅ built + preview-verified + audited (2026-06-23)** — branch `feat/ai-quote-phase1a` (10 build commits `1424bfa`→`5d2de19` + audit fix `902d70a`), **รอ merge main + 1 happy-path prod smoke**. ขั้นต่อไป = **Phase 1b** (LINE OA, ดู §7) — ต้องปิด AUDIT-BACKLOG M5 (loadSession IDOR) ก่อน. calc `/api/quote` live (token deployed 6/23 `fd4f755`).

---

## 0. Brain — รู้ก่อนเขียนโค้ด

> สรุป Pillar 1 (Project-Guidelines) — ยืนยันครบกับคุณนุ๊ก 2026-05-17 (D1-D7 ใน §12)

**Business logic:** ลูกค้า/พนักงานพิมพ์คำของานพิมพ์ → AI สกัดเป็น typed spec → calculator คิดราคา (pure function) → AI ตอบ **ราคาต่อชิ้น ก่อน VAT** → ถ้าลูกค้าอยากได้ใบเสนอราคาจริง → บันทึกเป็น **lead** → ทีม sales ทำใบเสนอราคาใน PEAK เอง. AI ไม่แตะ PEAK, ไม่สร้าง order

**Features (phased):** Phase 0 calc API → 1a ผู้ช่วยตีราคาในจอ → 1b LINE OA → 1c กล่อง/ถุง. ~~PEAK API~~ ตัดออก

**Persona:**
- 1a (ในจอ) — ทีม sales + เจ้าของ/admin · รู้ศัพท์งานพิมพ์ · AI = เครื่องมือเร่งความเร็ว
- 1b (LINE) — ลูกค้า OA ผสมเก่า/ใหม่ · AI hand-hold คนใหม่ ภาษาชาวบ้าน

**User journey — golden path:** ถาม → AI สกัด spec (ขาด → ถามต่อ) → คิดราคา → ตอบราคาต่อชิ้น+ระบุก่อน VAT → สนใจ → เก็บชื่อ/เบอร์ → บันทึก lead → sales follow up

**Edge cases (D7):** หลายงาน/แชต = quote แยกชิ้นสรุปรวม · ต่อราคา → ไม่ลด escalate · งานนอก 5 ประเภท (นามบัตร/สติกเกอร์/โปสการ์ด) → escalate · คาบเส้น digital/offset → tip upsell

**Business rules:** ราคา = ต่อชิ้น/ก่อน VAT/ไม่ปัด/ราคาขายแล้ว/ไม่ผูกมัด (D4) · ใบเสนอราคาจริง = sales ทำมือ PEAK (D1)

**Success metrics:** เวลา "ถาม→ได้ราคา" (วัน→วินาที) · จำนวน inquiry ที่พนักงานไม่ต้องคิดเอง · conversion rate lead→order · (เพิ่ม) ความแม่นการสกัด spec ของ AI · escalation rate

---

## 1. ปัญหา + เป้าหมาย

**ปัญหาวันนี้:**
- ลูกค้าถามราคา → ต้องรอพนักงาน/กราฟิกว่าง → คิดราคา → ตอบกลับ. นอกเวลาทำการ = ลูกค้ารอข้ามวัน
- พนักงานทำใบเสนอราคาใน PEAK ให้ **ทุก inquiry** ไม่ว่าจะปิดการขายได้หรือไม่ → งานซ้ำซาก
- ไม่มีข้อมูลว่าเสนอราคาไปกี่เจ้า ปิดได้กี่เจ้า (conversion rate มองไม่เห็น)

**เป้าหมาย:**
- ลูกค้าได้ราคาประเมินภายในไม่กี่วินาที 24 ชม. — ผ่านจอ (พนักงานใช้) และ LINE OA (ลูกค้าใช้เอง)
- ราคาที่ AI ตอบ = ราคาเดียวกับที่ calculator คิด (ไม่ใช่ AI เดา)
- งานที่ลูกค้าตกลง → เด้งเป็น draft order ใน dashboard อัตโนมัติ
- เก็บสถิติ quote → รู้ conversion

**Success metrics:**
- เวลาเฉลี่ยจาก "ลูกค้าถาม" → "ได้ราคา" ลดจาก ชม./วัน → วินาที
- จำนวน inquiry ที่พนักงานไม่ต้องคิดราคาเอง
- conversion rate quote → order (วัดได้เป็นครั้งแรก)

---

## 2. การตัดสินใจเรื่อง PEAK + การแบ่งเฟส

PEAK Account API มีค่าใช้จ่ายรายปีสูงพอควร (Setup 5,000 + แพ็กเกจ 12,000–30,000/ปี + ต้องอยู่ Pro Plus — รายละเอียด §10). **ข้อสรุปจากการวิเคราะห์: PEAK API ไม่ใช่หัวใจของฟีเจอร์** — มันคือชั้นที่ 3 จาก 3 และเป็นชั้นเดียวที่เสียเงิน. ค่าของ AI 90% อยู่ที่ชั้น 1 (เข้าใจลูกค้า) + ชั้น 2 (คิดราคา) ซึ่งไม่แตะ PEAK

→ **ออกแบบให้ decoupled**: Phase 1 ใช้งานได้เต็มโดยไม่จ่ายค่า PEAK API เลย. Phase 2 ค่อยต่อ PEAK ถ้า volume คุ้ม (เกณฑ์ตัดสินใน §10)

ข้อสังเกตสำคัญ: ทุกวันนี้พนักงานคีย์ใบเสนอราคาเข้า PEAK ให้ทุก inquiry. Phase 1 จะทำให้พนักงานเปิด PEAK **เฉพาะงานที่ลูกค้าตกลงแล้ว** + AI เตรียม spec/ราคาให้ copy → งาน PEAK **ลดลงกว่าทุกวันนี้** ทั้งที่ยังไม่จ่ายค่า API

---

## 3. สถาปัตยกรรม — 3 ชั้น

```
ลูกค้า/พนักงาน
   │  (ข้อความ free-text ภาษาไทย / รูป)
   ▼
┌─────────────────────────────────────────────┐
│ ชั้น 1 — AI Spec Extraction (Claude API)      │
│  • อ่านข้อความ → สกัดเป็น typed spec object   │
│  • spec ไม่ครบ → ถามกลับเอง                   │
│  • งานนอกขอบเขต → escalate ให้คน              │
└───────────────────┬─────────────────────────┘
                    │  structured spec (BrochureInput / BoxInput / ...)
                    ▼
┌─────────────────────────────────────────────┐
│ ชั้น 2 — Pricing Engine (deterministic)       │
│  • computeBrochure / computeBook / compute... │
│  • สูตรเดียวกับ calc.penprinting.co เป๊ะ      │
│  • AI เรียกผ่าน tool — เดาราคาเองไม่ได้        │
└───────────────────┬─────────────────────────┘
                    │  Result (totalPrice, unitPrice, +VAT, finishing)
                    ▼
┌─────────────────────────────────────────────┐
│ ชั้น 3 — Quote Delivery                       │
│  Phase 1: ข้อความ/PDF + draft order ใน dash   │
│  Phase 2 (optional): POST ใบเสนอราคาเข้า PEAK │
└─────────────────────────────────────────────┘
```

---

## 4. ชั้น 1 — AI Spec Extraction

### หน้าที่
แปลงภาษาคน → **typed spec object** ที่ชั้น 2 รับได้ตรงๆ

### ขอบเขตงานที่ quote ได้ (สำคัญ — มีแค่ 5 ประเภท)
calculator รองรับ 5 ประเภท → AI quote ได้แค่นี้:

| ประเภท | spec object | หมายเหตุ |
|---|---|---|
| โบรชัวร์/ใบปลิว | `BrochureInput` | size, color, sides, paperName, qty |
| หนังสือ | `BookInput` | cover + innerA + innerB (paper/color/pages) |
| สมุด | `NotebookInput` | A4/A5 เท่านั้น |
| กล่อง | `BoxInput` | 3 styles, มิติ W×L×H |
| ถุงกระดาษ | `BagInput` | standard/custom + handle |

❗️ **นามบัตร / สติกเกอร์ / โปสการ์ด ยังไม่รองรับ** (อยู่ใน backlog ของ calculator) → AI ต้องตรวจจับว่า "นอกขอบเขต" แล้ว escalate ให้พนักงาน ไม่ใช่เดาราคา

### เทคนิค — Claude API tool use
- AI **ไม่ได้ output ราคาเอง** — มันถูกบังคับให้เรียก tool `compute_quote(productType, spec)` ซึ่งรันสูตรจริง แล้วเอา result มาเรียบเรียง
- ใช้ **structured tool input schema** (JSON Schema ตรงกับ `BrochureInput` ฯลฯ) → Claude กรอกให้ตรง type
- spec ไม่ครบ (เช่นไม่บอกจำนวน/กระดาษ) → AI ถามกลับ ไม่เดา default มั่ว
- **Prompt caching** — system prompt (5 product schemas + รายการกระดาษ + กฎราคา) ใหญ่และคงที่ → cache ไว้ ลด cost + latency (ดู `claude-api` skill)
- รุ่นโมเดล: เริ่มด้วย **Claude Haiku** (spec extraction เป็นงานเบา, ถูก, เร็ว) — escalate เป็น Sonnet ถ้าความแม่นไม่พอ

### การจัดการบทสนทนา
LINE = บทสนทนาหลายข้อความ → ต้องเก็บ state ต่อ `lineUserId`
- ตาราง `ai_quote_sessions` (Postgres) เก็บ conversation history + spec ที่สกัดได้สะสม
- endpoint stateless: โหลด history → ต่อข้อความใหม่ → เรียก Claude → เซฟ

### กรณีที่ต้อง escalate ให้คน
- งานนอก 5 ประเภท / กระดาษพิเศษไม่อยู่ในตาราง / จำนวนสูงผิดปกติ / ลูกค้าขอต่อรอง / ลูกค้าหงุดหงิด
- AI ตอบสุภาพ "เดี๋ยวทีมงานติดต่อกลับนะคะ" + แจ้งเข้ากลุ่ม LINE พนักงาน

---

## 5. ชั้น 2 — Pricing Engine

### หัวใจ: reuse สูตร calculator ตรงๆ
`print-calculator-next/lib/calc.ts` เป็น **pure functions** (`computeBrochure(config, input)`, `computeBook`, `computeNotebook`, `computeBox`, `computeBag`) — ไม่มี side effect, ไม่แตะ DOM → **รัน server-side ได้เลย**

→ AI สกัด spec → เรียก `computeX` ตัวเดียวกับที่ calculator ใช้ → **ราคาตรงกัน 100% ไม่มี drift**

### การ share โค้ดข้าม repo (decision ที่ต้องเลือก)
calc.ts อยู่ใน repo `print-calculator-next` แต่ฟีเจอร์นี้อยู่ใน `penprinting-dashboard` — 2 ตัวเลือก:

| ตัวเลือก | ข้อดี | ข้อเสีย |
|---|---|---|
| **A. Copy** `calc.ts`+`types.ts`+`defaults.ts` เข้า dashboard | เร็ว, ไม่ต้อง infra | duplication → ราคา drift เมื่อ calculator แก้สูตร |
| **B. Calculator เปิด pricing API** (`calc.penprinting.co/api/quote`) รัน `computeX` server-side ด้วย `DEFAULT_CONFIG` | **single source of truth** — สูตรอยู่ที่เดียว, calculator-tuner ดูแลที่เดียว | ต้องเพิ่ม API route ใน calculator (เล็ก) |

→ **แนะนำ B** — calculator เป็นเจ้าของสูตร, dashboard/AI แค่เรียก. กัน drift ถาวร. (calculator เป็น client-side PWA ตอนนี้ — เพิ่ม route `/api/quote` 1 ตัว ไม่กระทบ PWA)

### Config / ราคากระดาษ
`DEFAULT_CONFIG` ใน `defaults.ts` = ราคาจริง (calculator-tuner sync กับ Google Sheet master อยู่แล้ว) → server-side ใช้ `DEFAULT_CONFIG` เป็น source

### ⚠️ ความเชื่อถือได้ของราคาต่างประเภท
- **โบรชัวร์ / หนังสือ / สมุด** — สูตรมาจาก Google Sheet จริง → เชื่อถือได้ → AI auto-quote ได้
- **กล่อง / ถุง** — calculator CLAUDE.md ระบุเอง: "price ตัวเลข research-based — ควร calibrate กับ quote จริง 2-3 ใบ" → **Phase 1 ให้ AI quote กล่อง/ถุงแบบ "ราคาประเมิน ต้องยืนยัน" หรือ escalate** จนกว่าจะ calibrate

---

## 6. ชั้น 3 — Quote Delivery

> **🔑 Decision (คุณนุ๊ก 2026-05-17): AI ให้แค่ "ราคาเบื้องต้น" — ใบเสนอราคาเต็มรูปแบบ ทีม sales ทำมือใน PEAK เสมอ. PEAK API ตัดออกจาก scope ทั้งหมด.**

ขอบเขตของ AI จบที่ **"ตอบราคาประเมินเบื้องต้น"** เท่านั้น:

```
ลูกค้าถาม → AI ตอบราคาเบื้องต้น → ลูกค้าสนใจ/ขอใบเสนอราคาจริง
                                          ↓
              AI: "เดี๋ยวทีมขายทำใบเสนอราคาเต็มรูปแบบให้นะคะ" + บันทึก lead
                                          ↓
                  ทีม sales เห็น lead ใน dashboard → ติดต่อ + ทำใบเสนอราคาใน PEAK เอง
```

- AI ส่ง **ราคาเบื้องต้น** เป็นข้อความ (LINE) หรือการ์ดราคา (จอ) — กรอบคำพูดชัดว่า "ราคาประเมิน ทีมขายยืนยันอีกที"
- ลูกค้าอยากได้ใบเสนอราคาจริง → AI **ไม่ทำใบเสนอราคา** — บันทึกเป็น **lead** (ตาราง `ai_quotes`/`ai_quote_sessions`) → sales หยิบไปทำต่อใน PEAK
- **ไม่แตะ PEAK API, ไม่ auto-create draft order** — กัน /board ปนเลด AI ที่ยังไม่ถูกตรวจ. Sales เป็นคนเปิด order/quote จริงเอง
- ใบเสนอราคาทางการ + บัญชี = workflow PEAK เดิมของ sales 100% — ไม่กระทบ

### ราคาที่แสดง — business rule (D4, คุณนุ๊ก 2026-05-17)

- แสดง **ราคาต่อชิ้น** (`unitPrice` จาก calculator) — ไม่ใช่ราคารวม
- **ก่อน VAT** — และ AI **ต้องระบุชัดทุกครั้ง**ว่า "ราคานี้ยังไม่รวม VAT 7%"
- **ไม่ปัดเศษ** — โชว์เลขตรงจาก calculator (เช่น "2.47 บาท/ชิ้น" ไม่ใช่ "2.50")
- ราคาจาก calculator = **ราคาขายแล้ว** (รวมกำไรในสูตร) → AI ใช้ตรงๆ ห้ามบวก margin เพิ่ม
- ราคา **ไม่ผูกมัด** — กรอบคำพูด "ราคาประเมินเบื้องต้น ทีมขายยืนยันราคาจริงอีกครั้ง"

---

## 7. ช่องทาง (Channels)

### Phase 1a — In-dashboard "AI Quote Assistant" (พนักงานใช้ก่อน)
- หน้าใหม่ใน dashboard: พนักงานวาง/พิมพ์คำขอลูกค้า → AI สกัด spec → แสดง spec ที่เข้าใจ + ราคาเบื้องต้น → พนักงาน **review/แก้** → คัดลอกข้อความราคาส่งลูกค้า / บันทึกเป็น lead
- **ความเสี่ยงต่ำ** — ภายใน, พนักงานตรวจก่อนเสมอ → ใช้พิสูจน์ความแม่นของ AI extraction ก่อนเปิดให้ลูกค้า

### Phase 1b — LINE OA (ลูกค้าใช้เอง) — หลัง 1a พิสูจน์แล้ว
- ดู §8 flow. เปิดหลังมั่นใจความแม่น
- จุดเชื่อม (จากการ research LINE): เพิ่ม bucket `aiEvents` ใน Apps Script `doPost` — ข้อความ text ที่ **ไม่ใช่** `/track` และมาจาก **1-on-1** (`event.source.type === 'user'` — ไม่เอา group พนักงาน) → `UrlFetchApp.fetch` ไปยัง endpoint AI ใน dashboard → reply
- ⚠️ **reply token ของ LINE หมดอายุ ~1 นาที** — Claude ตอบเร็ว (~2-5 วิ) ปกติทัน แต่เผื่อช้า → fallback ใช้ push API
- Cloudflare Worker = dumb fan-out — ไม่ต้องแตะ, routing ทำที่ Apps Script

#### 🔒 Acceptance criterion — session ownership / IDOR (audit **M5**, gate ของ 1b)
ใน Phase 1a ทุก caller = staff ภายใน (admin/sales) → `loadSession` แบบ shared inbox **เป็น design ที่ตั้งใจ ไม่ใช่ช่องโหว่**. IDOR จริงเกิด**เมื่อเปิด LINE** เพราะลูกค้าแต่ละคนถือ `sessionId` ของตัวเอง → ถ้าไม่ผูก owner ลูกค้า A อ่านบทสนทนา/ราคาของลูกค้า B ได้. **ต้องทำตอนสร้าง LINE identity ใน 1b** (ผูกก่อน ไม่ได้ — ยังไม่มี identity model):
1. เซ็ต `line_user_id` ตอนสร้าง session ฝั่ง LINE (`channel='line'`) + เซ็ต `channel='line'`
2. LINE route โหลด session ด้วย `loadSession(id, { channel: 'line' })` **+ เช็ค `line_user_id` ตรงกับ sender** ก่อนคืนบทสนทนา (mismatch → 404, ไม่ใช่ leak)
3. **มีแล้ว (prep 2026-06-26):** channel scope — staff chat route เรียก `loadSession(id, { channel: 'dashboard' })` → staff `sessionId` กับ LINE `sessionId` cross-load กันไม่ได้ตั้งแต่ก่อน 1b ([`lib/ai-quote/db.ts` loadSession](lib/ai-quote/db.ts) + [route](app/api/ai-quote/route.ts)). 1b เพิ่ม owner-check ทับ channel scope

---

## 8. Data Model (Postgres — v2 mirror)

ตารางใหม่ (Phase 2 migration-aligned — ออกแบบ Postgres-native ตั้งแต่แรก):

```
ai_quote_sessions   ← 1 session = 1 "lead" (ดูใน /quote-leads)
  id, channel ('dashboard' | 'line'), line_user_id (nullable),
  conversation jsonb,        -- history
  extracted_spec jsonb,      -- spec ล่าสุดที่สกัดได้
  customer_name, customer_contact (nullable — Brain Q4 จะ finalize),
  lead_status ('ใหม่'|'กำลังติดตาม'|'ปิดการขาย'|'ไม่สนใจ'|'escalated'|'abandoned'),
  assigned_to (nullable — ผู้ดูแล LINE OA / sales ที่หยิบ),
  converted_order_id (nullable, fk → orders — เซ็ตเมื่อ sales เปิด order จริง),
  created_at, updated_at

ai_quotes
  id, session_id (fk), product_type, spec jsonb,
  result jsonb,              -- output ของ computeX
  unit_price,                -- ราคาที่โชว์ (ต่อชิ้น ก่อน VAT — D4)
  created_at
```

→ `lead_status` + `converted_order_id` ทำให้ track **conversion funnel** ได้ (lead กี่ราย → ปิดการขายกี่ราย)

---

## 9. แผนการทำ (Phasing)

| Phase | ขอบเขต | เสี่ยง |
|---|---|---|
| **0** ✅ | Calculator เปิด `/api/quote` (server-side pricing) — **DONE 2026-06-17** (`3edcfe1`), token live 6/23 (`fd4f755`) | ต่ำ |
| **1a** ✅ | In-dashboard AI Quote Assistant (พนักงาน, review ก่อนเสมอ) — **built + preview-verified + audited 2026-06-23** (branch `feat/ai-quote-phase1a`, รอ merge + prod smoke) | ต่ำ |
| **1b** | LINE OA AI quoting (ลูกค้า, 1-on-1) — โบรชัวร์/หนังสือ/สมุด ก่อน | กลาง |
| **1c** | เพิ่มกล่อง/ถุง หลัง calibrate ราคา | กลาง |

แต่ละ phase ใช้งานได้จริงด้วยตัวเอง — หยุดที่ไหนก็ได้คุณค่า

> ~~Phase 2 (PEAK API)~~ **ตัดออก** — ตาม decision คุณนุ๊ก: ใบเสนอราคาเต็ม sales ทำมือใน PEAK. การ automate PEAK = โปรเจกต์แยก ไม่ผูกกับฟีเจอร์นี้

---

## 10. การวิเคราะห์ต้นทุน

### Claude API (ต้นทุน AI — ถูกมาก)
- 1 quote conversation ≈ ไม่กี่ turn. Input ~2-5k tokens (ส่วนใหญ่ cache ได้), output ~1k
- ใช้ Haiku + prompt caching → ต่อ quote **< ~1-2 บาท** แม้ 1,000 quote/เดือน ก็ระดับ "หลักร้อยบาท/เดือน"
- → **ต้นทุน AI แทบไม่มีนัยสำคัญ**

### PEAK API (ต้นทุนจริง — ยืนยันจากใบเสนอราคา PEAK 2026-04-16)

**โครงสร้างราคา PEAK API:**
| รายการ | ราคา | หมายเหตุ |
|---|---|---|
| เงื่อนไขขั้นต่ำ | PEAK **Pro Plus** 12,000 บาท/ปี | ต้องอยู่แพ็กเกจนี้ขึ้นไปก่อน |
| Initial Setup | **5,000 บาท** | จ่ายครั้งเดียว |
| API package — Starter | **12,000 บาท/ปี** | 500 รายการ/เดือน (เกิน 2 บาท/รายการ) |
| API package — Essential | 24,000 บาท/ปี | 1,000 รายการ/เดือน (เกิน 1 บาท) |
| API package — Pro | 30,000 บาท/ปี | 2,500 รายการ/เดือน (เกิน 0.5 บาท) |

**กฎการนับ transaction (สำคัญมาก):**
- ✅ **นับ** (1 transaction): POST สร้างเอกสาร, Edit, Approve, Void
- ❎ **ฟรี ไม่จำกัด**: **GET ทุกอย่าง**, แนบไฟล์, E-Tax, ดึงผังบัญชี
- → `peak-contacts-proxy` ที่มีอยู่ (GET Contacts) = **ฟรี ไม่กิน quota** — แต่ยังต้องซื้อ package ถึงจะเปิด API ได้
- รองรับ **Batch** ส่งรวมรายการ ประหยัด quota

**ต้นทุนรวมปีแรกถ้าทำ Phase 2:** Setup 5,000 + Starter 12,000 + (ถ้ายังไม่ได้อยู่ Pro Plus) 12,000 = **~17,000–29,000 บาทปีแรก**, จากนั้น ~12,000–24,000/ปี

### ⚖️ ข้อสรุปต้นทุน-คุ้มทุน

**สำหรับ AI quoting อย่างเดียว — PEAK API ไม่คุ้ม:**
- POST ใบเสนอราคา 1 ใบ = 1 transaction. สมมติ ~90 ใบ/เดือน → Starter (500/เดือน) เหลือเฟือ
- แต่ค่าที่ประหยัด = เวลาคีย์ PEAK เอง ~90 ใบ × ~3 นาที × ค่าแรง ≈ **~8,000 บาท/ปี**
- เทียบกับ API Starter 12,000/ปี + setup 5,000 → **ขาดทุน** ถ้าทำเพื่อ quoting อย่างเดียว

**PEAK API จะคุ้มก็ต่อเมื่อมองภาพใหญ่กว่า quoting:**
PEAK pitch คือ automate **ทั้งวงจร** (order → ใบแจ้งหนี้ → ใบเสร็จ → สมุดรายวัน) — ไม่ใช่แค่ใบเสนอราคา. ถ้าทำทั้งวงจร ค่า package ถูก amortize กับงานบัญชีที่ลดได้ทั้งหมด (คีย์ซ้ำทุกเอกสาร ทุกออเดอร์) → คุ้มกว่ามาก
- 👉 **การตัดสิน PEAK API ควรเป็นโปรเจกต์แยก** ("automate ops↔บัญชีทั้งระบบ") ไม่ใช่ผูกกับ AI quoting
- AI quoting (Phase 1) **ไม่ต้องรอ** การตัดสินนั้น — เดินได้เลย ฟรีค่า PEAK

---

## 11. ความเสี่ยง + คำถามค้าง

| ความเสี่ยง | การลดความเสี่ยง |
|---|---|
| AI สกัด spec ผิด → ราคาผิดส่งถึงลูกค้า | Phase 1a ให้พนักงานตรวจก่อน; AI แสดง spec ที่เข้าใจให้ยืนยัน; auto-send เฉพาะเคส confidence สูง+งานง่าย |
| ลูกค้าได้ราคาแล้วโรงพิมพ์ทำไม่ได้ตามนั้น | ระบุ "ราคาประเมินเบื้องต้น — ยืนยันโดยทีมงาน"; quote เฉพาะช่วงที่สูตร validated |
| กล่อง/ถุง ราคายัง research-based | Phase 1 escalate หรือ tag "ต้องยืนยัน"; calibrate ก่อนเปิด 1c |
| LINE reply token หมดอายุ | fallback push API |
| สแปม/abuse บน LINE | rate-limit ต่อ userId |
| งานนอก 5 ประเภท | AI detect + escalate |

**คำถามค้างที่ต้อง verify:**
1. ~~ค่า PEAK API~~ ✅ ยืนยันแล้ว — PEAK ตัดออกจาก scope (ใบเสนอราคา sales ทำมือ)
2. จำนวนใบเสนอราคา/เดือน — ยังอยากได้ไว้ประเมิน scale (ไม่บล็อก Phase 1)
3. ~~calc-sharing A vs B~~ ✅ เลือก **B** (calculator เปิด API)
4. `ANTHROPIC_API_KEY` — มี API key อยู่แล้วหรือต้องสร้างใหม่ใน Anthropic Console

---

## 12. Decisions log

| # | Decision | วันที่ |
|---|---|---|
| D1 | AI ตอบแค่ "ราคาเบื้องต้น" — ใบเสนอราคาเต็ม sales ทำมือใน PEAK. **PEAK API ตัดออกทั้งหมด** | 2026-05-17 |
| D2 | calc-sharing = **B** — calculator เปิด `/api/quote` (single source of truth) | 2026-05-17 |
| D3 | เริ่ม **Phase 0 + 1a** (in-dashboard, staff-facing) ก่อน | 2026-05-17 |
| D4 | ราคาที่แสดง = **ราคาต่อชิ้น ก่อน VAT** (ระบุชัดว่ายังไม่รวม VAT), ไม่ปัดเศษ, ใช้ราคา calculator ตรงๆ (ราคาขายแล้ว) | 2026-05-17 |
| D5 | Lead handoff = **หน้าใหม่ `/quote-leads`** แยกจาก `/orders` (lead ≠ order). ผู้รับผิดชอบ follow-up = **admin ผู้ดูแล LINE OA**. SLA — ยังไม่ตั้ง (มี timestamp + status ดูเองได้ ค่อยเพิ่มทีหลัง) | 2026-05-17 |
| D6 | Persona — **1a**: ทีม sales + เจ้าของ/admin (ไม่รวมกราฟิก → role gate `adminOrSalesOnly`). **1b**: ลูกค้า LINE OA ผสมเก่า/ใหม่ → AI hand-hold คนใหม่ ใช้ภาษาชาวบ้าน ไม่ assume ศัพท์งานพิมพ์ | 2026-05-17 |
| D7 | Journey edge cases — (1) หลายงาน/แชต = `compute_quote` แยกชิ้น สรุปรวม (2) ต่อราคา → AI ไม่ลด → escalate (3) เก็บชื่อ+เบอร์: 1a พนักงานกรอก / 1b AI ถาม (4) คาบเส้น digital/offset → รายงาน mode ที่ calc เลือก + tip upsell | 2026-05-17 |
| D8 | Phase 1a scope — AI auto-quote **แค่ brochure/book/notebook** (สูตร validated). **box/ถุง = escalate อย่างเดียว** (research-based ยังไม่ calibrate) → auto-quote box/bag เลื่อนเป็น Phase 1c. งานนอก 5 ประเภท escalate เหมือนเดิม | 2026-06-20 |

---

## 13. Implementation Plan — Phase 0 + 1a

> ขอบเขต: calculator pricing API + หน้า AI Quote Assistant ในจอ (พนักงานใช้). ยังไม่แตะ LINE (1b) / กล่อง-ถุง auto (1c).

### Phase 0 — Calculator Pricing API ✅ DONE (2026-06-17)
Repo: **`print-calculator-next`** · Deploy: Vercel auto · commit **`3edcfe1`**

| ไฟล์ | งาน | สถานะ |
|---|---|---|
| `app/api/quote/route.ts` 🆕 | `POST` endpoint — รับ `{ productType, spec }` → รัน `computeBrochure/Book/Notebook/Box/Bag(DEFAULT_CONFIG, spec)` → คืน `{ productType, spec, result }` JSON | ✅ |
| `lib/quote-schema.ts` 🆕 | Zod schema ของ 5 input types (mirror `types.ts`) — validate ก่อนคำนวณ | ✅ |

- ✅ verified (build-time): `next.config.js` ไม่มี `output: 'export'` → route ขึ้นเป็น `ƒ (Dynamic)` บน Vercel ได้
- **Auth**: header `x-quote-token` === env `QUOTE_API_TOKEN` (shared secret) — **ไม่ตั้ง env = POST คืน 500 "not configured"** → endpoint inert, ship-dark ได้
- **CORS**: allow origin `dashboard.penprinting.co` (+ OPTIONS preflight)
- ✅ **Verify (curl)**: brochure offset `unitPrice 5.048225` / digital `30·3000` / box STE `22.76·11380·boxes2·sheets250·die large` — **ตรงสูตร calculator 100%** · 401 (token ผิด) · 422 (กระดาษไม่รู้จัก + list options / box ใหญ่เกินเครื่อง infeasible)
- ✅ **Production live**: `calc.penprinting.co/api/quote` คืน `500 "not configured"` (inert) — route deployed สำเร็จ

> **ปรับจาก design เดิม** (engineering call, ระบุไว้กัน confusion): (1) ตัด `finishing?` ออกจาก request — `computeX` ไม่รับ finishing เป็น input, fees อยู่ใน Result อยู่แล้ว · (2) เพิ่ม paperName validation (ไม่รู้จัก → 422 ไม่ปล่อยราคา 0 เงียบ) · (3) box/bag infeasible → 422 escalate · (4) calculator เป็น Next 15 + React 19 แล้ว (doc เดิมเขียน Next 14) + สูตร book/inner มี fix 5/23 หลัง doc

**⏳ Pending user action**: ตั้ง env `QUOTE_API_TOKEN` ใน Vercel project `penprinting-calc` (ค่า random เช่น `openssl rand -hex 32`) — ค่าเดียวกันจะใช้ใน dashboard project ตอน Phase 1a

### Phase 1a — AI Quote Assistant (in-dashboard) ✅ BUILT + PREVIEW-VERIFIED + AUDITED (2026-06-23)
Repo: **`penprinting-dashboard`** · Branch: **`feat/ai-quote-phase1a`** (ยังไม่ merge main — รอ merge PR + 1 happy-path prod smoke)

> **✅ Built (2026-06-23)** — Tasks 1-10 (10 commits `1424bfa`→`5d2de19`, 6/22, TDD +11 tests) + lint reconcile `d773ea9` + audit fix `902d70a` (H1/H2/M1/M2 +2 test). Gates เขียว Node 22: type-check / lint "No issues found" / **161 tests** / build 40 หน้า.
> - **Files (ตามที่ลงจริง):** `lib/ai-quote/{prompt,tools,run,db}.ts` (run loop = manual tool-use `MAX_TOOL_ROUNDS=6`, **Haiku 4.5** `claude-haiku-4-5` + prompt caching) · `app/api/ai-quote/route.ts` (+ `leads/route.ts` GET · `leads/[id]/route.ts` PATCH) · `app/quote-assistant/` · `app/quote-leads/` · nav 2 เมนู (`adminOrSalesOnly`) · Postgres `ai_quote_sessions` + `ai_quotes` ผ่าน db-migrate route (idempotent).
> - **Env (Vercel `penprinting-dashboard`, All Environments):** `ANTHROPIC_API_KEY` + `QUOTE_API_URL=https://calc.penprinting.co/api/quote` + `QUOTE_API_TOKEN`.
> - **Preview smoke ผ่านครบ** (empty commit `80d5c2a` trigger): db-migrate idempotent · quote brochure A4/4สี2หน้า/Art160/1000 → **5.048225 บาท/ชิ้น ตรง calc เป๊ะ** + offset mode + VAT card · escalation (กล่อง → ไม่ตีราคา, escalate ทีมขาย D8) · lead flow (บันทึก→/quote-leads→เปลี่ยน status ปิดการขาย + หยิบงาน → reload persist) · auth admin (nook) เข้า 2 เมนู.
> - **Calc token fix:** smoke เจอ calc 500 "QUOTE_API_TOKEN not configured" — env ตั้งใน calc ตั้งแต่ 6/20 แต่ prod deploy ล่าสุด = `3edcfe1` (6/17 ก่อนมี token) → push empty commit `fd4f755` (repo `penprinting-calc`) → auto-deploy → token live (probe 500→401). **env var live ต่อเมื่อมี deploy ใหม่หลังตั้ง.**
> - **Audit deferred → [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) open**: M3 (escalation lead ไม่ wired + markEscalated dead) · M4 (lead-claim race) · M5 (loadSession IDOR — **ต้องปิดก่อน Phase 1b**) · 3 Low.
> - **Pending user note**: AI clarify เยอะไป (Haiku ระวังเกินตอนสกัด spec) — prompt-tuning candidate รอบหน้า.

> **🔎 Audit refinement (2026-06-20, ก่อนเขียน implementation plan — [[feedback_audit_before_plan]]):**
> - **Scope รอบแรก (D8, คุณนุ๊ก 2026-06-20):** AI auto-quote **แค่ brochure/book/notebook** (สูตร validated จาก Sheet). **box/bag → escalate อย่างเดียว** (AI ตรวจจับ → ไม่ตีราคา → "งานกล่อง/ถุงขอให้ทีมงานประเมินราคาให้" + บันทึก lead) เพราะราคา research-based ยังไม่ calibrate. box/bag auto-quote = Phase 1c (หลัง calibrate). งานนอก 5 ประเภท (นามบัตร/สติกเกอร์/โปสการ์ด) → escalate เหมือนเดิม.
> - **2 delta จาก design เดิม (dashboard เปลี่ยนหลัง doc เขียน 5/17):**
>   1. **Postgres migration ไม่ใช่ `lib/migrations/`** — dashboard ใช้ **append `CREATE TABLE IF NOT EXISTS` ใน `app/api/admin/db-migrate/route.ts`** (sql tagged template `@vercel/postgres`) → admin รัน `GET /api/admin/db-migrate` ในเบราว์เซอร์ (idempotent). ai_quote_sessions + ai_quotes เพิ่มที่นี่.
>   2. **dashboard = Next 15 + React 19 แล้ว** (`2c22301` 2026-06-20) → page ใหม่ใช้ `await cookies()` + `verifySession` + redirect (async) · API route ใหม่ใช้ `requireSession(['admin','sales'])` (คืน `Session | NextResponse`, caller เช็ค `instanceof NextResponse`).
> - **Phase 0 contract ยืนยัน (จาก calc โค้ดจริง):** `POST /api/quote` · header `x-quote-token` · 200 `{productType, spec, result}` · 401 token ผิด · 422 spec ผิด/paperName ไม่รู้จัก (คืน list ที่ถูก)/กล่องใหญ่เกินเครื่อง infeasible · 500 ไม่ตั้ง token. spec schema 5 ตัว = `print-calculator-next/lib/quote-schema.ts` (paperName ต้องอยู่ใน DEFAULT_CONFIG). tool `compute_quote` เรียกอันนี้ด้วย `QUOTE_API_TOKEN` ฝั่ง dashboard.

**1. Dependencies + env**
- `npm i @anthropic-ai/sdk zod`
- Vercel env ใหม่: `ANTHROPIC_API_KEY`, `QUOTE_API_URL` (= calc `/api/quote`), `QUOTE_API_TOKEN`

**2. Postgres schema** — `lib/migrations/` (ตาม §8)
- `ai_quote_sessions` (= lead store — `lead_status` ภาษาไทย, `assigned_to`, `converted_order_id`, customer info)
- `ai_quotes` (id, session_id fk, product_type, spec jsonb, result jsonb, unit_price, created_at)
- Postgres-native ตั้งแต่แรก (สอดคล้อง migration plan)

| ไฟล์ | งาน |
|---|---|
| `app/api/ai-quote/route.ts` 🆕 | รับ `{ sessionId?, message }` → โหลด/สร้าง session → เรียก Claude (tool-use) → persist → คืน reply + spec + price |
| `lib/ai-quote/prompt.ts` 🆕 | system prompt — 5 product schema + รายการกระดาษ (จาก `defaults.ts`) + กฎ (ห้ามเดาราคา, ราคาต่อชิ้น+ระบุก่อน VAT, ถาม field ที่ขาด, escalate งานนอก scope, กล่อง/ถุง = "ราคาประเมิน") |
| `lib/ai-quote/tools.ts` 🆕 | tool `compute_quote(productType, spec)` → fetch calc `/api/quote` → คืน Result ให้ Claude |
| `lib/ai-quote/db.ts` 🆕 | session/quote/lead CRUD บน Postgres |
| `app/quote-assistant/page.tsx` + `client.tsx` 🆕 | หน้า staff ตีราคา — `requireSession(['admin','sales'])` · chat UI + spec (แก้ได้) + ราคา + ปุ่ม "คัดลอกข้อความราคา" / "บันทึกเป็น lead" |
| `app/quote-leads/page.tsx` + `client.tsx` 🆕 | **หน้า Lead (D5)** — ตาราง lead + `lead_status` (ใหม่/กำลังติดตาม/ปิดการขาย/ไม่สนใจ) + ปุ่มเปลี่ยนสถานะ/หยิบงาน · `requireSession(['admin','sales'])` |
| `components/nav-config.ts` ✏️ | เพิ่ม 2 เมนู: `ผู้ช่วยตีราคา (AI)` → `/quote-assistant`, `Lead ใบเสนอราคา` → `/quote-leads` (ทั้งคู่ `adminOrSalesOnly`) |

**3. กลไก AI (หัวใจ)**
- Claude API + **tool use** — Claude ถูกบังคับเรียก tool `compute_quote` เพื่อได้ราคา (output ราคาเองไม่ได้)
- **Prompt caching** บน system block (schema+กระดาษ+กฎ ใหญ่+คงที่) — ลด cost/latency
- Model: เริ่ม **Haiku** (spec extraction งานเบา) — วัดความแม่นแล้วค่อยตัดสินว่าขึ้น Sonnet มั้ย
- บทสนทนาหลาย turn → state เก็บใน `ai_quote_sessions.conversation`

**4. Verification**
- `type-check + lint + test + build` (บน Node 22 ✅)
- Manual: ป้อนคำขอจริงจาก quote เก่า 5-6 ใบ → เทียบราคา AI กับหน้า calculator
- `/audit` (penprinting-auditor) หลังเสร็จ

### ลำดับงาน
`Phase 0 (calc API)` → `1a.1 deps/env` → `1a.2 schema` → `1a.3 ai-quote API + prompt + tools` → `1a.4 UI + nav` → verify

### นอก scope รอบนี้
LINE channel (1b) · กล่อง/ถุง auto-quote (1c) · PEAK · auto-create draft order · push หาลูกค้า
