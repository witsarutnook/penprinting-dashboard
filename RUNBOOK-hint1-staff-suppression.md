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
- Vercel env `FB_APP_ID` = ตัวเลขนั้น → **Redeploy** (env live ต่อเมื่อ deploy ใหม่) (วางตัวเลขล้วน ห้ามมีช่องว่าง)

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
(⚠️ ห้ามเปิด flag นี้ก่อน step 4 subscribe message_echoes — flag on โดยไม่มี echo signal = ซ้ำ incident 7/09)
(⚠️ LINE: `AI_QUOTE_LINE_HINT_ENABLED` ปิดถาวร — ไม่มี staff signal บน LINE, ทางเข้า = rich menu)

## Rollback
`AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy (แบบ incident 7/09) — detector/takeover
คงอยู่ได้ไม่มีพิษ (takeover มีประโยชน์แม้ hint ปิด). ถอนสุด = เอา `message_echoes` ออกจาก subscription
