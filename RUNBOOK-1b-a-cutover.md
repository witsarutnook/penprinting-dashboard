---
title: Runbook — Cutover Phase 1b-A (LINE webhook takeover)
created: 2026-06-29
pr: https://github.com/witsarutnook/penprinting-dashboard/pull/11
status: ✅ done — cutover เสร็จ 2026-06-30
owner: คุณนุ๊ก (Thunder/LINE/Vercel เป็น user-only); Claude ช่วย health-check + อ่าน log
---

# 🚀 Runbook — Cutover Phase 1b-A (LINE webhook takeover)

> ## ✅ CUTOVER เสร็จแล้ว (2026-06-30) — เก็บไว้เป็น historical + rollback reference
> - Webhook `https://dashboard.penprinting.co/api/ai-quote/line` **LIVE** (probe 200) · PR #11/#12/#13 merged · Thunder/LINE env ครบ
> - **Slip pre-filter:** เปิด→remove (`e4a05b3`, สลิปจ่ายบิลโดน drop)→re-add (`0139d31`, แก้ prompt) — **final: เปิดอยู่ + recognize bill-payment**
> - **`slip_checks` migration applied 2026-06-30** (db-migrate ผ่านเบราว์เซอร์คุณนุ๊ก) — slip-metrics 500→200
> - **เหลือ:** ถอด diagnostic logging 5 จุด (`LOG-1`) · ดู slip-metrics หลัง traffic 2-3 วัน · Phase 1b-B
> - **Rollback ยังใช้ได้:** ดู §🔙 ด้านล่าง (ชี้ Webhook URL กลับค่าเดิม — ไม่ต้อง revert code)

