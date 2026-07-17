# RUNBOOK — HINT-1: เปิด hint Messenger คืน (staff-activity suppression)

> ✅ **COMPLETED 2026-07-11** — ครบทั้ง 6 steps, verify 3 ข้อผ่านบน Messenger จริง, hint Messenger เปิดแล้ว.
> เก็บไฟล์นี้เป็น reference + rollback instructions (ท้ายไฟล์)
>
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

## 4. Subscribe message_echoes — ต้องเป็น Page-level เท่านั้น
⚠️ **Meta มี subscription 2 ชั้น — ชั้นที่ตัดสินว่า event ถูกส่งคือระดับ Page** (บทเรียน 2026-07-17:
กดที่ชั้น app แล้วนึกว่าเสร็จ → echo ไม่เคยถูกส่ง 6 วัน → hint แทรกกลางบทสนทนาพนักงานซ้ำ 7/16)

Meta App dashboard → Messenger → **Messenger API Settings → "2. Generate access tokens"**
→ แถว Page Penprinting คอลัมน์ Webhook Subscription → คลิก → **Edit** → ติ๊ก `message_echoes`
(คงของเดิม `messages`, `messaging_postbacks`) → Confirm → แถวต้องแสดง **"See Full 3 fields"**

## 5. Verify (critical — ก่อนเปิด hint flag) — ต้องใช้หลักฐาน DB เท่านั้น
⚠️ **ห้าม verify จากพฤติกรรม AI** ("AI เงียบ" = false positive ได้จาก mode idle-expire —
เกิดจริง 2026-07-11 ทำให้เชื่อว่า takeover ทำงานทั้งที่ echo ไม่เคยมาถึง)

- [x] **Echo-to-DB (หลักฐานตรง)**: พนักงานส่งข้อความจาก Page inbox หา conversation บัญชี test →
      query Neon (Vercel Storage → Query, read-only): `SELECT channel_user_id, last_staff_reply_at
      FROM ai_quote_line_modes WHERE last_staff_reply_at IS NOT NULL;` → ต้องมี row stamp ≈ เวลาที่ส่ง
      ✅ 2026-07-17 10:45:08 ICT (stamp ตรงวินาที) — ถ้าไม่ stamp = echo ไม่มาถึง กลับไปเช็ค step 4
- [x] **บอทไม่เตะตัวเอง**: เข้าโหมด AI (เมนู ☰) → คุย 2-3 เทิร์น → AI ต้องตอบต่อเนื่องไม่หลุดโหมด ✅ 2026-07-11
      (ถ้าหลุดหลังบอทตอบ = การจำแนก app_id ผิด → ปิด subscribe message_echoes แล้วแจ้ง Claude ทันที)
- [~] **Takeover**: บัญชี test เข้าโหมด AI → พนักงานตอบจาก Page inbox → ข้อความถัดไปของ test
      ต้องไม่ถูก AI ตอบ (โหมดโดนเคลียร์) — ⚠️ ผล ✅ 2026-07-11 เป็น **false positive** (echo ยังไม่ send
      ในตอนนั้น); พิสูจน์จริงผ่าน Echo-to-DB 2026-07-17 แทน (recordStaffReply เคลียร์โหมดใน upsert เดียวกัน)
- [~] **Suppress**: หลังพนักงานตอบ → บัญชี test (นอกโหมด) พิมพ์ข้อความธรรมดา → ต้องไม่มี hint —
      ⚠️ ผล ✅ 2026-07-11 เป็น false positive เช่นกัน; คุ้มครองจริงเมื่อ last_staff_reply_at stamp (7/17)

## 6. เปิด hint
Vercel env `AI_QUOTE_MESSENGER_HINT_ENABLED=true` → **Redeploy**
(⚠️ ห้ามเปิด flag นี้ก่อน step 4 subscribe message_echoes — flag on โดยไม่มี echo signal = ซ้ำ incident 7/09)
(⚠️ LINE: `AI_QUOTE_LINE_HINT_ENABLED` ปิดถาวร — ไม่มี staff signal บน LINE, ทางเข้า = rich menu)

## Rollback
`AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy (แบบ incident 7/09) — detector/takeover
คงอยู่ได้ไม่มีพิษ (takeover มีประโยชน์แม้ hint ปิด). ถอนสุด = เอา `message_echoes` ออกจาก subscription