> **เป้าหมาย:** Dashboard รับ webhook LINE OA penprinting เต็มตัว (Path 1)
> → รูปสลิป (Thunder verify + Haiku vision pre-filter) · `/track` (Flex card) · อย่างอื่นเงียบ (AI ยังปิด)
>
> **Webhook URL ใหม่:** `https://dashboard.penprinting.co/api/ai-quote/line`
>
> PR: [#11](https://github.com/witsarutnook/penprinting-dashboard/pull/11) — `feat/ai-quote-phase1b-a-line-webhook` (16 commits, 227 tests, mergeable)

---

## ⚠️ กฎลำดับสำคัญ (เคยพลาดมาก่อน — [[feedback_ai_quote_phase1a]])

**ตั้ง env ใน Vercel ให้ครบ → ค่อย merge PR #11**
เพราะ env จะ live เฉพาะ deploy ที่เกิด **หลัง** ตั้งค่า ถ้า merge ก่อนตั้ง env → ต้อง redeploy ซ้ำอีกรอบ

---

## Phase A — เก็บ credentials (คุณนุ๊กทำเอง)

### A1. Thunder (slip verify)
- [ ] login Thunder → เพิ่มสาขา/โปรเจกต์ **"Penprinting"**
- [ ] เพิ่ม **บัญชีรับเงินของร้าน** (ที่ลูกค้าโอนเข้า) ทั้งหมด → ใช้กับ `matchAccount` (โค้ดเช็คว่าโอนเข้าบัญชีร้านจริงไหม)
- [ ] copy **KeyAPI** (จะเป็นค่า `THUNDER_API_KEY`)
- [ ] เช็ค **quota คงเหลือ** ของเดือนนี้

### A2. LINE Console (OA penprinting → Messaging API channel)
- [ ] copy **Channel secret** → `LINE_CHANNEL_SECRET`
- [ ] copy/issue **Channel access token (long-lived)** → `LINE_CHANNEL_TOKEN`
- [ ] 📌 **บันทึก Webhook URL เดิม** ไว้ก่อน (เป็น rollback target — สำคัญมาก)

---

## Phase B — Vercel env + deploy (project `penprinting-dashboard`)

### B1. ตั้ง env (Production) — Settings → Environment Variables
- [ ] `LINE_CHANNEL_SECRET` = (จาก A2)
- [ ] `LINE_CHANNEL_TOKEN` = (จาก A2)
- [ ] `THUNDER_API_KEY` = (จาก A1)
- [ ] `THUNDER_API_URL` = **ไม่ต้องตั้ง** ถ้าใช้ default `https://api.thunder.in.th/v2` (ตั้งเฉพาะถ้า Thunder ให้ base URL อื่น)
- [ ] ✅ เช็คว่า `ANTHROPIC_API_KEY` **มีอยู่แล้ว** (Phase 1a ใช้ — Haiku vision pre-filter พึ่งตัวนี้)
- [ ] `AI_QUOTE_LINE_ENABLED` = **ปล่อยว่าง/ไม่ตั้ง** (1b-A ต้อง OFF — ตั้ง `true` เมื่อทำ 1b-B เท่านั้น)

### B2. Merge → deploy
- [ ] merge PR [#11](https://github.com/witsarutnook/penprinting-dashboard/pull/11) → main → Vercel auto-deploy production
- [ ] รอ deploy ✅ (จะ pick up env จาก B1 เพราะตั้งก่อน merge)

### B3. Health-check (Claude รันให้ได้ — ไม่ต้องใช้ secret)
- [ ] `GET https://dashboard.penprinting.co/api/ai-quote/line`
      → ต้องได้ `{"ok":true,"service":"penprinting line webhook"}` = route deploy แล้ว

---

## Phase C — Webhook cutover (LINE Console)
- [ ] ตั้ง **Webhook URL** = `https://dashboard.penprinting.co/api/ai-quote/line`
- [ ] กด **Verify** → ต้องขึ้น Success (LINE ส่ง POST เปล่า → route ตอบ 200)
- [ ] เปิด **Use webhook** = ON
- [ ] (ถ้ามี auto-reply/greeting เดิมของ OA ที่จะชน → ปิดตามต้องการ)

---

## Phase D — Smoke test (ส่งจาก LINE จริง → คุณนุ๊กทำ, Claude ช่วยอ่าน log)

| # | ส่งอะไรเข้า OA | ผลที่คาด |
|---|---|---|
| 1 | **รูปสลิปโอนเงินจริง** | ตอบ `"ได้รับสลิปแล้วค่ะ ✅ ยอด X บาท จากคุณ..."` (หรือ "สลิปนี้เคยส่งแล้ว"/"ยอดไม่ตรงบัญชีร้าน" ตามเคส) |
| 2 | **รูปที่ไม่ใช่สลิป** (รูปงานพิมพ์/รูปวิว) | **เงียบ ไม่ตอบ** + **ไม่กิน Thunder quota** (Haiku pre-filter กรองก่อน) |
| 3 | `track 123456` (เลขใบสั่งจริง ≥6 หลัก) | **Flex card** สถานะงาน |
| 4 | ข้อความทั่วไป เช่น `สวัสดี` | **เงียบ** (AI ยังปิด — ถูกต้อง) |
| 5 | สลิปซ้ำใบเดิม (รอบ 2) | `"สลิปนี้เคยส่งเข้ามาแล้วนะคะ..."` (duplicate detection) |

> **เคส 2 สำคัญสุด** — พิสูจน์ว่า pre-filter กัน quota burn ได้จริง
> หลัง smoke เช็ค quota Thunder ว่าลดเฉพาะเคสสลิป (1, 5) ไม่ลดจากเคส 2
> — [[feedback_ai_quote_phase1b_thunder_prefilter]]

`/track` syntax (จากโค้ด `track-flex.ts`): `^/?track\s+\d{6,}` → `track 123456` หรือ `/track 123456` (case-insensitive, เลข ≥6 หลัก)

---

## 🔙 Rollback (ถ้าพัง)
ชี้ **Webhook URL กลับเป็นค่าเดิม** (ที่บันทึกไว้ A2) ใน LINE Console — จบ
- ไม่ต้อง revert โค้ด (โค้ดใหม่อยู่ใน main แต่ไม่มีใครเรียกถ้า webhook ชี้ที่อื่น)
- env ทิ้งไว้ได้ ไม่กระทบ flow อื่น

---

## 📋 Behavior reference (จากโค้ดจริง — verify ไว้ 2026-06-29)

**Webhook flow** (`app/api/ai-quote/line/route.ts`):
1. POST → ถ้าไม่มี `LINE_CHANNEL_SECRET` → **500** "not configured"
2. verify signature (HMAC-SHA256) → ผิด → **401**
3. parse events (เฉพาะ 1-on-1; group/room ทิ้ง)
4. **ack 200 ทันที** → งานหนักรันใน `after()` แล้ว reply ผ่าน LINE API
5. per message:
   - **image** → `isSlipImage` (Haiku vision, fail-safe=true) → ถ้าไม่ใช่สลิป **return เงียบ** (ไม่เรียก Thunder) → ถ้าใช่ → `verifyBankSlipImage` (Thunder, `matchAccount:true`, `checkDuplicate:true`) → reply
   - **text `track <id>`** → `loadOrder(id)` → `buildOrderFlex` → reply Flex
   - **อื่นๆ** → ignore (เพราะ `aiEnabled=false`)

**Env ที่โค้ดอ่านจริง:**
| Env | ไฟล์ | ถ้าไม่มี |
|---|---|---|
| `LINE_CHANNEL_SECRET` | route.ts:22 | webhook ตอบ 500 |
| `LINE_CHANNEL_TOKEN` | channels/line.ts:57 | throw ตอน reply/push/download |
| `THUNDER_API_KEY` | slip.ts:38 | slip คืน failure → ลูกค้าได้ "อ่านสลิปไม่ได้" |
| `THUNDER_API_URL` | slip.ts:5 | default `https://api.thunder.in.th/v2` |
| `ANTHROPIC_API_KEY` | route.ts:36 | Haiku pre-filter พัง → fail-safe=true (ทุกรูปนับเป็นสลิป → กิน Thunder quota) |
| `AI_QUOTE_LINE_ENABLED` | route.ts:37 | default OFF (1b-A) |

**นอก scope (→ Phase 1b-B):** session/`channel_user_id` migration · mode state (KV) · customer AI prompt · escalation push · qualified-lead
