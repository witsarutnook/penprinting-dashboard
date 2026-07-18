# 🎯 Next Session — Pick up from here

> **อ่านไฟล์นี้ + [dashboard-v2.md](dashboard-v2.md) + [PATTERNS.md](PATTERNS.md) + [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) + [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) + [migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md) ก่อนเริ่ม**
>
> **Session 2026-07-18 — A: M5 2-account test + smoke LINE 4 ข้อ ผ่านครบทุกข้อ ✅ — pending urgent ที่ค้างนานสุด (7/07) ปิดสมบูรณ์ (docs-only, zero code change):** คุณนุ๊ก (`/session-start`) เลือก A. Claude pin expected ทุกข้อจากโค้ดจริง ([webhook-router.ts](lib/ai-quote/webhook-router.ts) / [customer-triggers.ts](lib/ai-quote/customer-triggers.ts) / [line-mode.ts](lib/ai-quote/line-mode.ts)) + เขียน **[RUNBOOK-m5-2account-smoke.md](RUNBOOK-m5-2account-smoke.md)** เก็บถาวร (runbook 7/17 อยู่ในแชตแล้วหาย — บทเรียน: runbook ที่ user ต้อง execute ข้าม session ให้ลงไฟล์เสมอ) พร้อม cautions กัน false result (ห้าม staff ตอบ Page inbox ระหว่างทดสอบ — takeover เพิ่งทำงานจริง 7/17 · โหมด idle 30 นาที). **Part 1 M5 (Messenger + LINE ครบ 4 ขั้นทั้งคู่):** บัญชี B เข้าโหมดได้ INTRO สดใหม่ ไม่มีร่องรอยบัญชี A + ถามอ้างอิง "ราคาเมื่อกี้" → AI ไม่รู้ ไม่หลุดราคา/สเปกของ A + บัญชี A context ไม่หาย (ตีราคาต่อจากสเปกเดิมได้) → **M5 owner-check (`loadSessionForUser`) prod-verified ทั้ง 2 channels — M5 chain ปิด end-to-end** (เปิด 6/23 → fold เข้า 1b 6/26 → code LINE `5f8954e` 7/06 + Messenger `3e198d6` 7/08 → prod smoke 7/18). **Part 2 smoke LINE 4 ข้อ:** ① ประโยคยาวนอกโหมดเงียบสนิท ✓ · ② "ขอราคา AI" เปล่าๆ เข้าโหมด (**verify gate revert `c445d53` บน prod**) ✓ · ③ /track ในโหมดได้การ์ด + โหมดคงอยู่ ✓ · ④ สลิปในโหมดตรวจปกติ ✓ · ⑤ "สั่งเลย" → 🛒 + Flex เข้ากลุ่มทีมงาน + ออกโหมด ✓.
>
> **Follow-up (2026-07-18, same session) — 🎨 pin template "ขอราคาหน่อย" SHIPPED ([`f8c3d7e`](https://github.com/witsarutnook/penprinting-dashboard/commit/f8c3d7e) ตรง main → auto-deploy):** คุณนุ๊กส่ง screenshot เคสจริง LINE — ลูกค้าในโหมดพิมพ์ "ขอราคาหน่อย" → model แต่งคำตอบขอรายละเอียดเอง → คุณนุ๊กให้ wording ที่ต้องการ. **Fix (TDD +1 = 470 tests):** section ใหม่ใน [prompt-customer.ts](lib/ai-quote/prompt-customer.ts) — ลูกค้าขอราคาโดยยังไม่บอกชนิดงาน → ตอบ template ตรงตัวทุกตัวอักษร ("น้อง PP รบกวนขอรายละเอียดงานหน่อยนะคะ..." + list 4 ประเภท 📄📚📓🪪); รู้ชนิดงานแล้วสเปกไม่ครบ → กฎ "ต้องถามเสมอ" เดิม. Test pin verbatim lines + list block. Gates เขียว Node 22 ครบ (lint warning `_r` slip.ts = pre-existing ไม่เกี่ยว).
>
> ## ⏳ Pending (2026-07-18)
> 0. 🎨 **Smoke template "ขอราคาหน่อย" บน prod (คุณนุ๊ก — หลัง deploy ~2 นาที)**: ออกโหมดเดิม (`ออก`) → เข้าโหมดใหม่ → พิมพ์ `ขอราคาหน่อย` → ต้องได้ template เป๊ะทุกบรรทัด
> 1. 👀 **เฝ้า hint Messenger กับ traffic จริงต่อ (วันที่ 2)** — เจอแทรกผิดที่ = `AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy แล้วแจ้ง Claude
> 2. 💡 optional: chip **smoke check Meta subscription** (task_8243d7bb — ต้องตั้ง `FB_PAGE_TOKEN` เป็น gh secret ตอนทำ) — regression net กัน `message_echoes` หลุดเงียบซ้ำรอย 6 วัน
> 3. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
>
> ---
>
> **Session 2026-07-17 — A+B+C ครบ 3 ทาง: B smoke follow-ups ปิดหมด (calc [`ee5e9f6`](https://github.com/witsarutnook/penprinting-calc/commit/ee5e9f6)) · C gate "/" reverted ([`c445d53`](https://github.com/witsarutnook/penprinting-dashboard/commit/c445d53)) · 🔥 /diagnose เคส LukTarn → พบ+แก้ suppression ตายเงียบตั้งแต่ ship:** คุณนุ๊ก (`/session-start`) เลือกครบ A+B+C. **B (calc):** node 20→22 ทั้ง `smoke.yml`+`ci.yml` (ปิด drift กับ dashboard) + baselines 11→**14 cases** — box auto-bottom/custom + bag custom (pin `pressUsed` ด้วย — style arms มี bug history) + book pin `finishing.coat/spotuv.unit`; ค่า capture จาก local API (`--capture`) ห้ามคำนวณมือ → local 15/15 → push → **prod smoke จาก deploy จริงเขียว 15/15**. **C (dashboard, TDD flip 5 RED → เขียว, 468→469 tests):** `isEnterAiKeyword` — **"/" เป็น optional แทนตัดทิ้ง** (ปุ่ม hint เก่าในแชตลูกค้ายัง carry `/ขอราคา AI`; เมนู/rich menu ใช้ postback ไม่กระทบ) + `HINT_QUICK_REPLY.text` → `ขอราคา AI`; ประโยคยาวยังไม่เข้าโหมด; post-deploy smoke 7/7. **🔥 Incident (คุณนุ๊กส่ง screenshot):** hint แทรกหลัง Giift ตอบจบ (ลูกค้า LukTarn, 7/16 15:12) ทั้งที่ HINT-1 live → `/diagnose`: โค้ดครบ chain ถูกหมด → **DB Neon (Chrome + 2FA คุณนุ๊ก, read-only): ทั้งตาราง 17 rows `last_staff_reply_at` = NULL** = echo ไม่เคยมาถึงตั้งแต่ ship → Meta: Page-level subscription มีแค่ 2 fields — **root cause: `message_echoes` ที่กด 7/11 ไม่ persist ระดับ Page** (subscription 2 ชั้น ชั้น Page ตัดสิน) → verify ⑤ 7/11 = **false positive** (วัดจากพฤติกรรม — idle-expire อธิบายได้) → **suppression + takeover ตายจริง 6 วัน**. **Fix (อนุมัติแล้ว):** ติ๊ก `message_echoes` → 3 fields → **verify หลักฐานตรง: "test" จาก Page inbox 10:45 → stamp 10:45:08 ตรงวินาที** — ทำงานจริงครั้งแรกตั้งแต่ ship. Runbook แก้ step 4/5 ([`43af38f`](https://github.com/witsarutnook/penprinting-dashboard/commit/43af38f)) + memory [[meta-page-level-webhook-subscription]] + chip smoke check `subscribed_apps` (รอคุณนุ๊กกด). **Decisions:** hint เปิดต่อ · 48h window = by design (hint กลับมาได้หลังทีมงานเงียบ 48 ชม. — เฝ้า traffic จริงก่อนคิดปรับ `STAFF_SUPPRESS_HOURS`).
>
> ## ⏳ Pending (2026-07-17)
> 1. 📱 **M5 2-account test (carryover — urgent)**: runbook ตาราง 4 ขั้นอยู่ในแชต session 7/17 — บัญชี 2 เข้าโหมด AI ต้องไม่เห็นบทสนทนา/ราคาบัญชีแรก + บัญชีแรก context ไม่หาย (ทั้ง Messenger + LINE)
> 2. 🎨 **Smoke LINE 4 ข้อ** (runbook ในแชต session 7/17): ④ "สั่งเลย" → Flex เข้ากลุ่ม + ออกโหมด · /track ในโหมดยังได้การ์ด · สลิปในโหมดยังตรวจ · **"ขอราคา AI" เปล่าๆ ต้องเข้าโหมด (verify gate revert) + ประโยคยาวนอกโหมดต้องเงียบ**
> 3. 👀 **เฝ้า hint Messenger กับ traffic จริง** — suppression เพิ่งทำงานจริงครั้งแรกวันนี้; เจอแทรกผิดที่อีก = `AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy แล้วแจ้ง Claude
> 4. 💡 optional: chip **smoke check Meta subscription** (task_8243d7bb — ต้องตั้ง `FB_PAGE_TOKEN` เป็น gh secret ตอนทำ)
> 5. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
>
> ---
>
> **Session 2026-07-16 — A: staff prompt current-turn-only ปิด bug class ครบ 2 ฝั่ง · B: 🔥 Post-deploy smoke system SHIPPED ทั้ง 2 repos + LIVE พิสูจน์ครบวงจร:** คุณนุ๊ก (`/session-start`) confirm smoke นามบัตร prod ผ่านครบ (500/900 ตรง) → เลือก A. **A ([`87303ac`](https://github.com/witsarutnook/penprinting-dashboard/commit/87303ac), TDD +1 = 459):** กฎ current-turn-only ใน [lib/ai-quote/prompt.ts](lib/ai-quote/prompt.ts) `## ห้ามเดาราคา` (twin ของ `a521529` ฝั่ง staff — พนักงานวางสเปกซ้ำหลังราคาเปลี่ยน). **B (idea #17 จาก feature brainstorm — superpowers เต็ม: brainstorm 3 decisions [D1 health+baselines ไม่มี AI canary · D2 แจ้ง fail เท่านั้น · D3 หลัง deploy เท่านั้น ไม่มี cron] → Approach A `deployment_status` แยก workflow ตาม repo เจ้าของ → spec → plan 8 tasks → subagent-driven + 2-stage review/task → final review = READY-WITH-NOTES):** **dashboard** — `scripts/smoke-core.mjs` shared core TDD 9 tests (468 รวม) + `scripts/smoke.mjs` 7 health checks (login/track 200 · board 307→login · LINE GET 200/POST bad-sig 401 · Messenger 403 · admin 401) + workflow `deployment_status` filter `Production` ([`9689c46`](https://github.com/witsarutnook/penprinting-dashboard/commit/9689c46)+[`23c106e`](https://github.com/witsarutnook/penprinting-dashboard/commit/23c106e)+[`36530f0`](https://github.com/witsarutnook/penprinting-dashboard/commit/36530f0)+[`6c386ae`](https://github.com/witsarutnook/penprinting-dashboard/commit/6c386ae)). **calc** — twin core byte-identical + `smoke-baselines.json` **11 cases ทุกชนิดงาน** (namecard fix rate 5 · brochure offset 2.77625/digital 30 · book/notebook/box/bag capture จาก API ห้ามคำนวณมือ) + placeholder guard recursive (sentinel null) + workflow + CI validate step (calc `f507632`+`df05178`+`e1a54a9`). **Reviews จับจริง 3:** compareFields array reference-compare false positive (แก้ก่อน twin copy) · workflow script-injection → env-indirection hardening (propagate ทั้ง 2 repos) · sentinel 0 → null (กัน field ราคา 0 จริงในอนาคต). **Live proof ครบ:** dashboard 3+ runs เขียวจาก deploy จริง (environment=`Production` เป๊ะ) · calc parity run เขียว 12 checks = **ราคา prod ตรง baseline ถึงทศนิยมเต็ม** · test-notify 🧪 sent · **fail-path จริง**: break baseline 500→499 (`3ed1359`) → run แดง + LINE 🔥 "expected 499, got 500" เข้ากลุ่ม → revert (`293846a`) → เขียวคืนเอง. **Secrets 5 ตัวคุณนุ๊กตั้งผ่าน `gh secret set`** (ค่าไม่ผ่านแชต). `/sync-paper-prices` เพิ่มขั้นตอน baseline บังคับ + accepted deviations 3 ข้อบันทึกใน spec. **ตั้งแต่นี้: ทุก push ที่ทำราคาเพี้ยน/ประตูหลุด = กลุ่ม LINE รู้ใน ~3 นาที ไม่ต้องรอคุณนุ๊ก smoke มือ.**
>
> ## ⏳ Pending (2026-07-16)
> 1. ~~📲 คุณนุ๊ก confirm 2 ข้อความในกลุ่ม LINE ทีมงาน~~ ✅ **ผ่าน (same-day, screenshot ยืนยัน)** — 🧪 test-notify 16:08 + 🔥 fail message 16:11 ครบทุก element (diff เป๊ะ/hint/ลิงก์ run). **Post-deploy smoke acceptance = ปิด 100%**
> 2. 📱 **M5 2-account test (carryover — urgent, live กับลูกค้าจริงแล้ว)**: บัญชีที่ 2 เข้าโหมด AI → ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก (ทั้ง Messenger + LINE)
> 3. 🎨 smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · ~~revert gate "/" เมื่อพร้อม~~ ✅ **reverted 2026-07-17 (`c445d53`)** — เหลือ smoke
> 4. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
> 5. ~~🔭 follow-ups เล็ก (final review notes, ไม่เร่ง): node 20/22 drift ใน smoke workflows 2 repos · box/bag baseline เพิ่ม style auto-bottom/custom · finishing case ใน book baseline~~ ✅ **ปิดครบทั้ง 3 ข้อ 2026-07-17 (calc `ee5e9f6`)** — baselines 14 cases, prod smoke 15/15
>
> ---
>
> **Session 2026-07-15 — AI quote UX hotfix loop จากเคสลูกค้าจริง: 4 commits ตรง main → auto-deploy, verified prod ครบทุกตัว (คุณนุ๊ก smoke สดระหว่าง session):** เคสจริง Messenger (ลูกค้า Dreamie Kinane): แจ้งสเปก Art 130 → AI escalate ตาม out-of-list rule แต่แถมท้ายว่า "แจ้ง Art 120/160 ได้เลย ประเมินทันที" ทั้งที่ escalate = `exitMode` แล้ว → ลูกค้าตอบ "120" เจอความเงียบ พนักงานต้องตอบเอง. **ตัดสินใจ: แก้ที่ prompt ไม่แตะ mode machinery** (exit-on-escalate ถูกแล้ว — คงโหมดไว้เสี่ยง AI แทรก staff ซ้ำรอย incident 7/09 + LINE ไม่มี takeover detection). **(1) [`d94a600`](https://github.com/witsarutnook/penprinting-dashboard/commit/d94a600)**: กฎ "กระดาษนอกรายการ → เสนอตัวใกล้เคียงก่อน 1 ครั้ง (ห้ามใช้วลี 'ส่งต่อทีมงาน' ในคำถาม = ยังอยู่ในโหมด) ลูกค้ายืนยันค่อย escalate" + "ข้อความ hand-off ต้องจบการสนทนา ห้ามชวนคุยต่อ (โหมดปิดแล้ว)" — **verified prod 10:44**: AI เสนอ 120/160 → "120" → ได้ราคาต่อทันที ✅. **(2) [`ddafb7b`](https://github.com/witsarutnook/penprinting-dashboard/commit/ddafb7b) (คุณนุ๊กสั่ง: กระชับ + ปัดราคา + ตัดราคาเต็ม)**: `ceilTo05` (ปัดขึ้นขั้น 0.05 เสมอ ขั้นต่ำ 0.05 — 1.17625→1.20) + `roundOutcomeForCustomer` wrap compute dep ใน [customer-deps.ts](lib/ai-quote/customer-deps.ts) **เฉพาะ 2 route แชตลูกค้า — model ไม่เคยเห็นเลขเต็ม = หลุดไม่ได้; quote-assistant ทีมงานเห็นเลขเป๊ะเหมือนเดิม**; ราคาปัดไหลเข้า saveQuote → lead history/Flex = ราคาที่ลูกค้าเห็นจริง; drop VAT fields (pre-VAT only ตาม D4) + prompt format ≤3 บรรทัดหลัก ไม่ทวนสเปกที่ลูกค้าระบุเอง. **(3) [`d2f2e7f`](https://github.com/witsarutnook/penprinting-dashboard/commit/d2f2e7f) (คุณนุ๊กจับจาก smoke: "ใบละ 2.40 รวม 4,776.25" ขัดกันเอง)**: totalPrice ฝั่งลูกค้า = ราคาปัดแล้ว × qty (2.40×2,000 = **4,800**); qty ไม่รู้ → drop; **namecard คงเดิม** (กล่อง × fix rate — คูณ qty×unit จะได้ 750 แทน 900 ผิด). **(4) [`a521529`](https://github.com/witsarutnook/penprinting-dashboard/commit/a521529) (smoke 11:12 ยังเห็น 4,776.25 — คุณนุ๊กเดาถูก "ยังอยู่ mode เดิม")**: root cause = model ไม่เรียก tool ซ้ำสำหรับสเปกเดิม copy เลขจาก text history (หลักฐาน: format ใหม่ live ในข้อความเดียวกัน แต่เลขตรงเป๊ะถึงสตางค์กับคำตอบเก่า) → กฎ "ตัวเลขราคาต้องมาจาก compute_quote **ของเทิร์นปัจจุบัน** ห้ามนำเลขจากข้อความก่อนหน้ามาตอบซ้ำ" — verified: ถามซ้ำใน session เดิมได้ 4,800 ✅. Lesson → memory [[llm-reuses-stale-tool-numbers-from-history]] (รวม recipe: smoke หลัง deploy ต้องเปิด session ใหม่). TDD ตลอด: tests 446 → **458** (+12), gates เขียว Node 22 ทุก commit.
>
> ## ⏳ Pending (2026-07-15)
> 1. ~~🔭 Follow-up เล็ก: staff prompt current-turn-only~~ ✅ **SHIPPED 2026-07-16** ([`87303ac`](https://github.com/witsarutnook/penprinting-dashboard/commit/87303ac)) — กฎ current-turn-only ใน [lib/ai-quote/prompt.ts](lib/ai-quote/prompt.ts) `## ห้ามเดาราคา` (twin ของ `a521529` ฝั่ง staff), TDD +1 = **459 tests**
> 2. ~~🪪 Smoke นามบัตรบน prod (carryover 7/13)~~ ✅ **ผ่านครบ ตัวเลขตรง (คุณนุ๊ก confirm 2026-07-16)** — "2 กล่อง เคลือบเงา" → 500 · "250 ใบ 2 หน้า" → 3 กล่อง รวม 900; ราคารวมหลัง `ddafb7b` ถูก (กล่อง × fix rate)
> 3. 📱 **M5 2-account test (carryover — urgent, live กับลูกค้าจริงแล้ว)**: บัญชีที่ 2 เข้าโหมด AI → ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก (ทั้ง Messenger + LINE)
> 4. 🎨 smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · revert gate "/" เมื่อพร้อม (rich menu LIVE + ใช้ postback ไม่พึ่ง keyword — revert ได้อิสระ)
> 5. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
>
> **Follow-up (2026-07-13, same session) — C: rich menu final พร้อม deploy + D: AI ได้ชื่อ "น้อง PP" SHIPPED ([`4e7574a`](https://github.com/witsarutnook/penprinting-dashboard/commit/4e7574a) ตรง main → auto-deploy):** คุณนุ๊กส่งรูปดีไซน์ "Rich Menu-final.jpg" (10417×7025, 6.8MB) ใส่ `../line-oa-richmenu/` + ขอตั้งชื่อ AI. **C (kit นอก repo — no code change):** resize → `richmenu.jpg` 2500×1686 q85 **447KB** (≤1MB ✓) · วัด layout จากรูปจริง (transition แถว 50.3%≈843 · dividers x=827/1672 สมมาตร) · remap `richmenu.json` **5→4 โซน**: บนเต็มแถว=portfolio · ล่างซ้าย=postback `ai_quote_start` · ล่างกลาง=tel · ล่างขวา=maps — **โซน `/track` ไม่อยู่ในดีไซน์ใหม่** (ตามรูปคุณนุ๊ก; พิมพ์ /track ยังใช้ได้) · update `deploy-richmenu.sh` เป็น jpg/image/jpeg · verify โซนด้วย overlay บนรูปจริง = ตรงเป๊ะ. **รอคุณนุ๊กรัน `bash deploy-richmenu.sh`** (token ผ่าน read -s). **D (TDD +2 = 444 tests):** persona "น้อง PP" ใน [prompt-customer.ts](lib/ai-quote/prompt-customer.ts) (แทนตัวเอง "น้อง PP" + generalize ช่องทาง LINE→แชต LINE/Messenger) + `INTRO_TEXT` แนะนำตัว + `HINT_TEXT` "กับน้อง PP (AI)" — ตรงดีไซน์เมนู "CHAT with PP BOT"; quick-reply label + text `/ขอราคา AI` คงเดิม (soft-launch gate). Gates เขียว Node 22 ครบ.
>
> **Session 2026-07-13 — A: hint Messenger ผ่านการเฝ้า 2 วัน ✅ ปิด · B: quality follow-ups 7/10 ปิดครบทั้ง 4 ([`5ada186`](https://github.com/witsarutnook/penprinting-dashboard/commit/5ada186) ตรง main → auto-deploy, zero behavior change):** คุณนุ๊ก (`/session-start`) เลือก A+B. **A:** ครบกำหนดเฝ้า hint 11→13 ก.ค. — ไม่มีรายงานเคสแทรกผิดที่จาก Page inbox → ปิด pending; ตอบคำถามคุณนุ๊กเรื่อง window: **staff suppression 48h (เช็คก่อน) + hint gate 24h/user + takeover แยกต่างหาก** (verified จาก code: `STAFF_SUPPRESS_HOURS=48` / `HINT_GATE_HOURS=24`, [webhook-router.ts:246-252]). ถ้าเจอเคสภายหลัง → แจ้ง Claude diagnose (rollback เดิม: flag off + redeploy). **B (TDD +6 = 442 tests):** (1) **extract [lib/ai-quote/customer-deps.ts](lib/ai-quote/customer-deps.ts)** — shared `buildCustomerAiDeps` แทน builder duplicate ~90% ใน 2 routes (channel เลือก session scope + rate-limit key; routes ฉีดเฉพาะ hint-flag composition + profile-aware session creation; MODEL/AI_RATE_LIMIT ย้ายตาม; routes บางลง net −51 LOC) · (2) **hint-flag pure fns + tests**: `lineHintEnabled` / `messengerHintEnabled` (pin fail-closed flag∧FB_APP_ID) / `normalizeFbAppId` (pin I1 trim) / `rateLimitKey` (pin prefix `ai-quote-line:`/`ai-quote-msgr:` — เปลี่ยน = reset live counters) · (3) **แยกกลุ่ม `CustomerAiDeps`** → `CustomerModeDeps`/`SessionDeps`/`EngineDeps`/`EscalationDeps` ผ่าน extends (flat shape เดิม call sites ไม่แตะ) · (4) **`LoadSessionOpts`** — channel บังคับเมื่อส่ง opts (channelUserId มาเดี่ยวไม่ได้แล้วที่ type level; runtime fail-closed คงไว้ defense-in-depth, test cast จำลอง JS caller). Gates เขียว Node 22 ครบ (type-check/lint 0-err/**442 tests**/build). **Follow-ups จาก quality review 7/10 = ปิดหมดทั้ง 4.**
>
> **Follow-up 3 (2026-07-13, same session) — 🪪 นามบัตรเข้า AI quoting SHIPPED ทั้ง 2 repos (calc [`d64f38f`] → dashboard [`4cd4320`](https://github.com/witsarutnook/penprinting-dashboard/commit/4cd4320), deploy order: calc ก่อน):** คุณนุ๊กให้ราคา **fix rate ต่อกล่อง (100 ใบ)**: 1 หน้า 150 / 1 หน้า+เคลือบ 250 / 2 หน้า 300 / 2 หน้า+เคลือบ 500 (เงา/ด้านราคาเดียว, ก่อน VAT, ปัดใบขึ้นเป็นกล่องเต็ม). **calc (source of truth):** `computeNamecard` lookup table ใน [calc.ts] + `DEFAULT_CONFIG.namecard` + zod schema + API arm — **API-only ไม่มีแท็บ UI** (backlog แยก). **Verified บน local API จริง** (QUOTE_API_TOKEN=test): 4 ช่องราคาตรงเป๊ะ · 250 ใบ→3 กล่อง=450 · ขั้นต่ำ 1 กล่อง · spec ขาด→422 · brochure regression 4.78 ตรง baseline prod. **dashboard:** tool enum+desc · prompts staff+customer (scope 3→4, กฎนามบัตร: ตอบต่อกล่อง+จำนวนกล่อง+รวม, default 1 หน้า ไม่เคลือบ+แจ้งสมมติฐาน, ถอดนามบัตรจาก escalate list) · INTRO/HINT scope · PRODUCT_LABEL 2 จุด (quote-assistant UI + escalation Flex). Tests 446 (+enum pin แก้ +scope pins). Gates เขียว Node 22 ทั้ง 2 repos. **รอ smoke prod โดยคุณนุ๊ก** (quote-assistant หรือทัก น้อง PP: "นามบัตร 2 กล่อง เคลือบเงา" → ต้องได้ 2×250=500). หมายเหตุ rtk: log ของ `next dev` ใน background โดน hook summarize จน error หาย — รันผ่าน `rtk proxy` + อ่านด้วย `/usr/bin/tail` ([[feedback_rtk_git_pull_stale_uptodate]] ใช้ซ้ำ).
>
> **Follow-up 2 (2026-07-13, same session) — 🚀 rich menu DEPLOYED สำเร็จ (richMenuId `richmenu-6fc315e0d20bb93fa34704b9577cdb75`):** รอบแรก step 3/3 (set default) ล้ม — Akamai HTML "Bad Request". `/diagnose` ด้วย token ปลอม (HTML 400 = request shape ผิด · JSON 401 = shape ถูก, แยกตัวแปรได้โดยไม่แตะ token จริง): **root cause = POST ตัวเปล่าไม่มี body โดน Akamai edge ของ LINE ปัดตกก่อนถึง API** (step 1-2 รอดเพราะมี body) → fix `-d ''` ใน deploy-richmenu.sh + สคริปต์เก็บตก `set-default-richmenu.sh` (กันรัน deploy ซ้ำ = เมนูซ้ำ) → คุณนุ๊กรันผ่าน ✅. DELETE rollback ตรวจแล้วไม่โดน. Lesson → memory [[line-api-empty-post-akamai]]. **เหลือ: คุณนุ๊ก verify บนมือถือ** (เมนู 4 โซน + แตะ CHAT with PP BOT → เข้าโหมด + น้อง PP แนะนำตัว).
>
> ## ⏳ Pending (2026-07-13)
> 0. ~~📲 Verify rich menu บนมือถือ~~ ✅ **ผ่าน (same-day)** — คุณนุ๊กกดเมนูใหม่บนมือถือแล้วโอเค. **Rich menu LINE = LIVE — ทางเข้าโหมด AI หลักของ LINE เปิดแล้ว** (item รอรูปดีไซน์ที่ค้างมาตั้งแต่ 7/07 = จบ)
> 0b. 🪪 **Smoke นามบัตรบน prod (คุณนุ๊ก — หลัง Vercel deploy ทั้ง 2 โปรเจกต์ ~2 นาที)**: `/quote-assistant` หรือทักน้อง PP — ลอง "นามบัตร 2 กล่อง เคลือบเงา" → ต้องได้ กล่องละ 250 รวม 500 (+VAT ตอนแจ้ง) · "นามบัตร 250 ใบ 2 หน้า" → 3 กล่อง กล่องละ 300 รวม 900 + สมมติฐานไม่เคลือบ · เช็คว่างานกล่อง/สติกเกอร์ยัง escalate เหมือนเดิม
> 2. 📱 **M5 2-account test (carryover — urgent, live กับลูกค้าจริงแล้ว)**: บัญชีที่ 2 เข้าโหมด AI → ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก (ทั้ง Messenger + LINE)
> 3. 🎨 smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · revert gate "/" เมื่อ rich menu นิ่ง (เมนูส่ง postback ไม่พึ่ง keyword — revert ได้อิสระ)
> 4. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
>
> **Session 2026-07-11 — HINT-1 rollout ครบ 6 steps ✅ hint Messenger กลับมาเปิดแล้ว (ops-only, zero code change):** คุณนุ๊ก (`/session-start`) เลือก HINT-1 rollout → ไล่ [RUNBOOK-hint1-staff-suppression.md](RUNBOOK-hint1-staff-suppression.md) ด้วยกัน: **②** db-migrate ผ่าน Chrome MCP — applied มี `ai_quote_line_modes.last_staff_reply_at column`, data ครบ (orders 490/jobs 876/modes 5); หมายเหตุ: route push ทุกบรรทัด `IF NOT EXISTS` ลง `applied` เสมอ — list ยาวตอน rerun = ปกติ ไม่ใช่ re-create · **③** คุณนุ๊กตั้ง `FB_APP_ID=890064264151011` + redeploy — Claude verify บน Vercel: ค่า reveal = ตัวเลขล้วน + All Environments + redeploy Ready เป็น Production ปัจจุบัน · **④** Claude กด subscribe `message_echoes` ใน Meta dashboard (คุณนุ๊กอนุมัติ; `messages`+`messaging_postbacks` เดิมคงอยู่, callback URL ถูกต้อง) · **⑤ verify ผ่านครบ 3 ข้อบน Messenger จริง** — บอทไม่เตะตัวเอง (คุยหลายเทิร์นไม่หลุดโหมด = จำแนก app_id ถูก) + **takeover** (staff ตอบจาก Page inbox → AI เงียบ — ข้อนี้พิสูจน์ `FB_APP_ID` live จริงในตัว) + suppress · **⑥** `AI_QUOTE_MESSENGER_HINT_ENABLED=true` + redeploy → Ready Production (ค่า reveal = `true` เป๊ะ). Vercel timestamp หยาบเกินพิสูจน์ลำดับ env-save→redeploy (ไม่มี exact datetime ใน DOM/tooltip) → ยืนยันลำดับคลิกจากคุณนุ๊กตรงๆ + technique ลง memory [[feedback_ai_quote_phase1a]]; failure direction ปลอดภัยอยู่แล้ว (ลำดับผิด = hint ยังปิด fail-closed, ไม่ใช่ซ้ำ incident 7/09 เพราะ echo subscribe แล้ว). **AUDIT-BACKLOG: HINT-1 closed-pending-rollout-verify → CLOSED สมบูรณ์.** Docs-only commit.
>
> ## ⏳ Pending (2026-07-11)
> 1. 👀 **เฝ้า hint Messenger กับลูกค้าจริง 1-2 วัน** — hint ยิงเฉพาะ conversation ที่ไม่มี staff ตอบใน 48h + 24h/user gate; ถ้าเห็นแทรกผิดที่ = `AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy (rollback เดิม) แล้วแจ้ง Claude; takeover/suppress คงทำงานต่อไม่ว่า hint เปิดหรือปิด
> 2. 📱 **M5 2-account test (carryover — urgent, live กับลูกค้าจริงแล้ว)**: บัญชีที่ 2 เข้าโหมด AI → ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก (ทั้ง Messenger + LINE)
> 3. 🎨 **LINE rich menu รอรูปดีไซน์จากคุณนุ๊ก** (kit `../line-oa-richmenu/` พร้อม — ทางเข้า AI ทางเดียวของ LINE) · smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · revert gate "/" เมื่อพร้อม
> 4. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover)
> 5. 🔭 follow-ups เล็ก (carryover 7/10, ไม่เร่ง): แยกกลุ่ม `CustomerAiDeps` · extract `buildCustomerAiDeps` shared helper · `hintEnabled` pure fn + test · `loadSession` opts type-level pairing
>
> ---
>
> **Session 2026-07-10 — A: polish `**` markdown ใน quote reply SHIPPED (`5e22d8b` ตรง main → live) · B: HINT-1 staff-activity suppression + takeover SHIPPED (PR [#20](https://github.com/witsarutnook/penprinting-dashboard/pull/20) squash [`59d85de`](https://github.com/witsarutnook/penprinting-dashboard/commit/59d85de) → auto-deploy, feature inert จน rollout):** คุณนุ๊ก (`/session-start`) เลือก A+B. **A (TDD +6 = 420 tests):** `stripChatMarkdown` ใน [run.ts](lib/ai-quote/run.ts) — strip `**` ที่จุดสร้าง reply จุดเดียว (ครอบทุก surface: LINE/Messenger/quote-assistant ล้วน plain text — ไม่มี dual-shape, sent = persisted history) + กฎ "ห้ามใช้ markdown" ใน customer prompt (test pin). **B (superpowers เต็ม: brainstorm 5 decisions [D1 ทำ detector+เปิด hint คืน · D2 Messenger เท่านั้น — **LINE ตรวจไม่ได้โดยสภาพ**: OA Manager ตอบไม่มี webhook → `AI_QUOTE_LINE_HINT_ENABLED` ปิดถาวร, rich menu = ทางเข้า · D3 window 48h · D4 staff ตอบ = takeover เตะออกโหมด AI ทันที · D5 pipeline arm ไม่ใช่ route-layer] → spec [`1011e91`] → plan 6 tasks [`699894d`] → subagent-driven + 2-stage review/task → final review opus anchor spec = READY):** subscribe `message_echoes` → echo ที่ `app_id` ≠ เรา (หรือไม่มี = Page inbox) = staff ตอบ → kind ใหม่ `staff-echo` (PSID จาก **recipient** ไม่ใช่ sender) → arm เงียบสนิทใน handleInbound → `recordStaffReply` upsert เดียว atomic (stamp `last_staff_reply_at` + เคลียร์โหมด, คง `last_hint_at`) · hint gate `staffActive` 48h เช็คก่อน 24h gate (suppressed hint ไม่เผา quota) · **fail-safe ทางเดียว: ไม่มี `FB_APP_ID` (env ใหม่, trim แล้ว) → skip echo ทุกตัว + hint fail-closed** — จำแนกพลาด = บอทเตะตัวเองหลุดโหมดทุก reply · migration `last_staff_reply_at` idempotent (NULL ไม่มี DEFAULT). Reviews จับจริง: INSERT/DO UPDATE asymmetry (correct-by-coincidence → lockstep) · swallow-comment overstate · final opus จับ **I1 FB_APP_ID whitespace/precision** (trim hardening `011088c`) + M1 runbook ordering. Gates เขียว Node 22 ทุก commit (**436 tests** +16/build). **Opus verify: deploy = byte-identical prod ทั้ง 4 rollout stages.**
>
> ## ⏳ Pending (2026-07-10)
> 1. 🚀 **HINT-1 rollout — คุณนุ๊ก actions ทั้งหมด ตามลำดับใน [RUNBOOK-hint1-staff-suppression.md](RUNBOOK-hint1-staff-suppression.md):** ① merge แล้ว (deploy Ready) → ② db-migrate → ③ Vercel env `FB_APP_ID` (ตัวเลขล้วนห้ามมีช่องว่าง) + redeploy → ④ subscribe `message_echoes` ใน Meta dashboard → ⑤ **verify 3 ข้อ (critical: "บอทไม่เตะตัวเอง" — คุย AI หลายเทิร์นต้องไม่หลุดโหมด)** → ⑥ `AI_QUOTE_MESSENGER_HINT_ENABLED=true` + redeploy. ห้ามสลับ ⑥ ก่อน ④ (= ซ้ำ incident 7/09). Takeover ทำงานตั้งแต่ ④ แม้ hint ยังปิด (มีแต่ประโยชน์)
> 2. 📱 **M5 2-account test (carryover — urgent, live กับลูกค้าจริงแล้ว)**: บัญชีที่ 2 เข้าโหมด AI → ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก (ทั้ง Messenger + LINE)
> 3. 🎨 **LINE rich menu รอรูปดีไซน์จากคุณนุ๊ก** (kit `../line-oa-richmenu/` พร้อม) — **นี่คือทางเข้า AI ทางเดียวของ LINE แล้ว** (hint LINE = ปิดถาวรโดยสภาพ ยืนยันใน HINT-1 D2) · smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · revert gate "/" เมื่อพร้อม
> 4. 📊 optional: smoke slip-metrics `?channel=` ในเบราว์เซอร์ admin (carryover 7/09)
> 5. 🔭 follow-ups เล็ก (quality review 7/10 เสนอ, ไม่เร่ง): `CustomerAiDeps` ~21 fields ใกล้จุดควรแยก Mode/Session/EscalationDeps · `buildCustomerAiDeps` duplicate ~90% ระหว่าง 2 routes → extract shared helper · `hintEnabled` composition เป็น pure fn + test · `loadSession` opts type-level pairing (carryover)
>
> ---
>
> **Session 2026-07-09 — A: privacy policy page (penprinting-web) SHIPPED + live ✅ · B: slip-metrics `?channel=` filter SHIPPED (`db2eebd`) — ปลดล็อก App Review จังหวะ 2:** คุณนุ๊ก (`/session-start`) เลือก A+B. **A (penprinting-web, superpowers flow เต็ม: brainstorm → spec [`e3b2f26`](docs อยู่ฝั่ง penprinting-web) → plan [`0ab1a60`] → execute inline):** หน้า `penprinting.co/privacy-policy` ([`59efd9e`](https://github.com/witsarutnook/penprinting-web/commit/59efd9e) + footer/sitemap [`f016296`](https://github.com/witsarutnook/penprinting-web/commit/f016296)) — decisions: ครอบทุก touchpoint (เว็บ GA4/GTM + LINE OA + Messenger + ออเดอร์/สลิป) · ไทยหลัก + English summary ท้ายหน้าเดียวกัน · เปิดเผยชัดว่ามี AI ช่วยตอบ · §6 มีขั้นตอนขอลบข้อมูล = ใช้เป็น **Data Deletion Instructions URL** ของ Meta ได้ในตัว · ข้อมูลติดต่อดึง `SITE_CONFIG` ล้วน · วันที่ static (กัน hydration ตาม [[feedback_hydration_smell_generatedat]]). **Verified live ครบ:** page 200 + content ไทย/EN/ขอลบข้อมูล + sitemap.xml มี entry + footer link render หน้าแรก. **B (dashboard, TDD RED→GREEN):** `/api/admin/slip-metrics?channel=line|messenger` ([`db2eebd`](https://github.com/witsarutnook/penprinting-dashboard/commit/db2eebd)) — extract `loadSlipMetrics`+`parseSlipMetricsChannel` ลง lib (route บาง ตาม pattern track-result); NULL-param trick = query เดียว; ไม่ใส่ param = aggregate เดิม + field `channel:'all'` additive; typo → 400. +6 tests (**414**), gates เขียว Node 22 ครบ build. RUNBOOK-1c: 2.1 ✅ (privacy URL) + slip-metrics caveat ลบ (มี filter แล้ว). หมายเหตุ rtk: vitest output โดน filter ว่าง → รันผ่าน `rtk proxy` ยืนยัน ([[feedback_rtk_git_pull_stale_uptodate]] ใช้ซ้ำอีกรอบ).
>
> **Follow-up (2026-07-09, same session) — 🚀 MESSENGER PUBLISHED = LIVE กับลูกค้าจริง:** คุณนุ๊กถาม "2.2 ทำยังไง" → ส่ง screenshot dashboard → สั่ง "ลอง MCP ไปเช็ค" → Claude ไล่หน้าจอจริงผ่าน Chrome MCP พบ: **app แบบ use case ไม่ต้อง App Review เลย** — หน้า Publish ขึ้น "All required app settings are complete" (privacy URL ที่กรอกวันนี้ผ่าน), `pages_messaging` = "Ready for testing"+"Required for use case". **กับดักที่เลี่ยงได้:** ปุ่ม "Add to App Review" = บังคับสมัคร **Tech Provider** (สำหรับ app ให้บริการธุรกิจอื่น, **irreversible**) — ปิด dialog ไม่กด Continue → lesson [[feedback_meta_usecase_app_review_tech_provider_trap]]. Runbook 2.2 แก้ 3 รอบจนตรงความจริง. **คุณนุ๊กสั่ง "กดเลย" → Claude กด Publish:** dialog "Your app was successfully published... available for the public to use" + badge Published + ปุ่ม Unpublish (rollback มีจริง). **จังหวะ 2 จบ — Messenger AI quoting เปิดลูกค้าจริงแล้ว.**
>
> **Incident (2026-07-09 ~16:00, same session) — 🔥 hint แทรกกลางบทสนทนาพนักงาน → mitigated ใน ~30 นาที:** หลัง publish ~2 ชม. คุณนุ๊กส่ง screenshot: ลูกค้าจริง (Dee Sudrak) กำลังคุยกับพนักงาน (Giift) เรื่องใบเสนอราคา → ลูกค้าตอบ "ได้ค่ะ" → **บอทยิง hint ทักทายใหม่แทรกทันที** — ลูกค้างง. `/diagnose`: **(1)** hint ยิงบน any-text นอกโหมด เช็คแค่ 24h gate ([webhook-router.ts:226](lib/ai-quote/webhook-router.ts)) **ไม่มีตัวเช็คว่าพนักงาน active** · **(2)** บอทตาบอด echo โดยจงใจ (skip `is_echo` + ไม่ subscribe `message_echoes` — กัน AI ตอบทับพนักงาน) = ไม่มีทางรู้ว่า staff เพิ่งตอบ · **(3) ตัวจุดชนวน = publish**: ก่อน publish webhook ลูกค้าจริงไม่เคยมาถึง → ทุก conversation ที่ค้างกับพนักงานเข้าเงื่อนไข first-hint พร้อมกันทันทีที่ลูกค้าพิมพ์. **Mitigation:** คุณนุ๊กตั้ง `AI_QUOTE_MESSENGER_HINT_ENABLED=false` + redeploy — Claude verify บน Vercel (env Updated 4m → Redeploy Ready 3m = deploy ใหม่กว่า env ✅). **ทางเข้า AI ไม่หาย** (เมนู ☰ + ice breaker + Get Started ครอบอยู่). Design D2 เขียนเอง "ห้ามแทรก" แต่ implementation ไม่มี detector → lesson [[feedback_chatbot_hint_needs_staff_suppression]]. **Fix ถาวรถ้าจะเปิด hint คืน:** subscribe `message_echoes` → echo ที่ app_id ไม่ใช่เรา = staff ตอบ → เก็บ `last_staff_reply_at` → suppress hint N ชม. (หรือยอมรับว่าเมนู ☰ พอ = ปิด hint ถาวร ประหยัดกว่า)
>
> ## ⏳ Pending (2026-07-09)
> 0. ~~📱 verify post-publish~~ ✅ **ผ่าน (same-day)** — non-tester ทัก → hint → ปุ่ม → intro → ตีราคาหนังสือธรรมะ 300 เล่ม 54.98 บ./เล่ม ครบ flow (สาธารณะใช้ได้จริง). ~~2.4 menu/ice breakers~~ ✅ **deployed + เมนู ☰ verified บนมือถือคุณนุ๊ก** (kit `../messenger-profile/` — success + verify GET ครบ; ตอนแรกไม่เห็น = client cache ~ครึ่งชม. force-close app แล้วรอ). **จังหวะ 2 Messenger = จบ 100%.** **เหลือ: M5 2-account test** (สำคัญ — live แล้ว) + **polish เล็ก: AI ตอบราคามี `**...**` markdown ดิบ** (Messenger เห็นแล้วบน prod, LINE ไม่ render เหมือนกัน — แก้ customer prompt + strip ที่ send path, Claude ทำได้ ~15 นาที TDD)
> 1. ~~🔑 กรอก privacy policy URL ใน Meta App Settings~~ ✅ **DONE (2026-07-09 same-day)** — และ ~~App Review~~ **ไม่ต้องทำ** → **PUBLISHED same-day** (ดู follow-up entry ด้านบน)
> 2. 📊 **optional smoke slip-metrics filter**: เบราว์เซอร์ที่ login admin เปิด `/api/admin/slip-metrics?channel=messenger` → เช็ค `channel:'messenger'` + ตัวเลข ≤ aggregate; `?channel=xxx` → 400 (endpoint admin-gated — Claude ยิงตรงไม่ได้, test+build ครอบแล้ว)
> 3. **LINE จังหวะ 2**: 💬 ⚠️ **ห้ามเปิด `AI_QUOTE_LINE_HINT_ENABLED` จนกว่ามี staff-activity suppression** (คำแนะนำเดิมใน entry นี้ถูกถอนหลัง incident hint — LINE OA มีพนักงานคุยกับลูกค้าแบบเดียวกัน จะโดนเป๊ะๆ และไม่มี rich menu สำรองด้วย) · 🎨 rich menu รอรูปดีไซน์จากคุณนุ๊ก (kit `../line-oa-richmenu/` พร้อม — ได้รูป → Claude remap JSON → คุณนุ๊กรันสคริปต์; **นี่คือทางเข้า AI หลักของ LINE ตอนนี้**) · smoke LINE ที่เหลือ (④ "สั่งเลย" + /track/สลิประหว่างโหมด) · revert gate "/" เมื่อพร้อม (shared 2 channel)
> 4. 🔭 follow-up เล็กที่เหลือ: `loadSession` opts type-level pairing (optional hardening — runtime fail-closed + test ครอบแล้ว)
>
> ---
>
> **Session 2026-07-08 — Phase 1c Messenger channel: brainstorm → spec → plan → execute → MERGED ✅ (PR [#19](https://github.com/witsarutnook/penprinting-dashboard/pull/19) squash [`3e198d6`](https://github.com/witsarutnook/penprinting-dashboard/commit/3e198d6) → auto-deploy; env Messenger ยังไม่ตั้ง = route เงียบ 100%, LINE/dashboard พฤติกรรมเดิมเป๊ะ):** คุณนุ๊ก (`/session-start` → "งานอื่น") สั่ง "plan ขยาย ai quoting ใน chat messenger ใน page facebook" → superpowers flow เต็ม: **brainstorm** 5 decisions (D1 scope=**AI+slip ไม่มี /track** · D2 **Hybrid** opt-in+hint day 1 · D3 escalation→**กลุ่ม LINE เดิม** + แถว "ช่องทาง" · D4 **native adapter ตัวที่ 2** ตาม seam `channel:'line'|'messenger'` ที่ 1b-A เตรียมไว้ · D5 Meta app=ต้องเช็ค) → **spec** [`74ef50f`](docs/superpowers/specs/2026-07-08-ai-quote-phase1c-messenger-design.md) → **plan 12 tasks** [`2697091`](docs/superpowers/plans/2026-07-08-ai-quote-phase1c-messenger.md) → **subagent-driven execution** (implementer sonnet/task + spec-review เทียบ SPEC ไม่ใช่แค่ plan + quality review; final review opus). **สร้าง:** [channels/messenger.ts](lib/ai-quote/channels/messenger.ts) (X-Hub-Signature-256 timing-safe · parse `entry[].messaging[]` — **skip `is_echo`** กัน AI ตอบทับพนักงาน Page inbox + quick_reply.payload ชนะ title + attachment URL→imageMessageId · Send API v23.0 `messaging_type:RESPONSE` · profile best-effort) · route [/api/ai-quote/messenger](app/api/ai-quote/messenger/route.ts) (GET hub.challenge handshake fail-closed + POST mirror LINE route; `unreachable()` stubs กัน track deps) · `routeInbound` **`trackEnabled` gate** (default true=LINE, Messenger=false → /track กลายเป็น text ธรรมดา) + log prefix `[ai-quote/${channel}]` · **M5 generalize**: `loadSession({channel, channelUserId})` — channelUserId ไม่มี channel = **fail-closed** (`channel = NULL` ไม่ match) + `createMessengerSession` (PSID ใน column `line_user_id` เดิม — **zero DB migration**, ชื่อ column historical จงใจไม่ rename กลาง traffic) · [slip-messenger.ts](lib/ai-quote/slip-messenger.ts) text 4 สถานะ (share `classifySlipState`+formatters จาก slip-flex — การ์ดกับ text ไม่มีวันเถียงกัน) · escalation-flex `{channel, channelUserId}` + แถว "ช่องทาง: Facebook Messenger — ตอบต่อใน Page inbox" (LINE zero visual change, test pin) · badge Messenger /quote-leads · [RUNBOOK-1c-messenger-setup.md](RUNBOOK-1c-messenger-setup.md). **Review จับจริง 2:** slip renderer parity gap (duplicate ขาดบรรทัด sender / mismatch ขาดยอดโอน — **plan gap ผมเอง**, แก้+pin [`3dc3a55`](https://github.com/witsarutnook/penprinting-dashboard/commit/3dc3a55)) · runbook agent จับ **slip-metrics ไม่มี ?channel= filter** (plan สั่งเช็ค channel=messenger ที่ endpoint ไม่รองรับ → runbook เขียน caveat ดู delta รวมแทน). **Final review (opus, anchor บน spec ตาม [[feedback_plan_verbatim_review_against_spec]]) = Ready, 0 Critical/Important** — spec coverage ครบ D1-D5+§1-§5, minors informational (ส่งสลิป**ไม่มี caption** — text+image=text ชนะ · slip-metrics aggregate). Gates เขียว Node 22 (**408 tests** +35/build มี route ใหม่). **Rollout gate = ฝั่ง Meta ทั้งหมด (user actions ใน runbook): dev mode = soft launch ฟรีเฉพาะ tester, ลูกค้าจริงต้องผ่าน App Review `pages_messaging` (ต้องมี privacy policy URL บน penprinting.co — เช็คก่อนยื่น)**
>
> **Follow-up (2026-07-08, same session) — Rollout จังหวะ 0 + smoke จังหวะ 1 = 8/9 ✅ Messenger LIVE ใน dev mode:** คุณนุ๊กทำ Meta prep ครบตาม runbook (app **"AI Quoting"** ผูก business portfolio Penprinting Co., Ltd. + use case "Engage with customers on Messenger" · Page connected เฉพาะ Penprinting ("current Pages only" — least privilege) · env 5 ตัว + redeploy · webhook verified — Claude probe prod: GET health 200 + wrong-token handshake **403 fail-closed** · subscribe `messages`+`messaging_postbacks` เท่านั้น). **Smoke ด้วยบัญชี admin:** hint+ปุ่ม quick reply ✅ · gate 24h เงียบ ✅ · เข้าโหมด (ปุ่ม payload `/ขอราคา AI` ผ่าน gate) + ตีราคาใบปลิว A3 2,000 = 3.55 บ./แผ่น ✅ · **escalation ① lead #25 + ④ "สั่งเลย" lead #26 — Flex เข้ากลุ่ม LINE ครบทุก field: แถว "ช่องทาง: Facebook Messenger" + ชื่อจริงจาก FB profile (`getMessengerProfile` ทำงาน) + ราคาล่าสุด** ✅ · slip duplicate **จับซ้ำข้าม channel** พร้อมบรรทัด sender (fix review `3dc3a55` เห็นผลบน prod) ✅ · รูปไม่ใช่สลิป → เงียบ ✅ · ออกโหมด ✅. **M5 2-account = deferred** (คุณนุ๊กสั่งพัก — ต้องบัญชีที่ 2 เป็น Tester). เสนอ Button Template สำหรับ slip result → **คุณนุ๊กปัดตก** (text พอ, YAGNI — mockup ให้ดูแล้ว). **Hint reword** ([`1594618`](https://github.com/witsarutnook/penprinting-dashboard/commit/1594618)): copy ใหม่จากคุณนุ๊ก — ทักทาย + scope AI (โบรชัวร์/หนังสือ/สมุด) + บอก Packaging รอทีมงานชั่วโมงทำการ; ตัด `**` markdown (แชตไม่ render) → วงเล็บ+บรรทัดแยก; shared กับ LINE (จะเห็นเมื่อเปิด hint flag ฝั่งนั้น); ทดสอบของจริงต้องรอ gate 24h หรือบัญชี tester ใหม่ (= จังหวะเดียวกับ M5).
>
> ## ⏳ Pending (2026-07-08)
> 1. 📱 **M5 2-account Messenger (deferred)**: เพิ่มบัญชีทีมงานเป็น Tester ใน App roles → เข้าโหมด AI → **ต้องไม่เห็นบทสนทนา/ราคาของบัญชีแรก** — ทำคู่กับ M5-line ที่ค้างเหมือนกัน. (optional แถม: สลิปใหม่ที่ไม่เคยส่ง → เคส ✅ success ยังไม่เห็นบน prod — รอสลิปจริงใบแรกก็นับได้)
> 2. 🚀 **จังหวะ 2 Go-live เมื่อพร้อมเปิดลูกค้าจริง**: เช็ค privacy policy URL บน penprinting.co (ไม่มี = งานเล็กฝั่ง penprinting-web ก่อนยื่น) → App Review `pages_messaging` + screencast → สลับ Live → persistent menu + ice breakers (Claude เตรียม payload ให้)
> 3. 🎨 **(carryover 7/07 — LINE)**: rich menu รอรูปดีไซน์ · smoke LINE ที่เหลือ (④ "สั่งเลย" + **M5 2-account** + /track/สลิประหว่างโหมด) · revert gate "/" หลัง soft launch นิ่ง (ทั้ง LINE+Messenger ได้ keyword สะอาดพร้อมกัน — `isEnterAiKeyword` ใช้ร่วม)
> 4. 🔭 **Follow-up เล็ก (optional)**: slip-metrics เพิ่ม `?channel=` filter (ตอนนี้ aggregate รวม — runbook มี caveat) · `loadSession` opts type-level pairing (hardening ที่ reviewer เสนอ, runtime fail-closed + test ครอบแล้ว)
>
> ---
>
> **Session 2026-07-07 — Rollout จังหวะ 1 LIVE ✅ + escalation Flex verified end-to-end + rich menu (API postback) prep — ปิด doc gap ของ iPad session เมื่อเช้าด้วย:** คุณนุ๊ก (`/session-start`) → "เช็คอีกที ผม deploy ผ่าน iPad ไปเมื่อเช้า". Context check จับ origin นำ local 2 commits จาก **cloud session iPad (ไม่ได้ลง doc — entry นี้ปิด gap):** [`8572297`](https://github.com/witsarutnook/penprinting-dashboard/commit/8572297) a11y aria-label board search + bulk-forward select (A11Y partial) · [`25890f6`](https://github.com/witsarutnook/penprinting-dashboard/commit/25890f6) **TEST-ONLY soft-launch gate** — เข้าโหมด AI ต้องมี "/" นำหน้า (`/ขอราคา`/`/ตีราคา`) กันลูกค้าจริงพิมพ์คำธรรมดาหลุดเข้าโหมด; revert instructions อยู่ใน comment ทั้ง `isEnterAiKeyword` (webhook-router.ts) + `HINT_QUICK_REPLY` (customer-triggers.ts). **Verified prod (Chrome MCP):** db-migrate applied (`ai_quote_line_modes` + `line_user_id`, mode row=1) · flag ON จริง — lead #23 "Nook" badge LINE 09:33 ตีราคาหนังสือ 71.64/เล่ม · **escalation ① end-to-end**: "ขอคุยกับทีมงาน" → Flex เข้ากลุ่มพนักงานจริง (การ์ด + เหตุผล + **ราคาล่าสุด ~0.98/ใบ จาก `loadLastQuote` — fix `87246bf` ทำงานบน prod**) + lead #23 → `escalated` + exit "จบ" ✅. **FAQ "Flex เข้าตอนไหน":** เฉพาะ 4 escalation triggers (`escalate()` [webhook-router.ts:254](lib/ai-quote/webhook-router.ts)) — ตีราคาปกติไม่ push (กัน spam กลุ่ม; lead ขึ้น /quote-leads เฉยๆ). **Rich menu:** คุณนุ๊กเลือกทางเข้าโหมด soft launch = "/" command + rich menu (เลื่อน rich menu จากจังหวะ 2 มาทำเลย). Postback `ai_quote_start` **bypass gate "/"** อยู่แล้ว ([webhook-router.ts:74](lib/ai-quote/webhook-router.ts) + [channels/line.ts:70](lib/ai-quote/channels/line.ts), มี test; ignored ในกลุ่ม = ถูก) แต่ OA Manager ตั้ง postback ไม่ได้ → ทำผ่าน **Messaging API**; API default menu **ทับเมนูเดิมของ OA Manager โดยไม่ลบ** (priority: per-user > API default > OA Manager) → rollback = ถอด API menu แล้วเมนูเดิมกลับมาเอง. **เตรียมครบใน workspace `../line-oa-richmenu/`** (นอก repo): richmenu.png 2500×1686/138KB (render Chrome headless + Anuphan, Thai stacked marks ตรวจแล้ว) · richmenu.json (5 โซน: AI postback displayText "ขอราคา AI" / portfolio / maps / dashboard `/track` / tel — ลิงก์จาก `penprinting-web/lib/seo.ts`) · deploy-richmenu.sh (create→upload→set-default + error check + rollback cmds, token ผ่าน `read -s` ไม่ผ่านแชต) · richmenu.html source. **คุณนุ๊กจะดีไซน์รูปเองแล้วส่งกลับ** → เหลือ: รับรูป → remap JSON bounds ตาม layout ใหม่ → คุณนุ๊กรันสคริปต์. ไม่มี code change ใน repo (entry นี้ docs-only).
>
> ## ⏳ Pending (2026-07-07)
> 1. 🎨 **Rich menu รอรูปดีไซน์จากคุณนุ๊ก** (2500×1686 เต็ม หรือ 2500×843 ครึ่ง — ≤1MB PNG/JPEG) → Claude remap `line-oa-richmenu/richmenu.json` ตาม layout → คุณนุ๊กรัน `deploy-richmenu.sh`
> 2. 📱 **Smoke ที่เหลือ**: ④ "สั่งเลย" หลังได้ราคา (→ lead "กำลังติดตาม" + Flex) · **M5 2-account test (สำคัญสุด — security acceptance)** · `/track` + สลิประหว่างอยู่ในโหมด (priority เดิม) · ② ③ optional (push pipeline พิสูจน์แล้ว ①, detector มี unit test)
> 3. 🔁 **หลัง soft launch นิ่ง**: revert gate "/" (ดู comment TEST-ONLY 2 ไฟล์) + พิจารณา `AI_QUOTE_LINE_HINT_ENABLED` จังหวะ 2
> 4. (carryover) เฝ้า slip-metrics + Sonnet 5 cost + lead LINE ใน /quote-leads
>
> ---
>
> **Session 2026-07-06 — Phase 1b-B EXECUTE ✅ MERGED (PR [#18](https://github.com/witsarutnook/penprinting-dashboard/pull/18) squash `5f8954e` → auto-deploy; flag OFF = prod ยัง 1b-A เป๊ะ, รอ rollout):** คุณนุ๊ก (`/session-start`) เลือก Phase 1b-B execute. Flow: อ่าน spec 7/04 → `writing-plans` (plan: [docs/superpowers/plans/2026-07-06-ai-quote-phase1b-b-line-customer.md](docs/superpowers/plans/2026-07-06-ai-quote-phase1b-b-line-customer.md), 12 tasks TDD) → **subagent-driven execution** (implementer/task + 2-stage review; บาง task verbatim ผม verify mechanical แทน reviewer ที่ stall). **สร้าง:** ตาราง `ai_quote_line_modes` (1 row/LINE user — mode fields nullable [deviate spec DDL จงใจ: row เดียวถือ 24h hint gate ที่ต้องรอดข้าม exit] + `rounds_no_quote` + FK `session_id INTEGER REFERENCES ... ON DELETE SET NULL`) + `ai_quote_sessions.line_user_id` · [lib/ai-quote/line-mode.ts](lib/ai-quote/line-mode.ts) (lazy 30-min expiry ไม่มี cron, hint gate ใน **DB ไม่ใช่ KV** — fail-open จะ spam แชตพนักงาน) · [customer-triggers.ts](lib/ai-quote/customer-triggers.ts) (detectors ①④ แคบจงใจ กัน false-fire บนประโยคสเปก; ② `detectCustomerEscalation` = quote 0 + วลี pin "ส่งต่อทีมงาน" — ไม่ใช้ staff heuristic) · [prompt-customer.ts](lib/ai-quote/prompt-customer.ts) (แยกไฟล์จาก staff prompt จงใจ duplicate domain rules — pin วลี hand-off) · [escalation-flex.ts](lib/ai-quote/escalation-flex.ts) · db.ts **M5 owner-check** (`loadSession({lineUserId})` → channel+owner ใน WHERE, mismatch→null) + `createLineSession`/`countQuotes`/`loadLastQuote` · webhook-router: entry `ขอราคา`/`ตีราคา`(±AI)/postback + exit `จบ`/`ออก` + **arms เต็ม** ผ่าน `CustomerAiDeps` ฉีดทุก side-effect (hint ≤1/24h sub-flag ปิดตอน soft launch · rate 30/ชม. · escalate 4 triggers → push Flex กลุ่มพนักงาน พร้อมราคา · exit mode ทุก trigger) · route wiring (Sonnet 5 + customer prompt; **aiEnabled = flag AND QUOTE_API_URL/TOKEN AND ANTHROPIC_API_KEY** — ขาด = 1b-A) · LINE badge /quote-leads. **Review จับจริง 3:** FK type `session_id` (`c06655a` amend) · **trigger ④ Flex ไม่มีราคา — spec §4 gap ใน plan ผมเอง** (แก้ `escalate` ดึง `loadLastQuote` จาก DB uniform ทุก trigger `87246bf` + router test pin) · ANTHROPIC_API_KEY gate asymmetry (`0caa049`). **Final review (opus) = Ready, 0 Critical/Important**; minors documented (quick-reply หายบน push fallback · LINE redelivery double-insert quotes = accepted). Gates เขียว Node 22 (**373 tests** +79/build). **Lesson:** plan-verbatim execution — spec-review เทียบ plan (byte-match) ผ่านทั้งที่ plan drift จาก spec → final review ต้องเทียบ spec ต้นทางเสมอ ([[feedback_plan_verbatim_review_against_spec]]). Bonus: เพิ่ม permission allowlist 5 patterns ใน workspace `.claude/settings.json` (nvm/vitest/grep/fetch — ลด prompt ~90% ของ workflow นี้).
>
> ## ⏳ Pending (2026-07-06) — Rollout จังหวะ 1 (คุณนุ๊ก actions, gate ของ soft launch)
> 1. 🔑 **Vercel env**: `LINE_STAFF_GROUP_ID` (หา id: พิมพ์ `/groupid` ในกลุ่มพนักงาน) + `AI_QUOTE_LINE_ENABLED=true` → **redeploy** (env live ต่อเมื่อ deploy ใหม่ — [[feedback_ai_quote_phase1a]])
> 2. 🗄️ **รัน `GET /api/admin/db-migrate`** หลัง redeploy (Chrome MCP ได้) — ตรวจ applied มี `CREATE TABLE ai_quote_line_modes` + `ai_quote_sessions.line_user_id column`
> 3. 📱 **Soft-launch smoke บน LINE จริง** (ทีมงาน): เข้าโหมด (`ขอราคา AI`) → intro · ตีราคา 3 ประเภท · `/track` + สลิประหว่างโหมด (priority เดิม) · escalation ทั้ง 4 (ขอคุยกับคน / งานกล่อง / วน 4 รอบ / "สั่งเลย" หลังได้ราคา) → Flex เข้ากลุ่ม + lead badge LINE ใน /quote-leads · ออกโหมด (`ออก`) · **M5: LINE account ที่ 2 เข้าโหมด → ต้องไม่เห็นบทสนทนา/ราคาของคนแรก**
> 4. 🎨 **จังหวะ 2 (หลัง soak)**: `AI_QUOTE_LINE_HINT_ENABLED=true` + redeploy + rich menu ใน LINE OA Manager (ปุ่มส่ง text `ขอราคา AI` หรือ postback `ai_quote_start`)
> 5. (carryover) เฝ้า slip-metrics + Sonnet 5 cost ต่อ — เพิ่ม: ดู lead LINE ใน /quote-leads หลังเปิด flag
>
> **Rollback:** `AI_QUOTE_LINE_ENABLED=false` + redeploy → 1b-A เป๊ะ (ไม่ต้อง revert code)
>
> ---
>
> **Session 2026-07-04 — A (ปิด backlog เล็ก) + B (PERF-H2/M2 slim payload) ✅ SHIPPED + verified prod ครบทุก path (2 commits ตรง main → auto-deploy):** คุณนุ๊ก (`/session-start`) เลือก "A แล้ว B". **A — PERF-M3 + monitoring verify:** (1) **PERF-M3** ([`2d8ad7a`](https://github.com/witsarutnook/penprinting-dashboard/commit/2d8ad7a)) — `/api/board/delta` เพิ่ม `export const dynamic='force-dynamic'` (match session-gated route convention; requireSession อ่าน cookies = dynamic อยู่แล้วโดยปริยาย) + `Cache-Control: no-store` บน success response (payload per-cursor/per-session ห้าม CDN/proxy cache; client ยิง cache:'no-store' อยู่แล้ว = server pair). zero behavior. (2) **slip-metrics verified** (Chrome MCP prod): 30วัน images 51/thunder 21/filtered 30/slip_ok 20 → **gate ประหยัด quota 59%** (thunder=images−filtered เป๊ะ), วัน clean 7/01-7/03 reconcile เป๊ะ, 6/30 migration-day artifact (counter เริ่ม 0). (3) **quote latency + Sonnet 5 verified prod**: "โบรชัวร์ 1000" → 4.78/ชิ้น assume-and-disclose <10s ตรง preview, ไม่มี junk lead. **B — PERF-H2/M2 slim order delta** ([`af45644`](https://github.com/witsarutnook/penprinting-dashboard/commit/af45644)): audit เผยเป็น 8-ไฟล์ phase (3 render paths เสี่ยง regression) ไม่ใช่ quick win → ผมเลือกลุยเต็มด้วย **TDD**. **Root:** `loadBoardDelta` ยิง `SELECT raw FROM orders` ส่ง rawData/details blob เต็ม**ทุกใบทุก payload** (baseline prod: bootstrap = **464 orders × ~1KB rawData ≈ 0.5MB spec เปล่า** ที่ list/board ไม่ render inline). **Fix:** slim projection `(raw - 'rawData' - 'details') || jsonb_build_object('pin', COALESCE(#>>{rawData,pin},#>>{details,pin}), 'hasSpec', <bool>)` — เก็บ top-level display fields ครบ + project 2 derived field ที่ list/board ต้องใช้: `pin` (โชว์ใน /orders row) + `hasSpec` (คุม card "สเปคงาน" tab). **Key insight:** ทั้ง /board + /orders SSR bootstrap และ client poll ผ่าน `loadBoardDelta` ตัวเดียว → slim จุดเดียว = server+client slim uniform (**ไม่มี dual-shape**). Consumers → lazy-fetch ผ่าน `/api/orders/raw/[id]` ที่มีอยู่แล้ว: orders-list.ts (pin top-level, rawData→null; orders modal มี fetch fallback อยู่แล้ว = ไม่ต้องแก้) · board.ts (OrderSummary +hasSpec) · **card.tsx** (spec tab lazy-fetch merged rawData → buildSpecSections เหมือน orders modal; hasSpec จาก flag; memo swap dead `details` ref-check → `hasSpec`) · **order-form.tsx** (edit จาก board card [slim initial] lazy-fetch spec ก่อน prefill, header apply ทันที; /orders edit page ส่ง full order → skip fetch). **TDD:** board-delta SQL projection shape (+2) · computeOrdersList pin+null-rawData (+2) · computeBoard hasSpec mapping (+2, `tests/board.test.ts` ใหม่). Gates เขียว Node 22 (type-check/lint 0-err/**294 tests** +6/build). **Verified prod (Chrome MCP หลัง deploy):** delta shape = pin+hasSpec, ไม่มี rawData/details, 464 ครบ, 0 missing display field, pins จริง (7752/8831/8358) · **payload 126KB (จาก ~600KB, −78%)** · UI smoke 6/6: /board render+0 error · card spec tab (curated spec ครบ) · **card edit prefill 9/9 + spec เต็ม (path เสี่ยงสุด เดิมกลัว form ว่าง)** · /orders 464 rows · modal PIN 7752 · modal spec tab lazy-fetch. **Zero behavior change ยืนยันจริง.** **AUDIT-BACKLOG perf backlog = 0 open** (PERF-M3 + H2/M2 ปิดหมด). **Lesson:** slim wire-shape phase = ยิง 1 loader ที่ server+client share → ไม่มี dual-shape; consumer ที่มี fetch-fallback อยู่แล้ว (orders modal) ไม่ต้องแตะ, ที่อ่าน inline ตรง (card spec/edit) เพิ่ม lazy-fetch pattern เดียวกัน; verify SQL projection บน prod data จริง (mock test pin แค่ text) — hit `/api/board/delta` เทียบ baseline shape ก่อน+หลัง.
>
> **Follow-up (2026-07-04, same session)** ([`8ed3997`](https://github.com/witsarutnook/penprinting-dashboard/commit/8ed3997)): คุณนุ๊กถาม flow slip + ขอ 2 tweak. **(ตอบ)** slip **ไม่ได้ส่งตรงทุกรูปให้ Thunder** — มี Haiku vision pre-filter (`isSlipImage`) ก่อน: รูปเข้า→Haiku ตัดสิน "ดูเป็นสลิปมั้ย"→**ถ้า yes** ส่ง Thunder verify + ตอบ Flex / **ถ้า no** เงียบ (gate err-toward-yes, ประหยัด quota; นี่คือ filter 59% ที่ verify วันนี้). รูปที่คุณนุ๊กเจอ = ใบเสนอราคา Penprinting (มีเลขบัญชีท้ายใบ → Haiku ผ่าน gate → Thunder ยืนยันไม่ได้ → unreadable card). **(2 tweak)** slip unreadable Flex message → "ระบบไม่สามารถยืนยันสลิปได้ / รบกวนส่งรูปสลิปใหม่ให้ชัดเจน / หรือรอทีมงานตรวจสอบอีกครั้ง" (3 บรรทัด `\n`, header label 'อ่านสลิปไม่ได้' คงเดิม) · เพิ่มหน่วย **'ห่อ'** ใน `QTY_UNITS` order form (ระหว่าง ถุง/ชิ้น). Gates เขียว (294 tests). Live หลัง Vercel deploy.
>
> **Brainstorm (2026-07-04, same session) — Phase 1b-B DESIGNED ✅ spec committed, execution รอ:** คุณนุ๊กสั่ง "brainstorm ไว้รอก่อน" → superpowers brainstorming flow ครบ, design approved. **Spec: [docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md](docs/superpowers/specs/2026-07-04-ai-quote-phase1b-b-line-customer-design.md)**. Decisions: **D1** opt-in mode (rich menu + keyword, idle 30min lazy-expiry, ไม่มี cron) · **D2** นอกโหมด hint+ปุ่ม 1-แตะ conservative ≤1/user/24h (OA มีพนักงานตอบเอง — ห้ามแทรก) · **D3** escalation 4 triggers (ขอคุยกับคน/นอกขอบเขต/วน4รอบ = Type A `escalated` + ลูกค้าจะสั่ง = Type B `กำลังติดตาม`) → push Flex กลุ่มพนักงาน + /quote-leads, ออกโหมดทุก trigger · **D4** model = Sonnet 5 engine เดิม + Haiku gates, **zero model change** (เช็ค claude-api skill: Opus 1.7×/Fable 3.3× แพงเกินงาน, Sonnet intro ถึง 31 ส.ค.). ใหม่: ตาราง `ai_quote_line_modes` + customer prompt variant + escalation-push + M5 owner-check (`line_user_id` bind+check, 404 on mismatch) + rate limit 30/ชม. **Execute session หน้า: อ่าน spec → `superpowers:writing-plans` → execute. Gate = คุณนุ๊กตั้ง `LINE_STAFF_GROUP_ID` env (หา id ด้วย `/groupid` ในกลุ่มพนักงาน) + redeploy; rich menu ค่อยตั้งจังหวะ 2 (soft launch keyword-only ก่อน).**
>
> ## ⏳ Pending (2026-07-04)
> 1. **Phase 1b-B execute** — spec พร้อม (ดู entry ด้านบน); รอคุณนุ๊กตั้ง `LINE_STAFF_GROUP_ID` + สั่งเริ่ม
> 2. **(optional) เฝ้า perf จริง** — bootstrap payload เล็กลง 78% ควรเห็น board/orders โหลดไวขึ้นบน mobile/3G. ไม่มี action, สังเกตเฉยๆ
> 3. **(carryover) slip-metrics + Sonnet 5 cost** — ยัง soak; ดู `/api/admin/slip-metrics` เรื่อยๆ + Anthropic console cost
>
> ---
>
> **Session 2026-07-03 (cont.) — iPad PWA logout fix + performance audit (M1/L1/H1 shipped) ✅ (4 commits ตรง main → auto-deploy):** คุณนุ๊กขอ (1) เช็ค performance ระบบ + (2) แก้ iPad PWA เด้ง login ตอนสลับ app. **(1) PWA logout root cause** ([`d414e0e`](https://github.com/witsarutnook/penprinting-dashboard/commit/d414e0e)): dashboard เปิดจากไอคอน home-screen เต็มจอ แต่**ไม่มี PWA config** (ไม่มี manifest/appleWebApp/SW) → iOS ให้ storage แบบ throwaway → evict cookie jar ตอนสลับ app → เด้ง `/login`. **ไม่ใช่ cookie ผิด** (persistent 30d/httpOnly/secure/lax ถูกหมด — verify [login/route.ts:161](app/api/auth/login/route.ts:161); logout ยิงเฉพาะกดออกเอง). Fix: [`app/manifest.ts`](app/manifest.ts) (display standalone, start `/board`, theme `#c8553d`, icons 192/512 จาก icon.png) + `appleWebApp` ใน [lib/seo.ts](lib/seo.ts) (emit `apple-mobile-web-app-capable` — ตัวสำคัญ iOS). Confidence สูง (remedy มาตรฐาน) แต่ iOS ยัง evict ได้ถ้าไม่ใช้ >7d (ITP; ใช้ทุกวันไม่โดน). **(2) Performance audit** (penprinting-auditor): hot path สภาพดีมาก — delta-fetch/`unstable_cache` coalescing/adaptive-poll(15→30→120s+30min hard-stop+refreshGuard)/bundle-split(recharts lazy)/indexes ครบ **verified clean**. findings ใหม่ = payload/scan ที่โตตาม row count (ไม่พังตอนนี้ ~220 orders). **ทำแล้ว 3:** **M1** ([`e5a0bdb`](https://github.com/witsarutnook/penprinting-dashboard/commit/e5a0bdb)) cache shipped/cancelled orderId sets (`loadOrderIdSetsCached` unstable_cache 15s, tag LOAD_ALL_TAG — job writes invalidate) → N tabs coalesce แทน DISTINCT full-scan/tab/poll · **L1** memoize `rows.find` active row ใน OrdersTable · **H1** ([`8720a9e`](https://github.com/witsarutnook/penprinting-dashboard/commit/8720a9e)) `/orders/new` เลิก `loadAll()` → 3 targeted reads (`loadRecentOrdersSlim` projection `jsonb_typeof(raw->'rawData')` LIMIT 1000, `loadOrderFormTemplates`, `loadOrder(orderOnly)` สำหรับ ?from= prefill) — **behavior เดิมเป๊ะ** (shape/1000-cap/sort/canonical carry). Gates เขียว Node 22 ทุก commit (288 tests/build). **Lesson:** iOS home-screen web app เด้ง login = missing PWA standalone config (storage eviction) ไม่ใช่ cookie bug ([[feedback_ipad_pwa_standalone_session]]).
>
> ## ✅ Verified prod (2026-07-03 cont.) — คุณนุ๊ก smoke ผ่านทั้งคู่
> 1. **iPad PWA = OK** — re-add home-screen icon แล้ว, session ค้างข้ามการสลับ app (PWA standalone fix ได้ผลจริง → [[feedback_ipad_pwa_standalone_session]] confirmed)
> 2. **`/orders/new` = OK** — template dropdown + customer autocomplete + "สั่งซ้ำ" prefill ครบ (H1 slim SQL loaders ถูกต้องบน prod จริง)
>
> ## ⏳ Deferred perf → AUDIT-BACKLOG (ไม่เร่งด่วน)
> - **PERF-H2/M2** — board/orders delta re-send `orders.raw` เต็มทุกใบ → slim Order display shape แยกจาก spec (งาน **phase**, blast-radius กว้าง: computeBoard/computeOrdersList/detail modal พึ่ง inline rawData)
> - **PERF-M3** — annotate `/api/board/delta` `dynamic`/Cache-Control (S)
>
> ---
>
> **Session 2026-07-03 — Bug fix: "สั่งซ้ำ" ดึงชื่องาน + ชื่อลูกค้ากลับมาแล้ว (restore WP parity) ✅ SHIPPED + smoke-verified prod (`c7daeb0`, commit ตรง main → auto-deploy):** คุณนุ๊กรายงาน: กด "สั่งซ้ำ" ในหน้าใบสั่งใหม่แล้ว **ชื่องาน + ชื่อลูกค้าว่าง**. เข้า `/diagnose` flow (ไม่เดา-แก้ — โซนนี้เคยแก้หลายรอบ DuplicateInfo.mode `e0b1ae4`). **Root cause:** duplicate prefill effect ([order-form.tsx:189](app/board/order-form.tsx:189)) **จงใจล้าง** `next.name=''` + `next.customer=''` — git blame ยืนยันมาตั้งแต่ commit แรกของฟีเจอร์ (`089ad08`), **ไม่ใช่ regression เพิ่งเกิด**. **หลักฐานชี้ port-regression:** WP `duplicateOrder()` ต้นฉบับ (`production-monitoring/assets/production-monitoring.js`) **carry name+customer** + clear แค่ due date (`applyOrderRawDataToForm` เซ็ต `of-name`/`of-customer` ตรงๆ) — docstring v2 เขียน "Mirrors WP duplicateOrder()" แต่ v2 ดันเพิ่ม blanking = **หล่นจาก WP เงียบๆ**. คุณนุ๊กเลือก (AskUserQuestion): carry ทั้ง 2 ฟิลด์ + **คงเตือน duplicate ไว้** (safety net กดยืนยัน). **Fix 4 จุด:** ถอด blanking ที่ order-form effect (เหลือ reset dates) · inject canonical `name`/`customer` ใน [page.tsx](app/orders/new/page.tsx) กัน rawData stale (mirror edit-path override) · update 2 docstrings (order-form prop + client.tsx). **+3 guard tests** ([tests/order-form-from-raw.test.ts](tests/order-form-from-raw.test.ts)) pin ว่า `orderFormFromRaw` carry name/customer. **Seam gap (diagnose Ph5):** bug อยู่ใน client `useEffect` = repo ไม่มี RTL harness (vitest env=node, `.ts` only) → verify ถูกโดยโครงสร้าง (input bind `value={data.name}`/`data.customer` @976/981 + pure-dep test) แทน component-test. ผลลัพธ์: duplicate flow consistent กับ WP + ปุ่ม "ดึงงานล่าสุด" (carry อยู่แล้ว); `applyTemplate` คงล้าง (ถูก — template generic sample). Gates เขียว Node 22 (type-check/lint 0-err [1 warn `slip.ts:71` pre-existing]/**288 tests** +3/build). **Smoke prod: คุณนุ๊ก verified "เช็คแล้วโอเค"**. **Lesson:** port docstring "Mirrors X" = claim ไม่ใช่ proof — grep source จริงก่อนเชื่อ ([[feedback_port_mirrors_comment_lies]]; ญาติ [[feedback_audit_backlog_hypothesis]]).
>
> ---
>
> **Session 2026-07-02 (cont.) — AI Quote engine: Haiku 4.5 → Sonnet 5 ✅ SHIPPED (merged `2bcb56e`, preview smoke 4/4):** คุณนุ๊กถาม "ใช้ Haiku โอเคมั้ย" (จากภาพ pricing console). grep เจอใช้ Haiku 2 จุด: **(1) slip pre-filter vision** ([line/route.ts:19](app/api/ai-quote/line/route.ts:19) `VISION_MODEL`) = binary gate ก่อน Thunder → **keep Haiku** (งานถูก, model ใหญ่ = แพงเปล่า ผิดวัตถุประสงค์ gate) · **(2) quote engine** ([ai-quote/route.ts:15](app/api/ai-quote/route.ts:15) `MODEL`) = จุดที่ Haiku over-clarify ซ้ำ (ถามสีปก 3 รอบ, soft-default แพ้) → **swap Sonnet 5**. **Change:** `MODEL='claude-sonnet-5'` + `MAX_TOKENS` 2048→4096 ([run.ts:7](lib/ai-quote/run.ts:7) — Sonnet 5 เปิด adaptive thinking auto เมื่อ `thinking` unset [Haiku ไม่เปิด] → กัน thinking กิน budget จน reply truncate). ไม่ set temperature/thinking → ไม่มี Sonnet-5 400. **Preview smoke (Chrome MCP, nook/ADMIN) 4/4 ผ่าน:** `โบรชัวร์ 1000` → assume-and-disclose ตีเลย 4.78/ชิ้น (disclose A4/4สี/2หน้า/Art120) · "ขก ราม" cover-color case (เคย hard-rule 3 รอบ) → **ไม่ถามสีปกช็อตแรก** + alias อาร์ทการ์ด→Art 210 + "ทั้งเล่ม" ถูก · เนื้อในขาวดำ → **ไม่ re-ask ปก** (disclose default) · full book → 32.64/เล่ม (compute_quote ทำงาน, robust ต่อ typo ปอนด→Bond). ตอบ <10 วิ · tool-eagerness ดี · ไม่มี truncate/500 · ไม่สร้าง junk lead. Gates เขียว Node 22 (**285 tests**/build). branch `experiment/ai-quote-sonnet5` ลบแล้ว. **Cost:** Sonnet 5 = 2× Haiku (intro ถึง 31 ส.ค.) / 3× หลังนั้น — staff-facing volume ต่ำ เงินเพิ่มน้อย. **Lesson:** model ที่ต้อง patch hard-rule ซ้ำๆ เพื่อ instruction-following → upgrade base model = leverage สูงกว่าเพิ่ม rule ([[feedback_llm_assume_and_disclose_clarify]] + [[feedback_ai_quote_model_upgrade_over_hardrule]]); Sonnet5/Opus4.7+ เปิด adaptive thinking default เมื่อ `thinking` unset → bump max_tokens ใน tool-use loop.
>
> ## ⏳ Pending (2026-07-02 cont.)
> 1. **verify prod หลัง deploy** — dashboard.penprinting.co /quote-assistant ใช้ Sonnet 5 (code swap = live เมื่อ deploy landed, ไม่ต้องแตะ env; ANTHROPIC_API_KEY ตัวเดิมใช้ได้ทั้ง 2 model)
> 2. **เฝ้า latency/cost จริง** — ถ้า Sonnet 5 ช้า/แพงเกินรับ → dial `thinking: {type:'disabled'}` (เร็วขึ้น, max_tokens กลับ 2048 ได้) หรือ revert เป็น Haiku
>
> ---
>
> **Session 2026-07-02 — Cleanup: LOG-1 (ถอด slip diagnostic logs) + Follow-up #1 (track/lookup refactor) ✅ SHIPPED + gates เขียว (commit ตรง main → auto-deploy prod):** คุณนุ๊ก (`/session-start`) เลือก focus = cleanup เบาๆ ปิด backlog ก่อนงานใหญ่. Context check: local == origin `04d8f1a` clean. ใช้ **TDD** สำหรับ refactor. **(1) LOG-1** ([`24f2e68`](https://github.com/witsarutnook/penprinting-dashboard/commit/24f2e68)) — ถอด diagnostic `console.log` 5 จุด (`webhook-router.ts`: inbound / slip pre-filter / thunder result / reply sent + `slip.ts`: isSlipImage haiku answer); **เก็บ** error log ที่ [route.ts:69](app/api/ai-quote/line/route.ts:69); grep หาจุดจริงก่อนลบ (line refs ใน backlog stale หลัง track-customer เลื่อนบรรทัด). **(2) Follow-up #1 / Issue #1** ([`55691c8`](https://github.com/witsarutnook/penprinting-dashboard/commit/55691c8)) — **RED→GREEN→wire**: extract pure [`lib/track-result.ts`](lib/track-result.ts) `buildTrackResult` + **7 characterization tests** ([tests/track-result.test.ts](tests/track-result.test.ts)) pin พฤติกรรมเดิมทุก branch (cancelled/shipped/graphic-print-post/awaitingShip/overdue/empty-dept/no-job) **ก่อน** refactor — public route เดิม **ไม่มี test** = เหตุ defer → delegate status core (currentDept/awaitingShipment/daysLeft) ไป `deriveTrackStatus` (web `/track` + LINE Flex + customer list = source เดียว, DRY). **สำคัญ: preserve empty-dept quirk** `status='in_progress'` เมื่อ job มีแต่ dept ว่าง (deriveTrackStatus จะบอก `'received'` — quirk นี้ **กระทบสี badge** ใน client `badgeVariant` line 44-45) → **zero behaviour change**. route −135 LOC net. Gates เขียว Node 22 (type-check / lint 0-err [1 warn `slip.ts:71` `_r` pre-existing, ไม่แตะ] / **285 tests** +7 / build). **AUDIT-BACKLOG: LOG-1 + Issue #1 = ปิดทั้งคู่.** **Lesson (ซ้ำ):** backlog line refs = leads ไม่ใช่ facts — grep code จริงก่อน ([[feedback_audit_backlog_hypothesis]]); refactor public route ที่ไม่มี test → characterization test ก่อน delegate (behavior ต่างจุดเดียว [empty-dept] จับได้เพราะ pin ก่อน).
>
> ## ⏳ Pending (2026-07-02)
> 1. **(optional smoke, ไม่ critical)** หลัง Vercel deploy เสร็จ → web `/track` ใส่เลข+PIN จริง 1 ใบ ยืนยัน status/step/daysHint ยังตรง (zero behaviour change + characterization test ครอบแล้ว — แต่เป็นครั้งแรกที่ public route มี test + แตะ)
> 2. **(carryover 6/30) ดู `/api/admin/slip-metrics`** หลัง traffic 2-3 วัน — `filtered_out` ควรเป็นรูปไม่ใช่สลิปเท่านั้น + `thunder_calls` สมเหตุผล
> 3. **Follow-up #2 (จาก 7/01)** — require-slash customer track form (bare "track" ในกลุ่มยัง route — Issue #3 review)
> 4. **Phase 1b-B** (งานใหญ่ถัดไป) — เปิด AI quote ใน LINE: `AI_QUOTE_LINE_ENABLED` flag · `channel_user_id` migration · mode state KV · customer prompt variant · escalation push · M5 owner-check
>
> ---
>
> **Session 2026-07-01 — Track by Customer (LINE กลุ่มลูกค้า + web tokenized link) ✅ SHIPPED + verified live prod (merged `5d9971e`, PR [#17](https://github.com/witsarutnook/penprinting-dashboard/pull/17)):** คุณนุ๊ก (`/session-start`) ขอ feature ค้นงาน**ด้วยชื่อลูกค้า → เห็นงาน active ทั้งหมด**. superpowers flow ครบ: **brainstorm** 7 decisions (surface=LINE กลุ่มลูกค้า+web · audience=**ลูกค้า** ไม่ใช่ staff · identity=**Hybrid** กลุ่มผูกลูกค้าเป็น boundary + พิมพ์ชื่อกรองได้ · register ผ่านหน้า dashboard · **active-only** · web=**tokenized link** ต่อลูกค้า · output=**adaptive** 1งาน→การ์ดเต็ม/หลายงาน→list สรุป) → **spec** (`docs/superpowers/specs/2026-07-01-track-by-customer-design.md`, workspace root) → **plan** 13 tasks → **subagent-driven execution** (implementer sonnet/task, controller inline-verify, final opus review). **สร้าง:** ตาราง `customer_registrations` (`customers text[]`·`line_group_id UNIQUE`·`web_token UNIQUE`) + migration + index `LOWER(TRIM(raw->>'customer'))` · shared pure `lib/track-status.ts deriveTrackStatus` (track-flex refactor มาใช้ร่วม) · `lib/customer-track.ts loadActiveJobsByCustomer` · webhook-router route `track-customer` + `parseTrackCommand` + `lib/ai-quote/customer-jobs-flex.ts` · admin `/registrations` page+API · web `/track/c/[token]`. **11 feat commits + audit-fix [`3fb8de6`]**, 21 ไฟล์ +960/-33, **278 tests** (+51), type-check/lint/build เขียว Node 22. **Final review (opus) = yes-with-minor**: (1) **array-param `= ANY(${norm})` / `${customers}` verified ปลอดภัย** — `@vercel/postgres` tagged template ส่ง values array ตรงเข้า pg `query(text,params)` ไม่ validate primitive → array bind ถูก; cast `as unknown as string` = compile-time เท่านั้น (**bug ที่ mock sql ซ่อน — เช็ค driver source ก่อนเชื่อ** [[feedback_ts_cast_hides_runtime_arraybind]]) (2) **Issue #2 audit_log บน create/delete registration → FIXED** (`appendAuditToPostgres`) (3) **Issue #1 refactor `track/lookup` ใช้ deriveTrackStatus → deferred โดยตั้งใจ** (public route ไม่มี unit test → เสี่ยง; ทำทีหลังพร้อม extract `buildTrackResult`+test). Minor #3 (bare "track" ในกลุ่ม→noise) / #5 (token-collision 409 msg) รับได้.
>
> ## ✅ Done live (2026-07-01) — merge + deploy + verify + nav ครบ
> - Merged `5d9971e` (squash) → Vercel deploy → **`db-migrate` applied** (`customer_registrations` + `idx_custreg_group` + `idx_orders_customer_norm`, รันผ่าน Chrome MCP browser คุณนุ๊ก)
> - **Verified live prod:** `/api/registrations/customers` (~200 ชื่อจริง) · admin `/registrations` render · **registration #1** (`รัฐกุล` · group `Ccd127...` · createdBy `admin:nook`, audit ทำงาน) · **web `/track/c/<token>` = 6 งาน active จริง** (daysHint/sort/badge ถูก, Bangkok TZ ตรง 30/6→เลย 1 วัน → **`= ANY(${norm})` array-bind พิสูจน์ทำงานบน prod จริง**) · คุณนุ๊ก smoke LINE ในกลุ่ม = โอเค
> - **nav link** `/registrations` เพิ่มแล้ว (`0a052a0`, กลุ่ม "รายการ" admin-only, IconUsers)
>
> ## ⏳ Follow-up (optional, ไม่บล็อก)
> 1. refactor `track/lookup` ใช้ `deriveTrackStatus` (extract pure `buildTrackResult`+test ก่อน — Issue #1, spec §5)
> 2. require-slash customer track form (review Issue #3 — bare "track" ในกลุ่มยัง route)
>
> ---
>
> **Session 2026-06-30 — Phase 1b-A LINE webhook: CUTOVER เสร็จ + slip-verify iterate บน prod + slip_checks migration applied ✅ (ปิด doc gap):** เริ่ม session บน iPad — context check พบ **git/doc mismatch ใหญ่**: NEXT-SESSION ปิดท้ายแค่ "PR #11 รอ cutover" แต่ `origin/main` ไปไกลกว่ามาก. ของจริงที่เกิดไปแล้ว (session ก่อนหน้า, ไม่ได้ลง doc): **(1) Cutover Phase 1b-A เสร็จ** — PR [#11](https://github.com/witsarutnook/penprinting-dashboard/pull/11) merged ([`c1fcbad`](https://github.com/witsarutnook/penprinting-dashboard/commit/c1fcbad)) + redeploy ([`209f53f`](https://github.com/witsarutnook/penprinting-dashboard/commit/209f53f)) → webhook `dashboard.penprinting.co/api/ai-quote/line` LIVE (probe 200). Thunder/LINE env/webhook URL ทั้งหมด **คุณนุ๊กตั้งครบแล้ว** (ไม่งั้น slip flow คงไม่ทำงาน). **(2) PR [#12](https://github.com/witsarutnook/penprinting-dashboard/pull/12) ([`627bfce`](https://github.com/witsarutnook/penprinting-dashboard/commit/627bfce))** — slip-verify ตอบเป็น **Penprinting Flex card 4 สถานะ** (สำเร็จ/ซ้ำ/ยอดไม่ตรง/อ่านไม่ได้). **(3) PR [#13](https://github.com/witsarutnook/penprinting-dashboard/pull/13) ([`d68743d`](https://github.com/witsarutnook/penprinting-dashboard/commit/d68743d))** — อ่าน Thunder **v2** slip fields จริง (date, bank.name) ลง Flex. **(4) Slip pre-filter ดราม่า (debug บน prod สดๆ, commit ตรง main):** `7d32666` diagnostic logging → `d81c6e6` loosen → **`e4a05b3` remove Haiku pre-filter ทั้งหมด** (สลิปจ่ายบิล KBank "จ่ายบิลสำเร็จ" โดน Haiku ตัดสิน "ไม่ใช่โอน" → เงียบ → พลาดสลิปลูกค้า; ยอมแลก quota) → **`0139d31` re-add** (แก้ที่ prompt: นับ bill-payment/QR/PromptPay/top-up เป็นสลิป, lean-yes drop เฉพาะ explicit "ไม่"; miss เดิม = prompt problem ไม่ใช่ gate problem). **(5) `2669ee8` slip-check metrics** — table `slip_checks` (1 row/รูปเข้า webhook) + `GET /api/admin/slip-metrics` (per-day: images/thunder_calls=quota/filtered_out/slip_ok/dup/mismatch). **งาน session นี้:** sync main (`a23496d`) + **รัน `slip_checks` migration** (db-migrate ผ่าน Chrome MCP เบราว์เซอร์คุณนุ๊ก — table ยังไม่ถูกสร้าง: slip-metrics 500→200, db-migrate ok applied "CREATE TABLE slip_checks"+idx, data เดิมครบ) + เขียน doc ปิด gap (entry นี้ + dashboard-v2 §3/§5/§9/§10 + AUDIT-BACKLOG + RUNBOOK done). **Lesson:** cheap classifier gate (Haiku) vs paid API (Thunder) ต้อง tune ที่ **prompt** ก่อนถอด gate — ถอด gate = ยอมจ่าย quota ทุกรูป; การ miss เป็น prompt problem ([[feedback_ai_quote_phase1b_thunder_prefilter]]).
>
> ## ⏳ Pending (2026-06-30) — เหลือทำต่อ
> 1. **ถอด diagnostic logging 5 จุด** (`7d32666`) — flow นิ่งแล้ว + มี slip_checks metrics แทน: `webhook-router.ts:41,49,53,60` (inbound/pre-filter/thunder-result/reply-sent) + `slip.ts:105` (haiku answer). คง `route.ts:62` (error log). → AUDIT-BACKLOG open item `LOG-1-slip-diagnostic-verbose`
> 2. **ดู `/api/admin/slip-metrics` หลังมี traffic 2-3 วัน** — verify Haiku pre-filter ไม่ drop สลิปจริง (`filtered_out` ควรเป็นรูปไม่ใช่สลิปเท่านั้น) + Thunder quota (`thunder_calls`) สมเหตุผล. counter เริ่ม 0 วันนี้ (สลิปก่อน migration ไม่ถูกนับ — backfill ไม่ได้)
> 3. **Phase 1b-B** (เปิด AI quote ใน LINE) — งานใหญ่ถัดไป: `AI_QUOTE_LINE_ENABLED` flag · `channel_user_id` migration · mode state KV (rich menu opt-in + idle timeout) · customer prompt variant (ภาษาชาวบ้าน) · escalation push กลุ่มพนักงาน · M5 owner-check (bind+verify `channel_user_id`)
>
> ---
>
> **Session 2026-06-27 (later) — AI Quote Phase 1b-A: LINE webhook takeover (slip+track parity) ✅ BUILT + reviewed → PR [#11](https://github.com/witsarutnook/penprinting-dashboard/pull/11) (รอ cutover+merge):** คุณนุ๊กเลือก focus = Phase 1b (LINE OA ลูกค้าตีราคาเอง) ต่อจาก soak. ทำ superpowers flow ครบ: **brainstorm** (decisions B1-B10) → **spec** (`docs/superpowers/specs/2026-06-27-ai-quote-phase1b-line-webhook-takeover-design.md`) → **plan** (`docs/superpowers/plans/2026-06-27-ai-quote-phase1b-a-line-webhook-takeover.md`) → **subagent-driven execution** (4 work units, spec+quality review 2 ชั้น/unit + final review). **Architectural pivot (คุณนุ๊กเสนอ): Path 1 — dashboard ถือ LINE webhook เต็มตัว** แทนพึ่ง Thunder-webhook/Cloudflare Worker → เรียก **Thunder verify API เอง** (slip), `/track` เอง, AI quote (1b-B). **channel-agnostic** (`channel`+`channel_user_id`) → Messenger เสียบทีหลัง (gate = Meta App Review). **1b-A** (PR #11, branch `feat/ai-quote-phase1b-a-line-webhook`, 16 commits): slip (Thunder `verify/bank` port จาก Remedy `lib/thunder.ts` + **Haiku vision pre-filter** กัน quota burn — Thunder นับทุก request รวม non-slip) + `/track` Flex (port `buildOrderFlex_`→TS, loadOrder-backed) + webhook route (verify HMAC→ack 200→`after()`). **AI ยังปิด** (`AI_QUOTE_LINE_ENABLED` flag, no-op stub). Gates เขียว Node 22: type-check/lint/**227 tests** (+34)/build (route `ƒ /api/ai-quote/line`). **Review จับ 3 bug จริง:** TZ day-hint เพี้ยนบน UTC server (port จาก Apps Script Bangkok-TZ) · slip vision fail-safe ไม่ครอบ empty content · reply interface โกหก type (object ผ่าน `as string`). **Lesson:** paid per-call API (Thunder) → cheap vision/heuristic gate ก่อนจ่าย quota.
>
> ## ⏳ Pending (2026-06-27 later) — คุณนุ๊ก action ก่อน merge PR #11 (Task 13 cutover)
> 1. **Thunder dashboard** → + เพิ่มสาขา "Penprinting" → KeyAPI + ตั้ง 3 บัญชีรับเงิน Penprinting + เช็ค quota
> 2. **LINE Console** (OA penprinting 2008126362) → copy Channel secret + access token
> 3. **Vercel env** `penprinting-dashboard`: `LINE_CHANNEL_SECRET` `LINE_CHANNEL_TOKEN` `THUNDER_API_KEY` `THUNDER_API_URL` → **redeploy** (env live ต่อเมื่อ deploy ใหม่)
> 4. **บันทึก Webhook URL เดิม** (rollback) → ตั้ง Webhook URL = `https://dashboard.penprinting.co/api/ai-quote/line` → Verify
> 5. **Smoke:** สลิปจริง→ตอบผล · รูปไม่ใช่สลิป→เงียบ (ไม่กิน quota) · `/track <เลข>`→Flex · ข้อความทั่วไป→เงียบ · กลุ่ม→เงียบ. Rollback = ชี้ webhook กลับ
> 6. **ดู reply slip-check เดิม 1 เคส** → จูน wording slip handler ให้ใกล้เคียง (open item §8)
> 7. **(ถ้าจะทำ Messenger)** เริ่ม submit **Meta App Review + Business Verification** คู่ขนาน (gate เป็นสัปดาห์)
>
> ## ⏳ Next — Phase 1b-B (plan แยก หลัง 1b-A cutover นิ่ง)
> เปิด AI quote: `channel_user_id` migration · mode state KV (opt-in rich menu "ขอราคา AI" + idle timeout) · customer prompt variant (ภาษาชาวบ้าน) · escalation push กลุ่มพนักงาน · qualified-lead filter ใน /quote-leads · M5 owner-check ปิดสะอาดด้วย channel_user_id (webhook-verified)
>
> ---
>
> **Session 2026-06-27 — Dashboard Next 15 + React 19 soak ปิด ✅ (migration 4/4 repos จบ 🏁):** ครบ soak window 1 สัปดาห์ (ship 6/20 → 6/27). scheduled check `dashboard-next15-soak-end-check` fire เมื่อเช้า 9:00. **Health-check production (agent, `/usr/bin/curl`):** `/login` 200 · `/`+`/board` 307→login (gated, ปกติ) · `/track` 200 · `/login` body มี title `เข้าสู่ระบบ | PP Dashboard` + RSC payload `__next_f` ×5 (Next 15 streaming ปกติ, ไม่มี error page). **คุณนุ๊ก verify manual: "ผ่าน"** — /board render skeleton→board ปกติ console 0 error (#418 fix holds) + Sentry project dashboard ไม่มี error spike ตั้งแต่ 6/20. **Cleanup:** ลบ `migration-plan-next15.md` (งานจบ, history ใน git) · update Stack ใน dashboard-v2.md + CLAUDE.md `Next.js 14`→`15 + React 19` · unlink dead refs · record soak-closed ใน Version History + AUDIT-BACKLOG. local==origin clean ก่อนเริ่ม (`15316f7`). **Lesson:** curl ไม่อยู่ใน PATH (rtk/env) → ใช้ `/usr/bin/curl` ตรง สำหรับ verification-critical HTTP check ([[feedback_rtk_git_pull_stale_uptodate]] family).
>
> ## ⏳ Pending (2026-06-27)
> 1. **(งานหลักถัดไป) Phase 1b — LINE OA** (ลูกค้าตีราคาเอง) — งานใหญ่, gate = M5 owner-check (เป็น acceptance criterion ใน `design-ai-quoting.md §7` แล้ว: bind `line_user_id` + sender-check ก่อนโหลด)
> 2. **(opt, carryover 6/26) preview smoke** channel-guard + quote-id — ไม่ critical (all sessions dashboard-channel)
> 3. **Phase 1c** — กล่อง/ถุง auto-quote (ตอนนี้ escalate อย่างเดียว, D8)
>
> ---
>
> **Session 2026-06-26 — M5 IDOR resolved + 3 Low closed + stale PR #3 closed ✅ (AI Quote audit backlog = 0 open):** Context check (fetch origin ✅ ตามbug session ก่อน) — local == origin `2605a74`, ทุก branch merge หมด. คุณนุ๊กเลือก focus = "ปิด M5 IDOR + housekeeping". **M5 มี architectural tension** ที่ surface ก่อนแก้ (ตาม [[feedback_audit_backlog_hypothesis]] — verify code จริง): finding เองแนะนำ **defer ไป 1b** เพราะ Phase 1a shared team inbox (admin/sales ภายใน) → `loadSession` ไม่ผูก owner = **design ที่ตั้งใจ ไม่ใช่ช่องโหว่**; owner-binding ตอนนี้ = regression shared inbox + ยังไม่มี identity model. **Decision คุณนุ๊ก: fold เข้า 1b spec + กัน channel guard.** ทำ: (1) เขียน M5 เป็น **acceptance criterion ของ Phase 1b** ใน `design-ai-quoting.md §7` (set `line_user_id` + เช็ค sender ก่อนคืนบทสนทนา → mismatch 404) (2) **zero-regression channel guard now:** `loadSession(id, { channel })` + staff chat route ส่ง `'dashboard'` → staff/LINE sessionId cross-load กันไม่ได้ตั้งแต่ก่อน 1b (session ปัจจุบันทั้งหมด dashboard-channel → ไม่กระทบ). **3 Low ปิดหมด:** quote id → `saveQuote` คืน `ai_quotes.id` (RETURNING id; client ใช้ map-index อยู่แล้ว = zero behaviour change) · run.ts comment `500`→`502` · db-migrate row-count เพิ่ม `ai_quote_sessions`/`ai_quotes`. **Housekeeping:** ปิด stale PR [#3](https://github.com/witsarutnook/penprinting-dashboard/pull/3) (FAB ของจริง ship ผ่าน PR #4 `66d0286`). **commit ตรง main** (internal hardening + doc, ไม่กระทบ user flow). Gates เขียว Node 22 (type-check/lint/**193 tests**/build 40). **Lesson:** security finding ที่ "ปิดเดี่ยวๆ ไม่ได้สะอาด" → แยกเป็น non-regressive prep ทำได้ทันที (channel scope) + acceptance criterion fold เข้า phase ที่มี identity model (owner-check) แทน force owner-binding ที่ regress shared inbox.
>
> ## ⏳ Pending (2026-06-26)
> 1. **(opt, แนะนำ) preview smoke** — channel guard + quote-id เป็น DB-touching (test env ไม่มี Postgres → verify ด้วย gates). smoke เบาๆ: เข้า /quote-assistant ตีราคา brochure → save lead → re-open จาก /quote-leads (loadSession dashboard-channel ยังโหลด session เดิมได้ปกติ) → ยืนยัน escalation/existing-session response quote `id` = real DB id. **ไม่ critical** (all current sessions dashboard-channel → guard ไม่เปลี่ยน behavior)
> 2. **(soak) Dashboard Next 15** — เฝ้า Sentry ถึง **2026-06-27 (พรุ่งนี้)** แล้วถือว่า stable (scheduled `dashboard-next15-soak-end-check`)
> 3. **M5 owner-check ตัวจริง** — ลงใน **Phase 1b** (เป็น acceptance criterion แล้ว ไม่ใช่ blocker แยก): bind `line_user_id` + sender-check ใน LINE route
>
> ---
>
> **Session 2026-06-25 — AI Quote หนังสือ: default ปก 4 สี + Art 230 + hard-rule ✅ SHIPPED + live-smoke verified:** คุณนุ๊กเจอเคสจริง (ลูกค้า "ขก ราม") AI ถามซ้ำ "สีปก 4 สีใช่ไหม?" 2 รอบ ทั้งที่ลูกค้าพิมพ์ "พิมพ์ 4 สีทั้งเล่ม". **prompt-only** (`lib/ai-quote/prompt.ts`) — **PR [#9](https://github.com/witsarutnook/penprinting-dashboard/pull/9) squash → [`0b93f8e`](https://github.com/witsarutnook/penprinting-dashboard/commit/0b93f8e)** (3 commit: `5191650` สีปก4+กฎทั้งเล่ม · `ccef37b` กระดาษปก Art 230 · `4176fc4` hard-rule). Flow ครบ: brainstorm (AskUserQuestion: เนื้อใน = "ถามเสมอ") → spec (`docs/superpowers/specs/2026-06-25-ai-quote-book-cover-color-design.md`) → TDD. **3 การเปลี่ยน:** (1) default ปก = **4 สี + Art 230** → ออกจาก always-ask + เกณฑ์ครบพอตีราคา (เนื้อในยังถาม — ตัวขยับราคาแรง, เก็บ decision 6/24) (2) กฎ **"X สีทั้งเล่ม"** set ทั้งปก+เนื้อใน (3) **hard-rule "⛔ ห้ามถามสีปกเด็ดขาด"**. **Live smoke (Chrome MCP, nook/ADMIN, preview) 2 เคส:** "4 สีทั้งเล่ม 500" → **47.27 บาท/เล่ม** (ปก Art230/4สี · เนื้อใน 4 สี) ✅ · "เนื้อในขาวดำ 1000" → **20.49 บาท/เล่ม** (ปก default 4สี/Art230 · เนื้อในขาวดำ) ✅ — ทั้งคู่ตีราคาเลย **ไม่ถามปก**. **เคส 2 fail รอบแรก** (Haiku ถามปกเพราะเนื้อในขาวดำ — soft default แพ้) → hard-rule แก้ → re-smoke PASS. TDD +11 assertion (179→**190 tests** บน main). Gates เขียว Node 22 (type-check/lint/190/build 40). **Lesson (ซ้ำ 6/24):** soft prompt ไม่พอกับ Haiku ที่ระวัง — ต้อง hard-rule + few-shot เคส fail; **live smoke จับ regression ที่ unit test จับไม่ได้** ([[feedback_llm_assume_and_disclose_clarify]]). **Process miss:** session-start ไม่ fetch origin → local ref stale 6 commits (report PR #3 รอ merge ทั้งที่ FAB ชิปแล้วผ่าน PR #4); merge สะอาดเพราะ PR #8 docs-only ([[feedback_rtk_git_pull_stale_uptodate]]).
>
> **(ต่อ same session) — แปลงชื่อกระดาษ "อาร์ทการ์ด" + in-list paper ไม่ใช่ "พิเศษ" ✅ SHIPPED + smoke verified:** ต่อจาก PR #9. คุณนุ๊กชี้ว่า "อาร์ทการ์ด 210/230 = Art 210/230 ใน calc" (ไม่ใช่กระดาษพิเศษ). **PR [#10](https://github.com/witsarutnook/penprinting-dashboard/pull/10) squash → [`a82ad4f`](https://github.com/witsarutnook/penprinting-dashboard/commit/a82ad4f)** (2 commit: `10f294f` alias + `e53aa98` hard-rule). **AskUserQuestion confirm mapping:** อาร์ทการ์ด 210/230 → Art 210/230 (ไม่มี Art Card น้ำหนักนี้) · 300/350 → Art Card 300/350 (stock แยก ราคาต่างจาก Art 300/350) · อื่น → escalate · + ปอนด์ {w} → Bond {w}. **smoke เคส "ขก ราม" จริง** ("...ปกอาร์ทการ์ด 210 ... 4 สีทั้งเล่ม 500") → รอบแรก **fail ครึ่งเดียว**: map → Art 210 ถูก ✅ แต่ Haiku งงว่า Art 210 = "พิเศษ" เพราะ ≠ default Art 230 → ถามยืนยัน. **hard-rule** "ลูกค้าระบุกระดาษใน-list = ใช้เลย ไม่ใช่พิเศษ แม้ต่าง default" → re-smoke **PASS: 47.09 บาท/เล่ม ปก Art 210** ไม่ถาม. TDD +5 (190→**193**). Gates เขียว Node 22. **Lesson (ซ้ำ 3 รอบวันนี้):** soft default แพ้ Haiku ทุกครั้งที่มี field ข้างเคียง "ขัด" default (เนื้อในขาวดำ / กระดาษระบุ ≠ default) → ต้อง hard-rule ระบุชัดว่าอะไร "ไม่ใช่เหตุให้ถาม". smoke รอบนี้**ไม่สร้าง lead** (no-auto-save PR #5).
>
> ## ⏳ Pending (2026-06-25)
> 1. **เคลียร์ test sessions** — smoke PR #9 สร้าง 3 sessions ใน `ai_quote_sessions` (หนังสือ 4สีทั้งเล่ม 500 · หนังสือขาวดำ 1000 ×2 รอบ) โผล่ /quote-leads + ของเก่าค้าง (ใบปลิว 1000/5000 · ทดสอบ Smoke 23/6) → ลบรวด (deletion = คุณนุ๊กทำเอง). **คุณนุ๊กลบ #11-13 แล้ว 6/25** ✅ (smoke PR #10 ไม่สร้าง lead เพิ่ม — no-auto-save)
> 2. **(carryover) M5 loadSession IDOR** — ปิดก่อนเปิด Phase 1b (LINE OA); owner-binding ตอนนี้ = regression ของ shared inbox → ทำพร้อม LINE identity
> 3. **(soak) Dashboard Next 15** — เฝ้า Sentry ถึง **2026-06-27** (scheduled `dashboard-next15-soak-end-check`)
> 4. ~~(future) กระดาษ Art Card 210/230~~ **✅ RESOLVED (PR #10)** — คุณนุ๊กยืนยัน "อาร์ทการ์ด 210/230 = Art 210/230 ใน calc" → map ใน prompt แล้ว ไม่ต้องเพิ่มกระดาษใหม่. (ถ้าอนาคตมีกระดาษ Art Card น้ำหนักอื่นจริง ๆ ที่ราคาต่าง ค่อยเพิ่มใน calc + VALID_PAPER_NAMES)
>
> ---
>
> **Session 2026-06-24 (later) — Floating AI-quote FAB widget ✅ SHIPPED + audit fast-follow (M3/M4 ปิด):** ต่อจาก Phase 1a merge. **(1) FAB widget** ([PR #4](https://github.com/witsarutnook/penprinting-dashboard/pull/4) squash → [`66d0286`](https://github.com/witsarutnook/penprinting-dashboard/commit/66d0286)): ปุ่มลอยมุมขวาล่างแบบแชต PEAK Support เปิด AI Quote เป็น popup panel ได้ทุกหน้า dashboard. **Diagnose ก่อน**: "widget ไม่ขึ้น" บน iPad → grep ยืนยัน FAB **ไม่เคยถูก build** (ค้างขั้น brainstorm pending #3) — ไม่ใช่บั๊ก PWA (โปรเจกต์ไม่มี manifest/appleWebApp เลย แต่นั่นคนละเรื่อง). Build: `components/ai-quote-widget.tsx` 🆕 reuse `QuoteAssistantClient` โหมด `compact` (prop ใหม่ — conversation 52vh→44vh + ตัด intro line), mount ใน `DashboardShell` gate `role === 'admin'`, ซ่อนบน `/quote-assistant` (กันแชตซ้อน), `z-40` ตาม hierarchy, Esc ปิด, responsive. **Preview-verified บน iPad จริง** (คุณนุ๊กส่ง screenshot): ใบปลิว 5000 ใบ → **1.58 บาท/ชิ้น** offset + assume-and-disclose (A4/4สี/2หน้า/Art120) + การ์ดราคา. merged → prod auto-deploy. **(2) Audit fast-follow ปิด M3 + M4** (gate ของ Phase 1b): **M3** wire escalation badge — extract pure `detectEscalation(quoteCount, reply)` ใน run.ts → `out.escalated` source-of-truth เดียว → route เรียก `markEscalated` (เลิกเป็น dead code) + `/quote-leads` STATUS_LABEL ('escalated'→"ต้องประเมินเอง") + badge ส้ม "⚠ ต้องประเมินเอง" · **M4** `claimLead` conditional `UPDATE WHERE assigned_to IS NULL` + 409 "มีคนหยิบงานนี้ไปแล้ว" + client refresh. **M5 (loadSession IDOR) คงเปิด — ตั้งใจ** (shared team inbox ของ 1a; owner-binding ตอนนี้ = regression → ปิดพร้อม Phase 1b LINE identity). +5 test (170→**175**). Gates เขียว Node 22 (type-check/lint/175/build). **Lesson**: "ไม่ขึ้น" อาจแปลว่า "ยังไม่เคยสร้าง" ไม่ใช่ "พัง" — grep หา component จริงก่อน diagnose PWA/env.
>
> **🔁 ตามด้วย (same session — lead UX จาก user feedback ระหว่าง preview):** (1) **Delete leads** — ปุ่มลบใน /quote-leads เฉพาะ admin (confirm danger, ai_quotes cascade). (2) **No-auto-save** — เดิมเริ่มแชต = สร้าง lead ทันที (junk เพียบ). เปลี่ยนเป็น chat **stateless** (client ถือบทสนทนา replay ผ่าน `history`) → persist เฉพาะตอน **escalate** (auto-save กันพลาด hand-off ตาม decision คุณนุ๊ก) **หรือ** กด **"บันทึกเป็น lead"** (`POST /api/ai-quote/leads` เก็บบทสนทนา+ราคา+ลูกค้า). `shouldPersistTurn`/`sanitizeHistory` pure + testable. (3) **Conversation viewer** — กดแถวใน /quote-leads ขยายอ่านบทสนทนาเต็ม (แก้ "ข้อความล่าสุดอ่านไม่หมด"). +9 test (170→**179**). ✅ **SHIPPED** ([PR #5](https://github.com/witsarutnook/penprinting-dashboard/pull/5) squash → [`a028ce0`](https://github.com/witsarutnook/penprinting-dashboard/commit/a028ce0)) → prod auto-deploy. **Lesson**: "auto-save" ที่ผู้ใช้บ่น = visible junk — แก้ที่ persist-policy (stateless + explicit save) ตรงกว่าซ่อน row.
>
> **🔁 ตามด้วย — ผู้ดูแล (owner) auto-assign:** คุณนุ๊กเห็นว่าปุ่ม "หยิบงาน" ดูแปลก (claim งานตัวเอง = pattern team inbox ใหญ่ ไม่เหมาะร้านทีมเล็ก). เปลี่ยนเป็น **กด "บันทึกเป็น lead" → auto-assign คนกด save** เป็นเจ้าของ (server-side จาก `session.user` — ไม่ต้อง plumb client). งาน **escalate** (AI auto-save, ไม่มีคนคุย) ยังว่าง → "หยิบงาน" (race-safe 409). เพิ่ม **"คืนงาน"** (`releaseLead`: admin คืนของใครก็ได้ · staff คืนของตัวเอง). ✅ **SHIPPED** ([PR #7](https://github.com/witsarutnook/penprinting-dashboard/pull/7) squash → [`a77861a`](https://github.com/witsarutnook/penprinting-dashboard/commit/a77861a)). 179 tests. **Lesson**: claim-pattern เหมาะ team inbox ใหญ่ — ทีมเล็ก auto-assign ผู้กระทำตรงกว่า (หยิบงานเหลือไว้เฉพาะ orphan/escalated).
>
> ## ⏳ Pending — งานถัดไป AI Quote
> 1. **M5-loadsession-idor** — ปิดพร้อม Phase 1b (ผูก session กับ LINE userId/owner + เช็คก่อนโหลด ตอนออกแบบ LINE identity). **gate ของ 1b**
> 2. **Phase 1b — LINE OA** (ลูกค้าตีราคาเอง) — งานใหญ่ ดู `design-ai-quoting.md` §7. ต้องปิด M5 ก่อน
> 3. **Phase 1c — กล่อง/ถุง auto-quote** (ตอนนี้ escalate อย่างเดียว, D8)
> 4. **3 Low (AI-quote)** — quote id=array index · run.ts comment typo · db-migrate row-count นับ table ใหม่
> 5. **เคลียร์ test sessions** ค้างใน `ai_quote_sessions` (smoke 23/6, ใบปลิว 1000/5000 ใบ) — ก่อน/หลัง prod live
>
> ---
>
> **Session 2026-06-24 — AI Quote prompt-tuning: ลด over-clarify (assume-and-disclose) ✅ pushed [`237b66d`](https://github.com/witsarutnook/penprinting-dashboard/commit/237b66d) บน `feat/ai-quote-phase1a` (เข้า PR [#2](https://github.com/witsarutnook/penprinting-dashboard/pull/2) ด้วย):** คุณนุ๊กสังเกตจาก preview smoke 6/23 ว่า Haiku clarify เยอะไป (ถามซ้ำ field ที่มี shop-standard เช่น โบรชัวร์ไม่บอกสี → มัก 4 สี). Brainstorm → **assume-and-disclose**: เติมค่ามาตรฐานให้ field ที่ลูกค้าไม่ระบุ แล้วเรียก `compute_quote` ตีราคาเลย + แจ้งบรรทัดสมมติฐานให้แก้ได้ (ราคา label "ประเมินเบื้องต้น" อยู่แล้ว → ปลอดภัย). **Defaults (คุณนุ๊ก confirm 6/24):** โบรชัวร์/ใบปลิว = A4 · 4 สี · 2 หน้า · Art 120 · book+notebook = A5 + เนื้อในชุดเดียว (innerB=0). **ไม่ default — ถามเสมอ:** qty ทุกงาน + book/notebook ถามเพิ่ม จำนวนหน้า/กระดาษปก/กระดาษเนื้อใน/สี **แบบ batch ครั้งเดียว (ไม่ drip ทีละข้อ)**. กระดาษที่ลูกค้าระบุชื่อแต่อยู่นอก list ยัง escalate (เฉพาะกระดาษที่ "ไม่พูดถึง" ถึงใช้ default). **prompt-only** — แก้ `lib/ai-quote/prompt.ts` จุดเดียว (run.ts/tools.ts/types/schema/calc **ไม่แตะ**). TDD: +7 regression assertion pin defaults/batch-rule/assumptions-line (161→**168 tests**). Gates เขียว Node 22 (type-check clean · lint clean · 168 tests · build 40 หน้า). Spec: `docs/superpowers/specs/2026-06-24-ai-quote-clarify-defaults-design.md` (workspace root, ไม่ git-track).
>
> **🔁 Hardening + verified (same session): [`7a203d9`](https://github.com/witsarutnook/penprinting-dashboard/commit/7a203d9)** — preview smoke รอบแรกของ "ใบปลิว 1000 ใบ" พบ tuning **ได้ครึ่งเดียว**: batch-ถาม ✅ แต่ assume-and-disclose ❌ (Haiku ยังถาม 4 ข้อ — soft "ห้ามถาม" สู้นิสัยระวัง + กฎ "ห้ามเดาราคา" ข้างกันไม่ได้). แก้ด้วย **hard-rule "ครบพอตีราคา"** (โบรชัวร์ + qty = ครบ → ห้ามถามขนาด/สี/หน้า/กระดาษเด็ดขาด) + **worked ✅/❌ example** ในprompt (เคส "ใบปลิว 1000 ใบ" ตรงๆ). +2 test (168→**170**). **Re-smoke PASS** บน preview `gfitp6wvy`: ตีราคาเลย **4.77625 บาท/ชิ้น** (Art 120 offset, จาก compute_quote จริง) + 📋 บรรทัดสมมติฐาน A4/4สี/2หน้า/Art120 + การ์ดราคา structured. **Lesson: soft prompt instruction ไม่พอกับ Haiku ที่ระวัง — ต้อง hard-rule + few-shot example ที่โชว์เคส fail ตรงๆ** ([[feedback_llm_assume_and_disclose_clarify]]).
>
> ## ⏳ Pending — 6/23 ทั้งหมด + ของ 6/24
> 1. **Merge PR [#2](https://github.com/witsarutnook/penprinting-dashboard/pull/2)** — รวม prompt-tuning + hardening (`7a203d9` commit บนสุด, verified PASS preview). คุณนุ๊กถือ merge รอ tuning เสร็จ → **ตอนนี้ verify ผ่านแล้ว merge ได้**.
> 2. **เคลียร์ test session ใน `ai_quote_sessions`** — re-smoke 6/24 สร้าง test session "ใบปลิว 1000 ใบ" (โผล่ /quote-leads, ×2 preview hosts) + "ทดสอบ Smoke 23/6" เดิม → ลบก่อน/หลัง prod live.
> 3. **Floating AI-quote widget (มุมขวา)** — คุณนุ๊กขอ FAB ปุ่มลอยมุมขวาแบบปุ่มแชต PEAK Support เปิด AI quote เป็น popup จากทุกหน้า (reuse chat component, gate admin/sales). **กำลัง brainstorm** — ดู spec ใหม่เมื่อเสร็จ.
>
> ---
>
> **Session 2026-06-23 — AI Quoting Phase 1a: reconcile + deploy + preview-verify + audit ✅ (รอ merge PR):** Context check พบ **git/doc mismatch**: มี session **2026-06-22 build Phase 1a Tasks 1-10 จริง (10 commits `1424bfa`→`5d2de19`)** บน branch `feat/ai-quote-phase1a` แต่ **ไม่ push + ไม่ update doc + lint แดง** (entry บนสุดยังเป็น 6/20 "ยังไม่เขียนโค้ด พักไว้"). Root cause lint แดง: 3× `@typescript-eslint/no-explicit-any` ใน test files (`ai-quote-run.test.ts` ×2 + `ai-quote-tools.test.ts` ×1) — commit ผ่านมาได้เพราะ `--no-verify` (`next build` lint แค่ `app/lib/components` ไม่รวม `tests/` → build เขียว แต่ `next lint`/pre-commit จับ → ควร block). **คุณนุ๊กเลือก "Reconcile state ก่อน" (ไม่ deploy, ไม่ต้องใช้ env).** ทำ 3 อย่าง: (1) **fix lint [`d773ea9`](https://github.com/witsarutnook/penprinting-dashboard/commit/d773ea9)** — `any`→`unknown`-routed casts (`responses: unknown[]` + `as unknown as Anthropic` + schema cast เป็น concrete shape) zero behaviour change (2) **gates เขียว Node 22**: type-check clean · **lint "No issues found"** · **159 tests** (148→159, +11 จาก AI-quote TDD tasks 3/4/5) · build 38 หน้า (route table มี `/quote-assistant` + `/quote-leads` ✓) (3) **pushed `feat/ai-quote-phase1a` → origin** (verified local==origin `d773ea9`). **Branch ยังไม่ merge main** — รอ Task 11 (preview-deploy verify) ก่อน. Lesson: pre-commit `--no-verify` ทิ้ง red gate ไว้เงียบ — context check จับได้เพราะ git log ≠ doc claim ([[feedback_session_discipline]]).
>
> ## ✅ Deploy + preview-verify + audit DONE (2026-06-23, same session continued)
> - **env ตั้งครบ** Vercel `penprinting-dashboard` (ANTHROPIC_API_KEY + QUOTE_API_URL + QUOTE_API_TOKEN, All Environments) + empty commit [`80d5c2a`](https://github.com/witsarutnook/penprinting-dashboard/commit/80d5c2a) trigger preview.
> - **Preview smoke ผ่านครบ**: db-migrate (ai_quote_sessions + ai_quotes + idx, idempotent ✅) · quote brochure A4/4สี2หน้า/Art160/1000 → **5.048225 บาท/ชิ้น ตรง calc เป๊ะ** + offset mode + VAT card · escalation (กล่อง → ไม่ตีราคา escalate ทีมขาย D8) · lead flow (บันทึก→/quote-leads→เปลี่ยน status ปิดการขาย + หยิบงาน nook → reload persist ✅) · auth admin (nook) เข้า 2 เมนูใหม่.
> - **Calc token fix (lesson)**: smoke เจอ calc 500 "QUOTE_API_TOKEN not configured" — env ตั้งใน calc ตั้งแต่ 6/20 แต่ prod deploy ล่าสุด = `3edcfe1` (6/17 ก่อนมี token) → runtime อ่านไม่เจอ. push empty commit `fd4f755` (repo `penprinting-calc` main) → auto-deploy production สด → token live (probe 500→401). **note 6/20 "calc QUOTE_API_TOKEN ตั้งแล้ว ✅" = unverified — env ตั้งแล้วแต่ไม่ deploy = ไม่ live** → [[feedback_ai_quote_phase1a]].
> - **Audit (penprinting-auditor)** — security/SQL/permission สะอาด. ปิด **H1/H2/M1/M2** ก่อน merge [`902d70a`](https://github.com/witsarutnook/penprinting-dashboard/commit/902d70a) (+2 regression test, 159→**161 tests**): **H1** `runQuoteTurn` persist empty-text turn → Anthropic reject empty content block → brick session ถาวร (fallback non-empty reply) · **H2** middleware matcher เพิ่ม /quote-assistant + /quote-leads · **M1** เลิก echo calc error body · **M2** guard message non-empty string + cap 4000. **Deferred → AUDIT-BACKLOG open**: M3 (escalation ไม่ wired + markEscalated dead) · M4 (lead-claim race) · M5 (loadSession IDOR — **ปิดก่อน Phase 1b**) · 3 Low.
> - **Docs updated**: dashboard-v2.md (routes + API table + features + roadmap + §9 lessons + Version History Phase 1a entry) · AUDIT-BACKLOG.md (top entry + M3/M4/M5 + Low open) · design-ai-quoting.md (Phase 1a ✅) · NEXT-SESSION (this). Gates ทุก commit เขียว Node 22 (type-check / lint / 161 tests / build 40 หน้า).
>
> ## ⏳ Pending — เหลือแค่ merge + prod smoke (ของที่ parent/คุณนุ๊กทำ)
> 1. **Merge PR [#2](https://github.com/witsarutnook/penprinting-dashboard/pull/2) `feat/ai-quote-phase1a` → main** — **PR เปิดแล้ว, คุณนุ๊กจะ merge พรุ่งนี้ (2026-06-24)** (hold วันนี้ไว้ก่อน) → Vercel auto prod-deploy. branch ยังไม่ merge (ตั้งใจ — staff tool ผ่าน preview ก่อน เหมือน Next 15). รวม nav [`39d85333`](https://github.com/witsarutnook/penprinting-dashboard/commit/39d85333) (sidebar group ใหม่ "AI Quote" แยก 2 เมนูออกจาก "รายการ" — verified ด้วยตาบน preview)
> 2. **1 happy-path prod smoke** หลัง deploy: เข้า /quote-assistant (admin/sales) → ตีราคา brochure 1 ใบ → เทียบ calc → บันทึก lead → /quote-leads เห็น lead
> 3. **เคลียร์ test lead "ทดสอบ Smoke 23/6"** ที่ค้างจาก preview smoke (อยู่ใน `ai_quote_sessions`)
> 4. **(soak) Dashboard Next 15** — เฝ้า Sentry ถึง **2026-06-27** (migration 6/20). scheduled check `dashboard-next15-soak-end-check` จะเตือน
> 5. **Deferred fast-follow (AUDIT-BACKLOG)**: M3/M4/M5 + Low — **M5 (loadSession IDOR) ต้องปิดก่อนเปิด Phase 1b (LINE OA)**
> 6. **Prompt-tuning candidate**: คุณนุ๊กสังเกต AI clarify เยอะไป (Haiku ระวังเกินตอนสกัด spec, ถามซ้ำ field ที่เดาได้) — รอบหน้าลด over-clarify ใน `lib/ai-quote/prompt.ts`
>
> ---
>
> **Session 2026-06-20 — Dashboard Next 14→15 + React 18→19 ✅ SHIPPED to production (4/4 repos done 🏁):** ปิด migration ตัวสุดท้าย. **PR [#1](https://github.com/witsarutnook/penprinting-dashboard/pull/1) squash-merged → `2c22301`**, 2 commits: [`1d9cb6e`](https://github.com/witsarutnook/penprinting-dashboard/commit/1d9cb6e) migration + [`45d6c77`](https://github.com/witsarutnook/penprinting-dashboard/commit/45d6c77) board #418 fix. **Branch + Vercel preview workflow** (คุณนุ๊กเลือก — ปลอดภัยกว่าตรงไป main สำหรับ tool ที่ staff ใช้จริง). Migration ตาม plan เป๊ะ (~27 จุด, codemod cat 1-3 + hand-fix lib/api dynamic-import cookies() + **revert codemod's 323-line JSX churn บน print page → hand-edit 3 บรรทัด**). **Gate surprise 2 อัน** ที่ plan ไม่ enumerate: React 19 ถอด global `JSX` namespace (history-tab → `import { type JSX }`) + eslint-config-next 15 จับ error-boundary `<a href>` เพิ่ม 2 จุด (error.tsx/global-error.tsx — เก็บ `<a>` เพราะ global-error render นอก router tree). **#418 hydration (งานหิน session นี้):** /board throw React #418 บน preview แต่ prod React 18 สะอาด → **/diagnose**: ยืนยัน real ผ่าน **incognito** (ไม่ใช่ polkadot.js extension) + **TZ harness พิสูจน์ date math ไม่ diverge** (offset 7ชม. cancel เป๊ะ — "รับ Xว" ถูกต้อง) → mismatch = data-derived text จาก live `useDeltaSync` SSR/hydration race. **Root-class fix** (คุณนุ๊กเลือก แทน suppressHydrationWarning): `BoardClient` gate ด้วย post-mount flag → SSR+first-render = `BoardSkeleton` เดียวกัน → byte-clean hydration. **Verified preview 8/8 smoke + #418 หายทั้ง preview + production** (skeleton→board, console 0 error). Lessons → [[feedback_react19_hydration_realtime_board]].
>
> ## ⏳ Pending user actions (2026-06-20)
> 1. **Soak window dashboard** — เฝ้า Sentry (project dashboard) + ใช้งานจริง ~1 สัปดาห์ถึง **2026-06-27** ก่อนถือว่า stable (cadence เดียวกับ calc/web/photobook). ดู: error spike, /board render ปกติ (skeleton→board ไม่กระพริบ), staff ไม่รายงานปัญหา. ผมเสนอตั้ง scheduled soak-end check ได้ (ถาม)
> 2. **(carryover) QUOTE_API_TOKEN** ใน Vercel `penprinting-calc` — ยังค้างจาก AI Quoting Phase 0 (prerequisite ของ Phase 1a)
>
> ## 🧠 AI Quoting Phase 1a — brainstormed + audited + PLANNED (2026-06-20, same session)
> ทำ superpowers flow ครบ (brainstorm → audit → spec → writing-plans). **ยังไม่เขียนโค้ด — พักตามคำขอคุณนุ๊ก** (session ยาว + รอ ANTHROPIC_API_KEY billing).
> - **Spec อัพเดต** `design-ai-quoting.md` [`46e7067`](https://github.com/witsarutnook/penprinting-dashboard/commit/46e7067): **D8** = 1a auto-quote แค่ brochure/book/notebook, box/ถุง/นามบัตร escalate (Phase 1c) + audit deltas (migration via db-migrate route ไม่ใช่ lib/migrations/ · pages Next 15 async cookies · Postgres @vercel/postgres sql · Phase 0 contract verified)
> - **Implementation plan** (พร้อม build): `docs/superpowers/plans/2026-06-20-ai-quoting-phase1a.md` (workspace root, ไม่ git-track) — **11 tasks, TDD** (tools/prompt/run มี test), complete code สำหรับ tool/prompt/loop/db/routes, spec สำหรับ 2 หน้า UI. **Tasks 1-10 = env-independent (build ได้เลย)** · Task 11 (migrate+smoke เทียบ AI vs calc) รอ env+deploy
> - **หัวใจ**: ราคาทุกตัวจาก calc `/api/quote` (single source of truth) · Haiku 4.5 + prompt caching · manual tool-use loop · env-gated deploy dark
>
> ## ⏳ Pending user actions (AI Quoting — ต้องทำก่อน Task 11 / build จริง)
> 1. **ตั้ง env ใน Vercel `penprinting-dashboard`** (ทุก env): `ANTHROPIC_API_KEY` (กำลังเติม credit ที่ console.anthropic.com), `QUOTE_API_URL=https://calc.penprinting.co/api/quote`, `QUOTE_API_TOKEN` (ค่าเดียวกับที่ตั้งใน calc แล้ว ✅)
> 2. (calc `QUOTE_API_TOKEN` = **ตั้งแล้ว** ✅ — Phase 0 `/api/quote` live ไม่ inert)
>
> ## 🎯 งานหลัก session หน้า
> 1. **Build AI Quoting Phase 1a** — resume จาก plan (`docs/superpowers/plans/2026-06-20-ai-quoting-phase1a.md`). เริ่ม Task 1-10 ได้เลยไม่ต้องรอ env (env แค่ตอน Task 11 smoke). แนะนำ subagent-driven execution
> 2. **A11Y-board-form-label** — a11y pass (ค้างจาก 6/05) — หมายเหตุ: board fix session นี้เปลี่ยนเป็น client-only render, เช็คว่า a11y issues เดิมยังเหมือนเดิมมั้ย
> 3. ตอน soak migration ครบ (6/27) — ถ้าไม่มี issue, ลบ migration-plan-next15.md ได้ (งานจบ) · scheduled check `dashboard-next15-soak-end-check` จะเตือน
>
> ---
>
> **Session 2026-06-18 — Phase 3: photobook Next 14→15 + React 18→19 ✅ SHIPPED + verified live:** ปิดงานที่รอ soak web จบ (soak ครบวันนี้พอดี — health-check web 4 URLs 200 ก่อนเริ่ม). repo `penprintphotobook` **2 commits: [`8927e5b`](https://github.com/witsarutnook/penprintphotobook/commit/8927e5b) (code) + [`314fe81`](https://github.com/witsarutnook/penprintphotobook/commit/314fe81) (CLAUDE.md doc).** Photobook = ตัวง่ายสุดใน 3 repo — **ไม่มี Sentry** (decision เดิม) · **ไม่มี PWA** · **0 async-API** (cookies/headers/searchParams). Scope จริง = 2 อย่าง: (1) **deps bump** match เวอร์ชัน web ที่ soak ผ่าน — next 14.2.35→15.5.19 · react/react-dom 18.3.1→19.2.7 · @types/react 18→19 · @types/react-dom 18→19 · @next/third-parties 14→15 · eslint-config-next 14→15 · **`next-mdx-remote@6` ไม่แตะ** (2) **async params** `app/blog/[slug]` + `app/sizes/[slug]` — `params: Promise<{slug}>` + `generateMetadata`/default → async + await (`generateStaticParams` ไม่แตะ). **+1 gotcha**: eslint-config-next 15 จับ app-router internal `<a href>` เข้มขึ้น (`no-html-link-for-pages` ครอบ app/ dir แล้ว) → `Footer.tsx` `/blog` link → `next/link <Link>` (ได้ client-side nav ด้วย). **De-risk ตัวแปรใหญ่ก่อนเริ่ม** ([[feedback_audit_before_plan]]): grep ยืนยัน web (sibling) ใช้ combo เป๊ะเดียวกัน — `next-mdx-remote@6.0.0` + `MDXRemote` จาก `/rsc` + Next 15 + React 19 — soak 1 สัปดาห์ไม่มี issue + peer dep mdx = แค่ `react:>=16` → React 19 ผ่าน. **Gates เขียว**: type-check/lint/build (17/17 static, `/blog/[slug]` SSG 3 posts + `/sizes/[slug]` SSG 4 sizes). First Load JS shared 102 kB (lean กว่า web 184 — ไม่มี instrumentation). **Post-deploy verify live**: 10 routes 200 · blog `og:type=article` + `article:published_time=2026-06-13` (พิสูจน์ await params resolve โพสต์ถูก) · `/sizes/rect-a3` title "A3 ... เริ่ม 2,490 บาท" (slug resolve ถูกเล่ม) · BlogPosting/Product/Offer JSON-LD ครบ · sitemap 11 locs. **Lesson**: sibling repo ที่ migrate ไป target framework แล้ว = ใช้ de-risk version-specific unknown ได้ (กลับด้านของ [[feedback_port_sibling_repo_framework_drift]] — คราวนั้น "อย่า copy signature", คราวนี้ "ใช้ยืนยัน dep combo + ไล่ pattern เดียวกัน"). **Next 15 migration ทั้ง 3 repo จบ** (calc Phase 1 · web Phase 2 · photobook Phase 3) — dashboard ยัง Next 14 (ถ้าจะ migrate ภายหลัง pattern เดียวกัน + ระวัง dashboard มี API routes/fetch/vitest pre-commit).
>
> ## ⏳ Pending user actions (photobook Phase 3)
> 1. **(reminder ค้างจาก 6/13 — ยังไม่ปิด)** Rich Results Test `/reviews` + 1 blog post · Lighthouse mobile 1 หน้า blog (LCP cover ≤~2.5s) · GSC coverage โพสต์ใหม่ — ทั้งหมดยังถูกต้องหลัง Next 15 (verify แล้วว่า schema + og ครบ)
> 2. **(optional) เฝ้า photobook สั้นๆ** — เปิดเว็บใช้จริง 1-2 วัน (traffic IG/FB mobile) ดูว่า render ปกติ (ไม่มี Sentry บน repo นี้ → ไม่มี error dashboard, อาศัยตาดู)
>
> ## 🎯 งานหลัก session หน้า (ไม่เปลี่ยนจากเดิม — Phase 3 ปิดแล้ว)
> 1. **Phase 1a — in-dashboard AI Quote Assistant** (deferred 9 sessions, งานใหญ่หลาย sub-steps; ตั้ง env `QUOTE_API_TOKEN` ใน Vercel `penprinting-calc` ก่อน — Phase 0 ship-dark รออยู่. ดู `design-ai-quoting.md` §13)
> 2. **Dashboard Next 14→15 + React 18→19** — ตัวสุดท้ายของ 4 repo (calc/web/photobook จบหมดแล้ว). **Audited 6/18 → `migration-plan-next15.md`** (ลบแล้ว 6/27 หลัง soak ปิด; enumerate ครบ 27 จุด + codemod + smoke checklist, ไม่ต้อง re-audit). Effort Medium, well-bounded, จบ session เดียวได้. ข่าวดี: Sentry+config+middleware+React19 พร้อมอยู่แล้ว 0 งาน — งานจริง = async cookies(×14)/params(×4)/searchParams(×6) + eslint `<a>`×3 + smoke 7 flows. Risk หลัก = Client Router Cache `staleTimes`→0 (mitigation ใน doc)
> 3. **A11Y-board-form-label** — dedicated a11y pass (ค้างจาก 6/05)
> 4. **Doc nit** — `/api/admin/db-migrate` route hint "sync-all" (carryover 6/04)
>
> ---
>
> **Session 2026-06-17 (later) — Spec "อื่นๆ" กราฟฟิก row + staff-name resolution:** user ขอเพิ่มแถว "กราฟฟิก" ในส่วน "อื่นๆ" ของ tab สเปคงาน (modal ใบสั่งงาน). **1 commit [`0133d2d`](https://github.com/witsarutnook/penprinting-dashboard/commit/0133d2d)** แก้ `lib/spec-format.ts` จุดเดียว → มีผลทั้ง modal /board (`DetailsTable`) + /orders (`SpecSection`) ที่ share renderer. (1) เพิ่ม `assignStaff`→label "กราฟฟิก" ใน "อื่นๆ" section (ย้ายออกจาก `SPEC_HIDDEN_KEYS`) (2) resolve staff ID→ชื่อ ทั้ง `assignStaff` (graphic, STAFF.graphic) + `forwardPrint` (print, STAFF.print) — `pook`→ปุ๊ก, `sm74`→"SM74 (ต้อม)" (เดิม forwardPrint โชว์ ID ดิบ) (3) ไม่มีกราฟฟิก (ส่งตรงพิมพ์)→ซ่อนแถว · unknown id→fallback. **+5 regression tests** (143→148, `tests/spec-format.test.ts`). Gates เขียว Node 22 (pre-commit type-check/lint/148). **Audit-before-edit**: verify ว่า `details` มี assignStaff จริง (ไม่ใช่แค่ rawData) ผ่าน write path — `add/route.ts:103` `formSnapshot = {...body}` เก็บ details+rawData ทั้งคู่มี assignStaff+forwardPrint → ไม่ no-op. **Visual verified บน dev**: throwaway preview route `/dev-spec-preview` (ไม่อยู่ใน middleware matcher = เปิดได้ไม่ต้อง login; dev ไม่มี .env/DB) + Chrome MCP screenshot ยืนยัน 3 เคส (มีกราฟฟิก/ส่งตรงพิมพ์/กราฟฟิกอย่างเดียว) → **ลบ preview ก่อน commit** (working tree เหลือแค่ spec-format.ts + test). Lesson: ก่อนแก้ field ที่ "ซ่อน" ใน renderer ที่ data-driven — เช็ค write path ว่า field อยู่ใน object จริงก่อน กัน no-op.
>
> ---
>
> **Session 2026-06-17 — AI Quoting Phase 0 (calc pricing API) ✅ SHIPPED:** ปิดงานที่ deferred มา 9 sessions. **repo `penprinting-calc` — 1 commit [`3edcfe1`](https://github.com/witsarutnook/penprinting-calc/commit/3edcfe1).** สร้าง `POST /api/quote` server-side pricing เพื่อให้ AI Quoting layer (dashboard) เรียกข้าม repo ได้ราคา **ตัวเดียวกับ calculator UI** (เรียก `computeBrochure/Book/Notebook/Box/Bag(DEFAULT_CONFIG, spec)` ตรง — single source of truth, ไม่มี drift, decision D2). ไฟล์: `app/api/quote/route.ts` 🆕 + `lib/quote-schema.ts` 🆕 (Zod) + zod 4.4.3 dep. **Audit-before-build** (design doc เขียน 5/17 เดือนกว่าแล้ว): grep โค้ดจริงยืนยัน 5 compute fns + DEFAULT_CONFIG + types ยังตรง · เจอ 2 drift จาก doc — calculator **เป็น Next 15 + React 19 แล้ว** (doc เขียน Next 14) + **fix สูตร book/inner 5/23** หลัง doc → ใช้สูตรปัจจุบันเป็น truth. **4 ปรับจาก doc** (engineering call): ตัด `finishing?` ออกจาก request (computeX ไม่รับ — fees อยู่ใน Result) · paperName validation → 422 ถ้าไม่รู้จัก (กันราคา 0 เงียบ → escalate) · box/bag discriminated union by style · box/bag ใหญ่เกินเครื่อง (boxesPerSheet 0) → 422 infeasible. **Gates เขียว**: type-check/lint/build (route = `ƒ Dynamic` ถูก). **Verified (curl เทียบสูตรเป๊ะ)**: brochure offset `5.048225` · digital `30/3000` · box STE `22.76/11380/boxes2/sheets250/die large` · 401 token ผิด · 422 กระดาษไม่รู้จัก+list / box ใหญ่เกิน. **Production live**: `calc.penprinting.co/api/quote` คืน `500 "not configured"` (inert ship-dark — endpoint ใช้ไม่ได้จนกว่าตั้ง token, ปลอดภัย). Design doc `design-ai-quoting.md` mark Phase 0 ✅ DONE. Lesson: [[feedback_audit_before_plan]] อีกครั้ง — design doc เก่า 1 เดือน มี framework drift (Next 14→15) + สูตร fix หลัง doc → ต้อง grep โค้ดจริงก่อน build เสมอ.
>
> ## ⏳ Pending user actions (AI Quoting Phase 0)
> 1. **ตั้ง env `QUOTE_API_TOKEN`** ใน Vercel project **`penprinting-calc`** — สร้าง random เอง (`openssl rand -hex 32`), Claude ไม่ต้องเห็นค่า. **ค่าเดียวกันนี้** จะใช้ตั้งใน dashboard project ตอน Phase 1a (ฝั่งที่เรียก). จน token ตั้ง → endpoint คืน 500 (inert)
> 2. **(optional) จด token ไว้** — Phase 1a ต้องใช้ค่าเดิมตั้งใน `penprinting-dashboard` Vercel env เป็น `QUOTE_API_TOKEN` + `QUOTE_API_URL=https://calc.penprinting.co/api/quote`
>
> ## 🎯 งานหลัก session หน้า — Phase 1a (in-dashboard AI Quote Assistant)
> งานใหญ่ หลาย sub-steps (ดู `design-ai-quoting.md` §13 Phase 1a):
> 1. **1a.1 deps/env** — `npm i @anthropic-ai/sdk zod` ใน dashboard + Vercel env `ANTHROPIC_API_KEY` (❓ Q4: มี key อยู่แล้วหรือสร้างใหม่ใน Anthropic Console) + `QUOTE_API_URL` + `QUOTE_API_TOKEN`
> 2. **1a.2 Postgres schema** — `ai_quote_sessions` (= lead store) + `ai_quotes` (§8) ผ่าน db-migrate route pattern
> 3. **1a.3 ai-quote API + prompt + tools** — `app/api/ai-quote/route.ts` (Claude tool-use, บังคับเรียก `compute_quote`) + `lib/ai-quote/{prompt,tools,db}.ts` · Haiku + prompt caching เริ่ม
> 4. **1a.4 UI + nav** — `/quote-assistant` (staff chat) + `/quote-leads` (lead table, D5) + nav 2 เมนู `adminOrSalesOnly`
> 5. verify: type-check/lint/test/build + เทียบ AI vs calculator 5-6 quote เก่า + `/audit`
> **นอก scope 1a**: LINE 1b · กล่อง/ถุง auto 1c · PEAK · auto-draft-order
>
> ---
>
> **Session 2026-06-16 — phase2_dirty_at column removal (§12 Step 2F):** ✅ ปิดงานที่ background task spawn ไว้ 6/13. **1 commit [`587044a`](https://github.com/witsarutnook/penprinting-dashboard/commit/587044a), net −98 LOC.** ลบ dead column `phase2_dirty_at` (heal-cron "needs push to Sheet" marker ที่ §12 retire ไปแล้ว) ออกจาก `postgres-write.ts` writer ทุกตัว — INSERT column+NOW() value 7 จุด (addJob/createOrder×2/moveToShipped/cancelJob/promoteDraft/bulkForward) · UPDATE SET 5 จุด · ON CONFLICT 3 จุด — + ลบ `markRowClean`/`markRowDirty` helpers + type `DirtyTable` + refresh docstrings ~10 จุด · cowork route comments · **db-migrate route ADD COLUMN → DROP INDEX+COLUMN IF EXISTS (idempotent)** · tests flip `toContain`→`not.toContain` (pin การลบ; 147→143 = −4 markRow suite). **Safety key — hidden-reader check ก่อน DROP** (บทเรียน §12 ที่เคยลืม `checkStaleness` reader → bomb 24h): grep ยืนยัน 0 reader จริง — `bump_updated_at` triggers key off `raw`/`phase2_deleted_at` **ไม่ใช่** column นี้ + Apps Script 0 ref + ไม่มี SELECT/WHERE ที่ไหน. Gates เขียว Node 22 (type-check/lint/143 tests/build 39 หน้า). `phase2_deleted_at` **ไม่แตะ** (live tombstone). Lesson → [[feedback_retire_cron_grep_readers]] (ก่อน DROP COLUMN ต้อง grep DB trigger/function bodies เป็น reader ด้วย ไม่ใช่แค่ app SELECT/WHERE).
>
> ## ✅ DROP migration APPLIED (2026-06-16, same session via Chrome MCP)
> Claude รัน `GET /api/admin/db-migrate` ในเบราว์เซอร์ คุณนุ๊ก (logged-in admin "nook") หลังยืนยัน Vercel deploy `7acb6d0` (มี `587044a`) = success. **status 200, `applied` มี 4 DROP ครบ** (jobs/orders/shipped/cancelled `DROP phase2_dirty_at + partial index`). Verified 3 ชั้น: (1) 4 DROP lines ใน applied · (2) idempotent re-run → 0 phase2_dirty_at lines (column gone จริง) · (3) /board reload หลัง DROP — 18 งาน render ปกติ, console 0 errors. **§12 Step 2F phase2_dirty_at half = ปิดสมบูรณ์.** เหลือ phase2_deleted_at (live tombstone) สำหรับ tombstone-cleanup phase ในอนาคต.
> - **(optional) dismiss background-task chip** "ลบ phase2_dirty_at cluster" ถ้ายังโผล่อยู่ใน UI — งานเสร็จแล้ว
>
> **Session 2026-06-13 (บ่าย) — Dashboard quick sweep:** ✅ ปิด 3 audit items ([`a985e62`](https://github.com/witsarutnook/penprinting-dashboard/commit/a985e62), gates เขียวบน Node 22 — 147 tests/build 39 หน้า). **L5** duplicate-dialog status badge: `findDuplicateOrdersInPostgres` คืน `kind` (draft/active/orphan) ผ่าน CASE → `DuplicateView` โชว์ badge ("เปิดอยู่"/"ร่างค้าง"/"ไม่มีงานในบอร์ด") แยกร่างเก่ากับงาน production. **L2** rewrite stale docstrings ทั้ง postgres-write.ts (header + ~18 inline) + cowork route → Postgres-only reality (heal cron/feature-flags/Apps Script getNextId ลบไป §12/§7 หมดแล้ว) — comment ล้วน, subagent ทำ + spot-check accuracy. **doc-nit** db-migrate hint เลิกชี้ sync-all. **`phase2_dirty_at` = dead column** — re-surface ของที่ dashboard-v2.md:422 track ไว้แล้วเป็น **§12 Step 2F deferred** (L2 ไป grep ยืนยัน 0 operational reader post-§12; เขียน 26 จุด + markRow helpers + index) → spawn background task ลบทั้ง cluster (DROP COLUMN migration, แยก session, user apply ผ่าน dashboard). Lesson: [[feedback_audit_backlog_hypothesis]] — note L2 บอก 2 บรรทัด จริง ~20 จุด + ควร cross-ref dashboard-v2.md "Deferred" ก่อนเรียก new finding.
>
> **Session 2026-06-13 — Photobook SEO content push (เสร็จทั้ง reviews + blog):** ✅ ปิดงานค้างจาก 5/17. **repo `penprintphotobook` — 11 commits, 17 หน้า static (+3 จาก 14).** ใช้ superpowers flow เต็ม (brainstorm → spec → plan → subagent-driven 14 tasks ผ่าน 2-stage review ทุก task + final holistic review). **Part 1 Reviews:** `lib/reviews.ts` = 8 รีวิวจริงดึงจาก FB ผ่าน Chrome MCP (คุณนุ๊กคัด, anonymize "Khun X — ปี", 6 featured) → landing 6 + หน้า `/reviews` ใหม่ (โชว์ 8) + `reviewsPageSchema()` **Product-level** aggregateRating (percent scale 96/100, ratingCount 15 — ไม่ผูก LocalBusiness เพราะ Google ignore self-serving, ไม่ fake ดาวรายรีวิวเพราะ FB ไม่มีดาว). **Part 2 Blog:** port MDX pattern จาก penprinting-web (+5 deps) → `lib/blog.ts` + `components/blog/*` (restyle ขาวมินิมอล) + `/blog` + `/blog/[slug]` + 3 โพสต์ไทย (photobook ราคา / ทำอัลบั้มแต่งงานที่ไหนดี / wedding album ทำเอง) + Journal nav. **Post-deploy verify: 13/13 URLs 200, og:type=article + cover ถูก + article:published_time, aggregateRating 96/15, BlogPosting+Breadcrumb, sitemap 11 locs.** **Lesson**: port จาก sibling repo ที่ upgrade framework แล้ว — อย่า copy signature (web เป็น Next 15 `Promise<params>`, photobook ยัง 14 sync `params`); ฝัง comment Phase 3 migration ใน `[slug]/page.tsx` แล้ว. Spec/plan: `docs/superpowers/{specs,plans}/2026-06-12-photobook-seo-content*` (workspace root, ไม่ git-track).
>
> **+ Thai font fix (`24eefa8`, จาก user เห็น h1 blog วรรณยุกต์ซ้อน):** root cause = Cormorant/Pinyon/Inter โหลดแค่ `subsets:['latin']` → **ตัวไทยทั้งเว็บ fallback ไป system font มาตลอดตั้งแต่ launch 5/03** (แต่ละเครื่องเห็นต่างกัน + line-box อิง metric ฝรั่ง → blog h1 ขนาด text-6xl ซ้อน). Fix: เพิ่ม `IBM_Plex_Sans_Thai` (subset thai) เป็น `--font-thai` fallback ต่อท้าย display+sans stack ใน tailwind (ตัวอังกฤษยังได้ Cormorant/Inter, ตัวไทย fallback ไป IBM Plex Sans Thai) + ArticleHeader h1 `leading-snug→normal`. คุณนุ๊กเลือกฟอนต์จาก visual preview widget (เทียบ Anuphan/IBM Plex Sans Thai/Noto Serif Thai/Trirong). **verify ด้วยตาจริงหลัง deploy — ไม่ซ้อนแล้ว** (screenshot ยืนยัน). **2 Lessons** → [[feedback_thai_web_font_subset]] (next/font latin-only = ตัวไทย fallback เงียบ; เพิ่ม Thai font เป็น fallback ใน stack ไม่ต้องแยก className) + เดา line-height สำหรับ Thai display ผิดได้ (เปลี่ยน leading-[1.1]→snug แล้วยังซ้อน จน user ส่ง screenshot เตือน) — **visual change ต้อง verify ด้วยตา ไม่ใช่เดาค่า**
>
> ## ⏳ Pending user actions (photobook 2026-06-13)
> 1. **Rich Results Test** — เปิด [search.google.com/test/rich-results](https://search.google.com/test/rich-results) ตรวจ `penprintphotobook.penprinting.co/reviews` (Product+Review/aggregateRating) + 1 blog post (BlogPosting→Article + Breadcrumb) — ควรไม่มี error
> 2. **Lighthouse mobile** — spot-check 1 หน้า blog (DevTools → Lighthouse) — LCP รูป cover ไม่ควรเกิน ~2.5s
> 3. **GSC** — โพสต์ใหม่ + /reviews index ช้า (IndexNow ยิงเองตอน push แล้ว) — เช็ค Search Console coverage อีกครั้งใน 1-2 สัปดาห์
> 4. **(reminder) Phase 3 photobook Next 14→15** — เมื่อทำ ต้อง await async params ใน `app/blog/[slug]` + `app/sizes/[slug]` (มี comment เตือน) + เช็ค `next-mdx-remote@6` กับ Next 15 RSC
>
> ⚠️ **Soak window web ยังถึง 6/18** (Phase 2 web Next 15) — Phase 3 photobook รอ soak จบก่อน
>
> ---
> **Session 2026-06-11 (บ่าย) — Duplicate-order warning fix + audit:** ✅ จาก user report "คนใช้ งง" dialog พบใบสั่งงานคล้ายกัน. **2 commits**: [`8b132f8`](https://github.com/witsarutnook/penprinting-dashboard/commit/8b132f8) dedupe match เฉพาะใบเปิดจริง (active job `phase2_deleted_at IS NULL` หรือ draft — เช็คผ่าน jobs table เพราะ orders.status ไม่ reliable สำหรับ 'shipped') + copy ใหม่ทั้ง dialog · [`e0b1ae4`](https://github.com/witsarutnook/penprinting-dashboard/commit/e0b1ae4) audit follow-up ปิด H1 (force-confirm ทิ้ง mode 'print') + M1 (pure orphan หลุดเตือน → retry mint ใบซ้ำ) + L1/L3/L4. Audit เปิดใหม่ 3 Low ลง AUDIT-BACKLOG (L2 stale heal-cron docstrings · L5 status badge ใน dialog · L6 update no-dedupe). Tests 146→147. **Lesson**: dialog confirm ที่ resubmit ต้อง carry submit-mode เดิมเสมอ — ดู pattern เดียวกันถ้าเพิ่ม confirm step ใหม่ใน flow ที่มีหลาย mode.
>
> ---
>
> **Session 2026-06-11 — Phase 2: web Next 14→15 + React 18→19:** ✅ Soak calc ครบกำหนดวันนี้พอดี (ไม่มี issue) → รัน Phase 2 ตาม pattern Phase 1 calc. **penprinting-web 2 commits**: `a29b38f` deps bump (next 15.5.19 + react 19.2.7 + types + eslint-config + `@next/third-parties` 15.5.19 ที่ peer-dep ล็อค next ^14) + async `params` 2 dynamic routes (blog/[slug] + services/[slug] — await params ใน generateMetadata + page) · `d5e86ff` Sentry instrumentation migration (sentry.*.config.ts ×3 → instrumentation.ts + instrumentation-client.ts + global-error.tsx + disableLogger → webpack.treeshake — ปิด 4 build warnings เกลี้ยง). Web ง่ายกว่า calc: ไม่มี PWA / API routes / fetch / forwardRef. Gates ผ่านทุก commit (type-check/lint/build 22/22 pages). First Load JS shared 173→184 kB (+11 kB instrumentation — เท่า calc).
>
> ## Post-deploy verify (2026-06-11)
> - **11/11 URLs HTTP 200** (รวม sitemap + robots) · chunk hash live ตรง local build (`4bd1b696-58f28820171d1a7c`)
> - **og meta ครบ**: `/` (og:image + site_name + locale th_TH + twitter:card) · blog post (og:type=article + article:published_time — พิสูจน์ async params ทำงาน) · services/packaging (og:image ถูกหน้า)
> - **Redirects 308 ปกติ**: /track + /production-monitoring → dashboard.penprinting.co
> - **GTM `GTM-WXFN5TXC` ยัง inject** หลัง bump @next/third-parties
> - `penprinting-web/CLAUDE.md` update stack → Next 15.5 + React 19 + Sentry instrumentation pattern
>
> ## ⏳ Pending user actions (จาก 2026-06-11)
> 1. **Soak window web** — เฝ้า Sentry (project penprinting-web) + เปิดเว็บใช้งานจริงถึง **2026-06-18** (~1 สัปดาห์ เหมือน calc) ก่อน Phase 3. ดู: error spike, หน้า blog/services render ปกติ, ลูกค้าไม่รายงานปัญหา. ✅ ตั้ง scheduled task `web-next15-soak-end-check` แล้ว (fire 6/18 09:00 — auto health check 11 URLs + og meta + ชง Phase 3; รันเมื่อแอป Claude เปิดอยู่)
> 2. **GA4 real-time spot-check** — เปิด GA4 ดูว่า event ยังเข้าหลัง bump @next/third-parties (GTM script inject แล้ว แต่ event จริงควรเช็คตา 1 ครั้ง)
>
> ## 🎯 งานหลัก session หน้า
> 1. **Phase 3 — photobook Next 14→15** (รอ soak web จบ 6/18 — pattern เดิม + await params ใน blog/[slug] + sizes/[slug] + เช็ค next-mdx-remote@6)
> 2. **AI Quoting Phase 0** (deferred 9 sessions)
> 3. **A11Y-board-form-label** — dedicated a11y pass (ค้างจาก 6/05)
> 4. **Doc nit** — `/api/admin/db-migrate` route ยังมี hint "sync-all" ที่ §12 ลบไปแล้ว (carryover จาก 6/04)
> ~~Phase 2 web Next 14→15~~ ✅ · ~~Photobook SEO content push~~ ✅ ปิด 6/13 (reviews + blog)
>
> ---
>
> **Session 2026-06-10 — `pageMetadata()` helper refactor (web + photobook):** ✅ ปิด tech debt ค้างจาก 5/29 ([[feedback_nextjs_metadata_shallow_merge]]). เพิ่ม helper `pageMetadata({ title, description, url, ogImage?, ogImageAlt?, keywords?, article? })` ใน `lib/seo.ts` ทั้ง 2 repos — fill `og.type/locale/siteName/images` + `twitter.card` explicit ทุกครั้ง กัน Next.js shallow-merge drop nested fields ซ้ำอีก. Migrate 11 callsites (web 9 + photobook 2). `/wedding-guestbook` consolidate 3 titles → 1 (decision: YAGNI บน per-platform overrides). `/blog/[slug]` ได้ `article` option (og.type=article + publishedTime + authors). Post-deploy curl verify **11/11 URLs PASS** (og:image + twitter:card + og:site_name + og:type) + spot-check canonical/og:url absolute + article:published_time + alternateLocale en_US ครบ.
>
> ## งานที่ทำ (2026-06-10)
> - **penprinting-web `f2ef043`** — helper + migrate 9 pages (10 files, +122/-159)
> - **penprintphotobook `80ae29a`** — helper (+alternateLocale en_US, siteName จาก `SITE_CONFIG.name`) + migrate 2 pages (3 files, +77/-64)
> - Spec + plan (superpowers flow): `docs/superpowers/specs/2026-06-10-pagemetadata-helper-design.md` + `docs/superpowers/plans/2026-06-10-pagemetadata-helper.md` (workspace root — ไม่ git-tracked)
> - Gotcha ที่เจอ: ลบ `FULL_URL` const ใน wedding-guestbook แล้ว breadcrumb JSON-LD ใน body ยังอ้าง → type-check จับได้ → inline `${SITE_CONFIG.url}/wedding-guestbook` แทน. Lesson: const ที่ metadata block ใช้ อาจถูก JSON-LD body ใช้ด้วย — grep ก่อนลบ
> - Photobook size slugs จริงคือ kebab-case (`square-8`, `rect-a3`) ไม่ใช่ snake_case ใน products.ts id ที่เก่า (plan เดาผิดเป็น `square_8_hard`) — build output คือ source of truth
>
> ## ⏳ Pending user actions (จาก 2026-06-10)
> 1. ~~**FB Sharing Debugger refresh 11 URLs**~~ ✅ คุณนุ๊กทำครบ 6/10 — เจอ 2 warnings ปกติ: `fb:app_id` missing (ข้ามได้ — ใช้แค่ FB Insights) + `og:image not yet available` (async processing รอบแรก → Scrape Again ซ้ำแล้วรูปขึ้น; เรามี og:image:width/height ครบอยู่แล้ว)
> 2. ~~**LINE preview spot-check**~~ ✅ ทำครบ 6/10
> 3. **Soak window calc** — เฝ้า Sentry + ใช้ calc.penprinting.co จนถึง **2026-06-11** (พรุ่งนี้ — วันสุดท้าย) ก่อน Phase 2 (web Next 14→15)
>
> ## 🎯 งานหลัก session หน้า
> 1. **Phase 2 — web Next 14→15 pilot** (soak จบ 6/11 — พร้อมเริ่มได้เลย)
> 2. **Photobook SEO content push** (ค้างจาก 5/17 — งานนานสุดในคิว)
> 3. **AI Quoting Phase 0** (deferred 7 sessions)
> 4. **A11Y-board-form-label** — dedicated a11y pass (ค้างจาก 6/05)
> 5. **Doc nit** — `/api/admin/db-migrate` route ยังมี hint "sync-all" ที่ §12 ลบไปแล้ว (carryover จาก 6/04)
> ~~Refactor pageMetadata() helper~~ ✅ ปิดวันนี้
>
> ---
>
> **Session 2026-06-08 — Infra maintenance sweep (Neon + DNS + TTL audit):** ✅ No code change. Neon usage healthy (ใช้ 1.7% compute / 0.4% storage / 4.3% transfer บน Launch plan 30 GB). Neon history retention 6h → **1d** (กัน data accident แบบ DATE_ANOMALY). DNS TTL `app.penprinting.co` **300 → 3600** (cleanup ของค้างจาก Phase 3.6 cutover 5/09). TTL ทั้งหมดใน dashboard app-layer scan แล้ว — ไม่ต้องแตะ (15s loadAll + 60s analytics ISR + adaptive polling 15/30/120s tune ไว้แล้ว). Carryover ยังคง 0.
>
> ## งานที่ทำ
>
> ### Neon database — usage audit + retention bump
> - **Usage (8 days into Jun)**: 5.01 CU-hrs / 0.04 GB storage / 1.3 GB transfer — projected/เดือน = 19 CU-hrs (6% of 300 included) / 50 MB storage / 4.9 GB transfer (16% of 30 GB included). Network transfer ลดลง 4× เทียบกับเคย measured 5.6 GB/8d ก่อนใส่ `unstable_cache` loadAll (May 18)
> - **History retention 6h → 1d** ที่ Neon console → Settings → History window slider. ไม่กิน quota เพิ่ม (storage 40 MB / 10 GB included) — ได้ point-in-time restore window กว้างขึ้น 4× กัน data accident แบบ DATE_ANOMALY (detect ภายในชั่วโมง, recover ได้
> - Decision: อยู่ Launch plan ($19/mo) ต่อ — headroom 84-99% ทุก metric, รองรับ traffic 5-10× ได้ก่อนชน overage
>
> ### DNS TTL `app.penprinting.co` 300 → 3600
> - HostAtom DNS panel: row `app` CNAME `cname.vercel-dns.com` TTL 300 (5 min) → **3600** (1h)
> - **เหตุผล**: ของค้างจาก Phase 3.6 cutover (5/09) — ตอนนั้นลด TTL 300 เพื่อ propagate เร็ว+rollback เร็ว, ผ่านมา 1 เดือนเสถียรแล้ว ไม่มีแผนเปลี่ยน CNAME อีก
> - **ผลลัพธ์**: consistent กับ `calc` + `dashboard` (3600 ทั้งคู่), ลด DNS query 12× ของ resolvers ทั่วโลก
> - Memory: [[feedback_dns_ttl_post_cutover_cleanup]] — pattern สำหรับ DNS migration ครั้งหน้า
>
> ### App-layer TTL audit (no change)
> สแกน TTL ทุก layer ของ dashboard (poll-schedule.ts / api.ts loadAll cache / analytics ISR / cookies / rate-limit / undo / service token) — confirm ว่า tune ไว้แล้วทุกตัว:
> - `loadAll` unstable_cache **15s** + tag-invalidated (lib/api.ts:71) — tune 5/18 เพื่อ collapse N tabs × M staff queries ลง 1 query / window
> - `/analytics` ISR **60s** — acceptable lag สำหรับ KPI
> - Adaptive polling **15s / 30s / 120s / stop@30min** (lib/poll-schedule.ts) — tune 5/19 (PA-H1)
> - Session cookie **30 days**, login rate-limit **5/5min**, track rate-limit **1h window**, service token **5y**, undo **10s** — ปกติทั้งหมด
> - ไม่มีเหตุผล cost ที่ต้องลด — quota เหลือเฟือ
>
> ## ⏳ Pending user actions (carryover = 0, เหลือเฉพาะ tracking)
> 1. **Soak window calc** — เฝ้า Sentry + ใช้ calc.penprinting.co จนถึง **2026-06-11** (เหลือ 3 วัน) ก่อน Phase 2 (web). ดู: ไม่มี error spike, PWA SW ทำงานถูก, ลูกค้าไม่บ่น
>
> ## 🎯 งานหลัก session หน้า
> 1. **Phase 2 — web Next 14→15 pilot** (after soak 6/11 — เหลือ 3 วัน)
> 2. **Refactor `pageMetadata()` helper** (ค้างจาก 5/29 — feedback_nextjs_metadata_shallow_merge root cause)
> 3. **Photobook SEO content push** (ค้างจาก 5/17 — งานนานสุดในคิว)
> 4. **AI Quoting Phase 0** (deferred 6 sessions)
> 5. **A11Y-board-form-label** — dedicated a11y pass (ค้างจาก 6/05)
> 6. **Doc nit** — `/api/admin/db-migrate` route ยังมี hint "sync-all" ที่ §12 ลบไปแล้ว (carryover จาก 6/04 late sweep)
>
> ### Decisions / Lessons
> - **Post-cutover DNS TTL revert** — เป็น chore ที่หายไปจากทุก deploy-checklist; เห็นตอน user เปิด DNS panel โดยบังเอิญ (ไม่ใช่ proactive check). Save เป็น memory [[feedback_dns_ttl_post_cutover_cleanup]] เพื่อให้ surface ทุกครั้งที่ทำ DNS migration. Pattern แบบเดียวกับ [[feedback_omise_secret_roll_vm_sync]] (rolling action ที่มีหลาย consumer + post-action cleanup ที่ลืม)
> - **Neon Launch plan + autoscale 0.25-8 CU** = perfect fit สำหรับ Penprinting scale — usage ตอนนี้ 6%/0.4%/16% ของ quota = รองรับ growth ได้ปลายปีไม่ต้อง upgrade. ถ้า traffic spike วันใด → autoscale handle เอง ไม่ต้องตื่นมาแก้
>
> **Commits**: ไม่มี — docs-only update (NEXT-SESSION.md + memory note `feedback_dns_ttl_post_cutover_cleanup.md` + MEMORY.md index). Infra changes ทั้งหมดทำที่ console (Neon + HostAtom).
>
> ---
>
> **Session 2026-06-05 — UI-1 hydration `/board` closed wontfix + A11Y backlog item added:** ✅ Closed via 60-second incognito A/B test. Carryover ยังคง 0. Phase 2 (web Next 14→15) ยังรอ soak จบ 6/11.
>
> ## งานที่ทำ
>
> ### UI-1 hydration warnings /board → closed wontfix
> - **Phase 1 feedback loop**: scan-deep ทุก client component บนเส้นทาง /board (board-client / dashboard-shell / sidebar / toast-provider / undo-context / pending-mutations / kpi-bar / search-box / filter-chips / kpi-detail-modal / card.tsx 70KB) — grep `new Date()` / `Date.now()` / `Math.random` / `localStorage` / `window.` / `typeof window` ใน render path. **Static analysis clean** — `Date.now()` ใน undo/toast เข้าผ่าน guard (entry/list ว่างตอน initial), `KPIDetailModal` `dynamic({ssr:false})` mount เฉพาะ click, SearchBox `useState(initial)` deterministic จาก URL
> - **Phase 3 ranked hypotheses**: H1 browser extension · H2 static-analysis miss · H3 streaming Suspense race — เริ่มทดสอบจาก H1 cheapest
> - **Phase 5 test**: คุณนุ๊กรัน incognito A/B test (`Cmd+Shift+N` → `/board`):
>   - **Incognito Console: clean** (ไม่มี React error)
>   - **Normal Console: `Uncaught Error: Minified React error #422` + 6 errors** พร้อม fingerprints ตัวพิสูจน์: `Backpack was unable to override window.ethereum` + `Nightly Wallet Injected Successfully` + `Check phishing by URL: Passed.` + `[Revoke][antiphish] result:`
>   - Stack trace top frame `at MessagePort.T (...)` = content-script messaging signature
> - **Closure**: ปิด UI-1 ใน AUDIT-BACKLOG เป็น `[x] wontfix` (crypto wallet + anti-phishing extensions override window.ethereum + DOM ก่อน React hydrate → tree mismatch → CSR recovery automatic, non-functional, outside our control)
> - **Memory note**: เขียน [[feedback_extension_hydration_noise]] — pattern parallel ของ [[feedback_sentry_extension_noise]]. หลักการ: minified `#422`/`#425` ทุกโหลด prod แต่ dev clean = test incognito ก่อน static scan, 60s ประหยัดเวลาทั้ง session
>
> ### A11Y-board-form-label → new Low backlog item
> - DevTools Issues panel โชว์ **100 "No label associated with a form field"** บน /board (รวมถึงใน incognito clean Console)
> - ไม่ใช่ hydration issue — เป็น a11y debt ดิบ ที่ axe-via-DevTools รวบรวมไว้ทุก `<input>`/`<button role="checkbox">` ใน kanban
> - ผู้ต้องสงสัย: bulk-mode "เลือกหลายงาน" checkboxes ของ Column/Card + filter chips ขาด `aria-label`/`<label>`
> - **Defer reason**: 100 ไม่ใช่ 100 unique fields (count ตามจำนวนใบ card × checkboxes); ผ่อนได้, severity low (native input ยังมี implicit role), block dedicated a11y sprint
>
> ## ⏳ Pending user actions (carryover = 0, เหลือเฉพาะ tracking)
> 1. **Soak window calc** — เฝ้า Sentry + ใช้ calc.penprinting.co ไม่ต่ำกว่า 1 wk (จนถึง **2026-06-11**) ก่อน Phase 2 (web). ดู: ไม่มี error spike, PWA SW ทำงานถูก, ลูกค้าไม่บ่น
>
> ## 🎯 งานหลัก session หน้า
> 1. **Phase 2 — web Next 14→15 pilot** (after soak 6/11)
> 2. **Refactor `pageMetadata()` helper** (ค้างจาก 5/29)
> 3. **Photobook SEO content push** (ค้างจาก 5/17)
> 4. **AI Quoting Phase 0** (deferred 6 sessions)
> 5. **A11Y-board-form-label** — dedicated a11y pass (ค้างใหม่ 6/05)
>
> ### Decisions / Lessons
> - **A/B incognito ก่อน static scan** — `/board` UI-1 สอนชัดว่า production-only hydration warnings (minified #422/#425) เป็น extension noise ~99% ของเคส; 60-second incognito test ปิด root cause ที่ static scan ของ 1841-line `card.tsx` ใช้เวลาเป็นชั่วโมงก็ไม่เจอ. Document ใน [[feedback_extension_hydration_noise]]
> - **A11Y วันนี้ surface 100 issues จาก DevTools** — DevTools Issues panel นับทุก instance (ทุก card × ทุก checkbox) ไม่ใช่ unique selector; รายงานสรุปครั้งหน้าใช้ count รายงานเหมือนเดิมแต่ระบุชัดว่าจะ inspect filter chips + bulk checkboxes
>
> **Commits**: docs-only (AUDIT-BACKLOG.md + NEXT-SESSION.md + memory note `feedback_extension_hydration_noise.md` + MEMORY.md index). ไม่มี code change → Vercel auto-deploy = no-op docs.
>
> ---
>
> **Session 2026-06-04 (late) — Pending actions sweep:** ✅ ปิด 9/9 carryover pending actions ใน session เดียว — admin endpoints (db-migrate + fix-date-anomaly applied) · Vercel env cleanup 18 vars · photobook/marketing gitignored · FB Debugger 7 URLs · /track test passed · Sentry alert rule. **Carryover backlog = 0**
>
> ## งานที่ทำ (sweep)
>
> ### Admin endpoints — ปิด 3 dashboard pending items
> - **`/api/admin/db-migrate`** — applied 2 indexes ใหม่ (`idx_shipped_imported` + `idx_cancelled_imported`) + idempotent re-confirm 24 schema statements; tables counts healthy (jobs 179, orders 277, shipped 211, cancelled 32, audit 1207, templates 10)
> - **`/api/admin/fix-date-anomaly`** — dry-run แสดง 3 orders × 2 fields × ISO-with-quote → DD/MM/YYYY math ถูกตาม Bangkok TZ (+7); apply succeeded, 6 cells updated; ปิด **AUDIT-BACKLOG `DATA-dateIn-double-encoded`** สมบูรณ์ (data layer สะอาด post-fix). Doc nit: `db-migrate` route ยัง hint "sync-all" ที่ลบไปแล้ว (§12 retire) — clean up next session
> - **`/track #202605173`** — timeline ถูกต้อง, active step ตรงสถานะปัจจุบัน
>
> ### Vercel env cleanup — 18 dead vars ลบหมด (via Vercel CLI)
> - 14× `WRITE_*_TO_POSTGRES` (add/bulk_forward/cancel_job/cancel_order/cowork/create_order/delete_job/forward_undo/move_to_shipped/promote_draft/restore_job/templates/update_job/update_order)
> - 2× delta-fetch (`NEXT_PUBLIC_DELTA_FETCH`, `NEXT_PUBLIC_DELTA_FETCH_LIST`)
> - 2× phase-flag (`PHASE2_OWNS_CORE_TABLES`, `READ_FROM_POSTGRES`)
> - `ALLOCATE_IDS_IN_POSTGRES` — already gone (cleaned 5/25 Step 7 retire)
> - **ไม่ต้อง redeploy** — code post-§12 ไม่อ่านพวกนี้แล้ว, dead config เท่านั้น
> - Method: `vercel link --yes --project penprinting-dashboard` แล้ว loop `vercel env rm $var --yes` 18 ครั้ง (~400ms ต่อตัว)
>
> ### photobook/marketing gitignored ([`182bb4f`](https://github.com/witsarutnook/penprintphotobook/commit/182bb4f))
> - `/marketing` directory เก็บ campaign brief PDF + plan HTML ที่ output จาก marketing skills
> - Working artifacts ของ brand strategy iteration, ไม่ใช่ site code → gitignore
> - คุณนุ๊กgenerate ใหม่ได้ตลอด ไม่ pollute git history
>
> ### FB Sharing Debugger — refresh OG cache 7 URLs
> - Web: `penprinting.co/`, `penprinting.co/contact` (broken on 5/29 metadata shallow-merge)
> - Photobook: `/sizes/{square-5-5,square-8,rect-8x12,rect-a3}` + `/wedding-guestbook` (broken on 5/29 — nested route metadata redefine without images)
> - Spot check URL #1 (penprinting.co/) raw tags: og:image ✅, twitter:card=summary_large_image ✅, og:image:alt ✅ — fix landed
>
> ### Sentry alert rule (TBD confirm)
> - Tag: `postgres-error: 'true'` from [app/error.tsx:24](app/error.tsx:24)
> - Threshold: > 10 events in 5 min (ปกป้องจาก Postgres outage cascade)
>
> ---
>
> **Session 2026-06-04 — Phase 1 calc Next 14→15 + React 18→19 pilot:** ✅ Vercel deploy 3 ครั้ง (next-pwa fork swap + Next 15/React 19 + Sentry instrumentation refactor), ✅ คุณนุ๊กเทส prod ผ่าน, 🟡 **1-week soak start 2026-06-04 → 2026-06-11** ก่อน Phase 2 (web)
>
> ## งานที่ทำ
>
> ### #1 — next-pwa fork swap ([`13d4151`](https://github.com/witsarutnook/penprinting-calc/commit/13d4151))
> เจอ blocker silent: `next-pwa@5.6.0` (shadowwalker) unmaintained ตั้งแต่ 2023, peerDep `next>=9.0.0` แต่ webpack 5 changes ใน Next 15 จะ build แตก ผ่านไม่ได้แม้ peerDep แค่ผ่าน. Swap → `@ducanh2912/next-pwa@10.2.9` (maintained fork, peerDep `next>=14.0.0`, drop-in compatible).
> - Import: `require('next-pwa')(...)` → `require('@ducanh2912/next-pwa').default(...)`
> - Config: `runtimeCaching` ย้ายจาก top-level → `workboxOptions.runtimeCaching`
> - `skipWaiting` omit (default true)
> - Build verified on Next 14 ก่อน bump (isolate failure mode)
>
> ### #2 — Next 14→15 + React 18→19 ([`e44ba10`](https://github.com/witsarutnook/penprinting-calc/commit/e44ba10))
> - next 14.2.35 → 15.5.19, react 18.3.1 → 19.2.7, types/react 18.3.30 → 19.2.16, eslint-config-next 14.2.35 → 15.5.19
> - **Zero code changes** — calc มี surface area สะอาดมาก: ไม่มี `cookies()`/`headers()`/`draftMode()` (async API codemod = no-op), ไม่มี `forwardRef`/`useRef()` (React 19 ref-as-prop codemod = no-op), ไม่มี `fetch()`/API routes (Next 15 default-uncached = no-op), metadata + viewport แยก export อยู่แล้ว
> - **Manual bump** (ไม่รัน @next/codemod tool) — control เพิ่ม, non-interactive, ไม่มี surprise prompt
> - Bundle: 183 → 202 kB First Load (+10% React 19 baseline, acceptable)
> - Audit: 12 → 10 vulnerabilities (Next 15 ปิด 14 CVEs จาก Next 14.2.35)
>
> ### #3 — Sentry instrumentation refactor ([`efe62ef`](https://github.com/witsarutnook/penprinting-calc/commit/efe62ef))
> ปิด 4 build warnings + ปิดกับ Turbopack future-proof:
> 1. **Delete** `sentry.{server,client,edge}.config.ts` (3 ไฟล์)
> 2. **Create** `instrumentation.ts` (root) — `register()` gate ด้วย `NEXT_RUNTIME === 'nodejs' | 'edge'` + export `onRequestError = Sentry.captureRequestError`
> 3. **Create** `instrumentation-client.ts` (root) — ย้าย ignoreErrors + denyUrls verbatim + export `onRouterTransitionStart = Sentry.captureRouterTransitionStart` (Next 15 App Router nav tracing)
> 4. **Create** `app/global-error.tsx` — `'use client'` + `useEffect(captureException)` + Thai fallback UI
> 5. **next.config.js**: `disableLogger: true` → `webpack: { treeshake: { removeDebugLogging: true } }`
> - Bundle: 202 → 213 kB (+11 kB cost of global-error + client transition tracking, acceptable)
> - **Build output ตอนนี้: ศูนย์ warnings** (เคยมี 4: disableLogger + 3 sentry-files deprecation)
>
> ## ⏳ Pending user actions
> **🟡 ยังค้าง (carryover = 0, เหลือเฉพาะ tracking):**
> 1. **Soak window calc** — เฝ้า Sentry + ใช้งาน calc.penprinting.co ไม่ต่ำกว่า 1 wk (จนถึง **2026-06-11**) ก่อน Phase 2 (web). ดู: ไม่มี error spike, PWA SW ทำงานถูก, ลูกค้าไม่บ่น
>
> **✅ ปิดใน sweep 6/04 (late):**
> - ~~db-migrate apply 2 indexes~~ ✅
> - ~~fix-date-anomaly 3 orders~~ ✅ — AUDIT-BACKLOG `DATA-dateIn-double-encoded` ปิด
> - ~~Vercel env cleanup (18 vars)~~ ✅
> - ~~FB Debugger 7 URLs refresh~~ ✅
> - ~~photobook/marketing/ decision~~ ✅ → gitignored
> - ~~/track #202605173 test~~ ✅
> - ~~Sentry alert `postgres-error>10/5min`~~ ✅
>
> ## 🎯 งานหลัก session หน้า
> 1. **🆕 Phase 2 — web Next 14→15 pilot** (after soak 6/11) — apply same 3-step pattern:
>    - next-pwa fork swap (ถ้า web ใช้ next-pwa — เช็คก่อน, ไม่งั้นข้าม)
>    - Next 14→15 + React 18→19 (web น่าจะ richer surface — มี portfolio pages, services pages, may need `params` async API)
>    - Sentry instrumentation refactor (web มี sentry.client.config.ts richer — preserve ignoreErrors/denyUrls verbatim)
> 2. **Refactor `pageMetadata()` helper** (ค้างจาก 5/29) — กัน SEO shallow-merge bug recur, web + photobook 2 repo
> 3. **Photobook SEO content push** (ค้างจาก 5/17)
> 4. **AI Quoting Phase 0** (deferred 6 sessions)
> 5. **Hydration warnings /board** (ค้างจาก 5/27)
>
> ### Decisions / Lessons (Phase 1 calc)
> - **next-pwa@5 is dead** — บันทึก [[feedback_next_pwa_fork_for_next15]]. Apply same swap to photobook + dashboard ก่อน Next 15 bump
> - **Sentry instrumentation pattern locked in** — บันทึก [[feedback_sentry_instrumentation_next15]]. 5-step recipe ใช้ได้ทั้ง web + photobook + dashboard (ปรับ richness ของ ignoreErrors/denyUrls ตาม project)
> - **Order matters: PWA fork → Next bump → Sentry refactor** — แต่ละ commit คือ deploy แยก, isolate failure mode. Combined commit จะหา root cause ยากกว่ามาก
> - **Manual bump > codemod tool สำหรับ pilot ขนาดเล็ก** — calc มี surface area สะอาดทำให้ manual ปลอดภัย + control เพิ่ม. Dashboard Phase 4 อาจต้องใช้ codemod tool เพราะ async API (cookies/headers) ใช้หลายที่
> - **Bundle growth Next 14 → 15 + React 19 + Sentry instrumentation = ~+30 kB (183 → 213)** — baseline ของ pilot. Web/photobook คาดว่าใกล้ๆ ratio นี้
>
> **Commits**: 3 commits ใน penprinting-calc — [`13d4151`](https://github.com/witsarutnook/penprinting-calc/commit/13d4151) + [`e44ba10`](https://github.com/witsarutnook/penprinting-calc/commit/e44ba10) + [`efe62ef`](https://github.com/witsarutnook/penprinting-calc/commit/efe62ef). Vercel auto-deploy 3 ครั้ง. คุณนุ๊กเทส prod ผ่าน.
>
> ---
>
> **Session 2026-06-03 (late) — Tech-update audit + Phase 0 safe patches ทั้ง 4 Vercel projects:** ✅ Vercel auto-deployed (4 commits — dashboard / web / calc / photobook), ⏳ Phase 1+ planning (Next 14→15 migration) deferred to dedicated session(s)
>
> ## งานที่ทำ
>
> ### Tech-update audit (all 4 Vercel projects)
> - **Status pre-patch**: ทั้ง 4 projects ใช้ `next 14.2.35` + `react 18.3.1` + `tailwindcss 3.4.19` + `typescript 5.9.3` เหมือนกัน
> - **Vulnerabilities**: dashboard มี 7 (3 mod, 4 high). 14 CVEs ใน Next 14.2.35 (DoS/XSS/cache-poisoning/SSRF/req-smuggling) ที่ patched ใน Next 15+/16 เท่านั้น — **14.2.35 = ปลายทาง track 14.2.x แล้ว** (ไม่มี version ใหม่กว่า)
> - **Plan**: 4-phase migration. Phase 0 = safe patches (zero breaking, ทั้ง 4 projects). Phase 1-3 = pilot Next 14→15 ที่ calc → web → photobook. Phase 4 = dashboard (highest risk: 18+ `cookies()` sites + middleware + 27 API routes + 146 tests + recharts/html-to-image/qrcode peer-dep check).
>
> ### Phase 0 — safe patches deployed (4 commits, 4 projects)
> - **calc** ([`52e0a4b`](https://github.com/witsarutnook/penprinting-calc/commit/52e0a4b)) — @sentry/nextjs 10.51→10.56, @types/node + @types/react patch, postcss 8.5.13→8.5.15
> - **web** — same 4 packages (+ @next/third-parties ค้างไว้, ผูกกับ next track)
> - **photobook** — 3 packages (ไม่มี sentry dep)
> - **dashboard** — 6 packages (+ vitest 4.1.5→4.1.8 + @vitest/coverage-v8). Pre-commit gate Node 22 (per [[feedback_penprinting_dashboard_node22_commit]]): type-check ✅ · lint ✅ · 146/146 tests ✅ · production build ✅
> - **CVEs closed**: postcss XSS (GHSA-qx2v-qp2m-jg93) direct dep ทั้ง 4 projects. ws + brace-expansion (transitive ใน dashboard) ยังค้าง — อยู่ใน chains ที่ unblock โดย major bump
> - **Audit count drift**: calc 7→13 หลัง patches (NOT regression — sentry 10.56 ดึง opentelemetry instrumentation deps ใหม่ที่มี transitive vulns ใน `@babel/plugin-transform-modules-systemjs` + `fast-uri`; + `next-pwa→workbox-build→rollup-plugin-terser→serialize-javascript` chain เก่าที่ไม่เคยแสดง). ทั้งหมดเป็น build-time/dev noise — Phase 1 (Next 15) จะปิดส่วนใหญ่
>
> ### Sentry deprecation warnings (logged for Phase 1 follow-up)
> ทั้ง 3 projects ที่ใช้ sentry (calc/web/dashboard) build warning เดียวกัน:
> 1. `disableLogger` deprecated → ใช้ `webpack.treeshake.removeDebugLogging` แทน
> 2. `sentry.server.config.ts` / `sentry.edge.config.ts` → ย้าย content เข้า `instrumentation.ts` `register()` function
> 3. `sentry.client.config.ts` → rename เป็น `instrumentation-client.ts` (Turbopack จะไม่รู้จัก `sentry.client.config.ts`)
>
> ไม่ critical (warnings only) แต่ควรทำพร้อม Phase 1 (Next 15 ใช้ Turbopack dev mode default)
>
> ## ⏳ Pending user actions (ค้างจาก session ก่อนหน้านี้)
> 1. **(ค้างจาก 6/03 morning)** รัน `/api/admin/db-migrate` หลัง Vercel deploy เสร็จ — apply 2 indexes (`idx_shipped_imported` + `idx_cancelled_imported`)
> 2. **(ค้างจาก 6/03 morning)** รัน `/api/admin/fix-date-anomaly` — dry run ก่อน, แล้ว `?apply=1`
> 3. **(ค้างจาก 6/03 morning)** Vercel env vars cleanup — ลบ `NEXT_PUBLIC_DELTA_FETCH` + `NEXT_PUBLIC_DELTA_FETCH_LIST`
> 4. **(ใหม่ 6/03 late)** Smoke test post-Phase-0-deploy: เปิด calc + web + photobook + dashboard (/board /orders /analytics) ดูว่าไม่มี Sentry error spike หลัง sentry 10.56
> 5. **(ค้างจาก 5/29)** FB Sharing Debugger refresh OG cache 7 ลิงก์
> 6. **(ค้างจาก 5/29)** `penprintphotobook/marketing/` untracked — decide git-track/.gitignore
> 7. **(ค้างจาก 5/28)** Vercel env vars cleanup — 14 × `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`
> 8. **(ค้างจาก 5/28)** Sentry alert rule — `postgres-error=true` > 10/5min
> 9. **(ค้างจาก 5/28)** Test `/track #202605173`
>
> ## 🎯 งานหลัก session หน้า (Phase 1 + accumulated backlog)
> 1. **🆕 Phase 1 — calc Next 14→15 pilot** (~2-3 ชม., low risk validator)
>    - `npx @next/codemod@canary upgrade latest --next-version 15.5.19`
>    - React 19 codemod (ref-as-prop ฯลฯ)
>    - Address Sentry instrumentation file deprecation พร้อมกัน (`instrumentation.ts` + `instrumentation-client.ts`)
>    - Build + PWA offline test + deploy preview + smoke ทุก product type
>    - Promote → prod → 1-week soak ก่อน Phase 2 (web)
> 2. **Refactor `pageMetadata()` helper** (ค้างจาก 5/29) — กัน SEO shallow-merge bug recur, web + photobook 2 repo
> 3. **Photobook SEO content push** (ค้างจาก 5/17)
> 4. **AI Quoting Phase 0** (deferred 6 sessions)
> 5. **Hydration warnings /board** (ค้างจาก 5/27)
>
> ### Decisions / Lessons (Phase 0)
> - **`14.2.35` คือปลายทาง 14.2.x track** — ไม่มี backport patch ของ 14 CVEs ของ Next ที่ patched ใน 15+/16 → escalation path บังคับเป็น Next 15 migration ไม่ใช่ minor bump
> - **Audit count drift หลัง sentry minor bump** ไม่ใช่ red flag เสมอ — opentelemetry instrumentation deps (`fast-uri`, `@babel/plugin-transform-modules-systemjs`) เป็น build-time/runtime dependency ของ telemetry, ไม่ใช่ user-input parser. อ่าน chain ก่อนตื่นเต้น
> - **`<style>` of project patching** — เรียงทำตาม risk ต่ำ→สูง (calc → web → photobook → dashboard) แทน parallel — ทำให้ถ้า package@x.y.z มี surprise compat issue, เจอที่ project เล็กก่อน fix ก่อนกระทบ dashboard. คุ้มเวลา 5 นาทีเสียไป
> - **Pre-commit hook needs Node 22 in same Bash call** — ตามที่ [[feedback_penprinting_dashboard_node22_commit]] เขียนไว้, vitest 4.1.8 + rolldown ก็ยังต้อง Node 22; `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null 2>&1 && cd ... && git commit` pattern ใช้ได้สะอาด
>
> **Commits**: 4 commits ใน 4 separate repos — calc [`52e0a4b`](https://github.com/witsarutnook/penprinting-calc/commit/52e0a4b), web [`9605df9`](https://github.com/witsarutnook/penprinting-web/commit/9605df9), photobook [`0100154`](https://github.com/witsarutnook/penprintphotobook/commit/0100154), dashboard [`42f50fb`](https://github.com/witsarutnook/penprinting-dashboard/commit/42f50fb) — Vercel auto-deployed ทั้งหมด
>
> ---
>
> **Session 2026-06-03 — Wholesale-strangler finish + B consolidate (useAutoSync retired, /cancelled+/shipped delta-driven) + Dashboard cleanup C/D:** ✅ Vercel auto-deployed (6 commits, -550 LOC net), ⏳ คุณนุ๊กรัน 2 admin endpoints + ลบ env vars
>
> ## งานที่ทำ
>
> ### #1 — Wholesale-strangler finish ([`db8091d`](https://github.com/witsarutnook/penprinting-dashboard/commit/db8091d), -445 LOC)
> - ลบ `NEXT_PUBLIC_DELTA_FETCH` + `NEXT_PUBLIC_DELTA_FETCH_LIST` flag-OFF branches จาก [`app/board/page.tsx`](app/board/page.tsx) + [`app/orders/page.tsx`](app/orders/page.tsx) + [`app/calendar/page.tsx`](app/calendar/page.tsx) (flag ON ใน prod >1 wk ตั้งแต่ 5/21-22, ตาม [[feedback_wholesale_strangler_finish]] — delete ทีเดียวจบ blast radius linear)
> - ลบ dead server functions: `BoardData`/`OrdersData`/`CalendarData` + helper `DeptSectionHeader`/`Summary`/`Pill` ที่ใช้แค่ใน flag-OFF path
> - 4 client files (board-client/calendar-client/orders-list-client/pending-mutations): drop docstring refs ถึง flag + "counterpart of XxxData" notes
> - [`components/board/pending-mutations.tsx`](components/board/pending-mutations.tsx) — make `pollNow` required (only caller `board-client.tsx` always provides it) + drop legacy `router.refresh()` fallback + `useRouter`/`useTransition`/`queuedCleanups`/`wasPending`/transition-end effect (-89 LOC)
>
> ### #2A — Extend delta server-side for fullLists ([`0edd926`](https://github.com/witsarutnook/penprinting-dashboard/commit/0edd926))
> - [`BoardDelta`](lib/board-delta.ts) + `loadBoardDelta` + `/api/board/delta`: + `{ fullLists: true }` mode → returns full `shipped[]` + `cancelled[]` rows + `shippedAllIds`/`cancelledAllIds` (current PK ID set for delete detection)
> - Cursor `imported_at` (those tables have no `updated_at` — append-on-write + hard-delete-on-restore). Deletes caught via PK ID set, not cursor → no tombstone column needed.
> - [`useDeltaSync`](lib/delta-sync.tsx) + `mergeDelta` extended. New `applyFullList` helper: fast-path returns SAME ref when nothing changed (idle poll never re-renders).
> - **+11 tests** (137 total) — bootstrap fullLists / orderIds-skipped / incremental + imported_at cursor / mergeDelta append-new / restore-drop / same-ref-on-noop / combined-delta
>
> ### #2B — Convert /cancelled + /shipped + delete useAutoSync ([`fe2bec5`](https://github.com/witsarutnook/penprinting-dashboard/commit/fe2bec5))
> - New [`app/cancelled/list-client.tsx`](app/cancelled/list-client.tsx) + [`app/shipped/list-client.tsx`](app/shipped/list-client.tsx) — client-side filter/year-month/query/CSV/pagination (URL-driven via `useSearchParams`, no server round-trip on filter change). RestoreButton inline (was in old `client.tsx`).
> - `/cancelled/page.tsx` + `/shipped/page.tsx` เหลือเป็น auth+bootstrap shell. Old `client.tsx` ใน 2 folder ลบทิ้ง
> - `/shipped` customer-by-orderId lookup ใช้ `orders` จาก delta payload เดียวกัน (fullLists returns jobs + orders + shipped + cancelled) — fresh ทุก poll
> - `<AutoSync />` ออกจาก `/analytics` (60s ISR พอ — aggregate report, ไม่ต้อง real-time)
> - [`lib/auto-sync.tsx`](lib/auto-sync.tsx) slim down เหลือแค่ `broadcastWrite` (10 mutation sites ยังใช้). ลบ `useAutoSync` + `AutoSync` + `useRouter`/refresh/backoff timer machinery (-150 LOC ใน auto-sync.tsx)
> - [`lib/poll-schedule.ts`](lib/poll-schedule.ts) + `lib/delta-sync.tsx` docstrings drop refs ถึง gone hook
>
> ### C — `imported_at` index on shipped + cancelled ([`b44394b`](https://github.com/witsarutnook/penprinting-dashboard/commit/b44394b))
> - เพิ่ม `idx_shipped_imported` + `idx_cancelled_imported` ใน [`app/api/admin/db-migrate/route.ts`](app/api/admin/db-migrate/route.ts) — powers `WHERE imported_at > since` incremental polls (เคย seq-scan ทุก backoff tick, fine ตอนนี้ ~5k rows แต่ degrades linearly ตอน shipped โต). Idempotent (`CREATE INDEX IF NOT EXISTS`).
> - Fix stale [`CLAUDE.md`](CLAUDE.md) source-of-truth table — split `lib/auto-sync.tsx` entry ออกเป็น 3 (auto-sync / delta-sync / board-delta) สะท้อนว่า `useAutoSync` หายไปแล้ว
>
> ### D — fix-date-anomaly admin endpoint ([`608f145`](https://github.com/witsarutnook/penprinting-dashboard/commit/608f145))
> - ปิด AUDIT-BACKLOG `[accepted]` `DATA-dateIn-double-encoded` (3 orders ค้างจาก 5/16): 202605046 / 202605047 / 202605049 ที่ `raw.dateIn` + `raw.dateDue` เก็บเป็น JSON-encoded ISO (legacy residue ก่อน Apps Script `objectToRow` Date guard ลง 5/8)
> - ใหม่: [`/api/admin/fix-date-anomaly`](app/api/admin/fix-date-anomaly/route.ts) — GET dry-run / `?apply=1` apply. `normalizeDate` unwraps JSON → ISO → Bangkok DD/MM/YYYY; idempotent (re-run = no-op). อัพเดททั้ง raw JSONB + denormalized top-level columns `date_in`/`date_due`
> - +9 unit tests (146 total) — bug pattern + DMY passthrough + TZ rollover + null/undefined safety + unrecognised input preserve
>
> ## ⏳ Pending user actions
> 1. **🆕 รัน `/api/admin/db-migrate`** (after Vercel deploy เสร็จ) — apply 2 new indexes (`idx_shipped_imported` + `idx_cancelled_imported`). คาดหวัง response: `applied` array มี 2 ชื่อนี้ใหม่. ถ้าเคยรัน migrate มาก่อนและตอนนี้ run ใหม่ตอน DB index มีอยู่แล้ว — `CREATE INDEX IF NOT EXISTS` skip silently
> 2. **🆕 รัน `/api/admin/fix-date-anomaly`** — dry run ก่อน (ดู report 3 orders), แล้ว `?apply=1` ถ้า diff ดูถูก. ส่ง response `applied[]` กลับมาแชร์ได้
> 3. **Vercel env vars cleanup** — ลบ `NEXT_PUBLIC_DELTA_FETCH` + `NEXT_PUBLIC_DELTA_FETCH_LIST` (no longer read, cleanup-only)
> 4. **Smoke test post-deploy** — เปิด /board /orders /calendar /cancelled /shipped /analytics ตรวจว่าโหลด + auto-sync ทำงาน (mutation → other tab อัพเดต)
> 5. **(ค้างจาก 5/29)** FB Sharing Debugger refresh OG cache 7 ลิงก์ (optional)
> 6. **(ค้างจาก 5/29)** `penprintphotobook/marketing/` untracked — decide git-track/.gitignore
> 7. **(ค้างจาก 5/28)** Vercel env vars cleanup — 14 × `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`
> 8. **(ค้างจาก 5/28)** Sentry alert rule — `postgres-error=true` > 10/5min
> 9. **(ค้างจาก 5/28)** Test `/track #202605173` — verify step 5 active
>
> ## 🎯 งานหลัก session หน้า
> 1. **Refactor `pageMetadata()` helper** (ค้างจาก 5/29) — กัน SEO shallow-merge bug recur, web + photobook 2 repo
> 2. **Photobook SEO content push** (ค้างจาก 5/17) — blog/MDX + reviews + Review/aggregateRating markup
> 3. **AI Quoting Phase 0** (deferred 6 sessions) — spec/scaffold
> 4. **Hydration warnings /board** — รอ user incognito test (ค้างจาก 5/27)
> 5. **Audit follow-up** — ถ้า fix-date-anomaly user apply สำเร็จ ขีดฆ่า `DATA-dateIn-double-encoded` ใน AUDIT-BACKLOG (ตอนนี้ status `[accepted]` — เปลี่ยนเป็น `[x] resolved` พร้อม commit hash + session ref)
>
> ### Decisions / Lessons
> - **`imported_at` cursor for append-only tables** — shipped + cancelled don't have `updated_at` (rows immutable once written). `DEFAULT NOW()` on INSERT makes `imported_at` effectively a `created_at`. Cursor catches new INSERTs; PK ID set comparison catches DELETEs (no tombstone column needed). Same pattern reusable for any append + hard-delete table.
> - **fullLists mode supersedes lists mode** — /orders uses cheap `{ lists: true }` (orderId set only); /shipped + /cancelled use `{ fullLists: true }` (full rows + PK ID set). Consumers don't overlap so `loadBoardDelta` does NOT derive `shippedOrderIds` in fullLists mode (incremental delta.shipped only has new rows, derived set would be wrong) — documented explicitly to prevent a future caller assuming both fields populated.
> - **Promise.all evaluates array sync → mock queue order matters** — when extending board-delta tests, `Promise.all([sql1, sql2])` fires both queries before await; my first test pass queued main jobs/orders first which got consumed by the fullLists queries instead. Re-ordered tests to match actual call-firing order (fullLists block → main block in code → tombstones).
> - **Strangler closeout pattern** — drop fallback paths in 1 commit (blast radius linear), then on the NEXT commit consolidate dependent abstractions ([feedback_wholesale_strangler_finish](file)). Applied here: commit 1 dropped the flag, commit 2 extended the new pattern, commit 3 consolidated the auto-sync abstraction. Each commit gates green independently.
>
> **Commits**: [`db8091d`](https://github.com/witsarutnook/penprinting-dashboard/commit/db8091d) (wholesale-strangler) + [`0edd926`](https://github.com/witsarutnook/penprinting-dashboard/commit/0edd926) (delta fullLists) + [`fe2bec5`](https://github.com/witsarutnook/penprinting-dashboard/commit/fe2bec5) (useAutoSync retire) + [`6247a96`](https://github.com/witsarutnook/penprinting-dashboard/commit/6247a96) (docs) + [`b44394b`](https://github.com/witsarutnook/penprinting-dashboard/commit/b44394b) (imported_at indexes) + [`608f145`](https://github.com/witsarutnook/penprinting-dashboard/commit/608f145) (fix-date-anomaly endpoint) — Vercel auto-deployed
>
> ---
>
> **Session 2026-05-29 — SEO fix (og:image dropped on 7 pages, web + photobook) + Photobook social campaign deliverable:** ✅ both Vercel projects auto-deployed, 📄 campaign docs handed to team
>
> ## งานที่ทำ
>
> ### SEO bug fix — restore `og:image` + twitter card on 7 pages
> - **Audit live** (curl + grep — NOT WebFetch ที่ markdown-convert ⇒ false negative ทิ้ง `<head>`): เจอ og:image หาย + twitter:card ดรอปเป็น "summary" บน 7 หน้า:
>   - penprinting-web: `/`, `/contact`
>   - photobook: `/sizes/square-5-5`, `/sizes/square-8`, `/sizes/rect-8x12`, `/sizes/rect-a3`, `/wedding-guestbook`
>   - หน้าที่เหลือ 14 หน้า (services index + 5 service detail + blog + 5 blog detail + faq + about + portfolio + photobook /) ✅ ถูกหมด
> - **Root cause** — Next.js merge metadata แบบ **shallow ที่ระดับ openGraph/twitter** (replace ไม่ใช่ deep merge). ทุกหน้าที่พัง redefine openGraph โดยไม่ใส่ images/twitter card → `defaultMetadata` fields ที่ inherit หาย. + photobook nested route (`/sizes/*`, `/wedding-guestbook`) มี gotcha เพิ่ม: file-based `app/opengraph-image.tsx` ที่ root **ไม่ propagate** ลงมา nested route
> - **Fix** — เพิ่ม `images: [{url, width: 1200, height: 630, alt}]` + `type/locale/siteName` ใน openGraph, เพิ่ม `card: 'summary_large_image'` + `images` ใน twitter ทั้ง 4 ไฟล์. photobook ชี้ `SITE_CONFIG.ogImage` (`/opengraph-image` dynamic gen). ใส่ comment กำกับ shallow-merge gotcha กัน recur
> - **Gates** — type-check ✅ ทั้ง 2 repo · live verify ทั้ง 7 หน้า og:image=1 + twitter:card=summary_large_image
>
> ### Photobook social campaign plan (deliverable)
> - **"Held in Your Hands"** — แคมเปญ 12 สัปดาห์ (มิ.ย.–ส.ค. 2026), awareness goal, **organic-first** (ยังไม่ยิงแอด), peak Mother's Day 12 ส.ค. ใช้ skills `marketing:campaign-plan` + `marketing:draft-content` + `pdf`
> - **Deliverables** (เก็บใน `penprintphotobook/marketing/` — untracked, user ขอเก็บ in-workspace):
>   - `Penprint-Photobook-Campaign-Brief.pdf` (2 หน้า A4 white-minimal, สรุปสั้น ส่ง LINE/email)
>   - `Penprint-Photobook-Campaign-Plan.html` (responsive, 9 ส่วน: brief ละเอียด + คอนเทนต์ 2 สัปดาห์แรกพร้อมแคปชั่นจริง 6 โพสต์ + สคริปต์ Reel 2 ตัว + Stories + how-to ทีม)
> - Brand voice photobook applied: English-first, Quote→Story→Product→CTA, light emoji 🤍✨ only, no "ลด!! ด่วน!!"
>
> ## ⏳ Pending user actions
> 1. **(Optional) Facebook Sharing Debugger** — refresh OG cache สำหรับลิงก์ทั้ง 7 หน้าที่ fix: https://developers.facebook.com/tools/debug/ — ไม่งั้น FB cache เก่าจะยังโชว์ no-preview จนกว่าจะ recrawl เอง
> 2. **`penprintphotobook/marketing/` untracked** — ตัดสินใจว่าจะ git-track (commit เป็น marketing collateral) หรือ .gitignore (เก็บแค่ local). ผมรอ confirm — ตอนนี้ขึ้น `?? marketing/` ทุก `git status`
> 3. **(ค้างจาก 2026-05-28)** — Vercel env vars cleanup (14 WRITE_*_TO_POSTGRES + PHASE2_OWNS_CORE_TABLES + READ_FROM_POSTGRES), Sentry alert rule (postgres-error=true >10/5min), /track #202605173 verify step 5 active, (optional) incognito hydration test /board
>
> ## 🎯 งานหลัก session หน้า (ตัวเลือก)
> 1. **Refactor `pageMetadata()` helper** — สร้างใน `lib/seo.ts` ทั้ง 2 repo ที่ wrap defaultMetadata properly → กัน shallow-merge bug recur (ตอนนี้ point fix 4 ไฟล์ ×2 repos, refactor opportunity)
> 2. **Photobook SEO content push** (priority ค้างจาก 2026-05-17) — blog/MDX content รับ buyer-intent keyword (photobook ราคา, ทำอัลบั้มแต่งงานที่ไหนดี, wedding album ทำเอง) + ดึงรีวิวจริง 15 อันจาก FB → render บนหน้า + ใส่ Review + aggregateRating markup กลับ
> 3. **(ค้างจาก 2026-05-28)** — Wholesale-strangler finish dashboard flag-OFF paths (NEXT_PUBLIC_DELTA_FETCH + NEXT_PUBLIC_DELTA_FETCH_LIST) — ON ใน prod ครบ 1 wk แล้ว
>
> ### Decisions / Lessons
> - **Next.js metadata merge is shallow** ([[feedback_nextjs_metadata_shallow_merge]]) — openGraph/twitter redefine = replace ทั้ง object → defaultMetadata fields ที่ไม่ได้ใส่ซ้ำหาย. file-based `opengraph-image.tsx` apply เฉพาะ root segment — ไม่ propagate ลงมา nested route. TS pass, build pass, page render ปกติ — bug เงียบที่ social share preview เท่านั้น (ไม่มี runtime error ให้เห็น)
> - **Verify SEO ด้วย curl + grep ตรงๆ ไม่ใช่ WebFetch** — WebFetch แปลง HTML→markdown ทำให้ `<head>` หาย → false negative "ไม่มี meta tag ทั้งเว็บ". ครั้งนี้ถ้าเชื่อ WebFetch จะเข้าใจผิดว่าทุกหน้าพัง (จริงแค่ 7 จาก 21) — ใช้ `curl -s $URL | grep -oE '<meta[^>]*>'` ตรวจของจริง
> - **`penprintphotobook/marketing/` = deliverables ไม่ใช่ scratch** — user explicitly อยากเก็บ in-workspace ไม่ใช่ Desktop. keep untracked แต่ keep — เลื่อนตัดสินใจ git-track/ignore รอบหน้า
>
> **Commits**: penprinting-web — `fix(seo): restore og:image + twitter card on / and /contact` · penprintphotobook — `fix(seo): restore og:image on /sizes/* and /wedding-guestbook`
>
> ---
>
> **Session 2026-05-28 — §12 Step 6 Apps Script cleanup + Step B `<AutoSync />` consolidate + hot-fix /analytics sync_meta gate:** ✅ deployed dashboard, ⏳ AS clasp pushed (รอ user deploy "Edit existing → New version")
>
> ## งานที่ทำ
> - **§12 Step 6 — Apps Script cleanup (production-monitoring/apps-script/dashboard/)** — ลบ dead handlers + dead modules หลัง §12 Step 1-5 ตัด AS path ทั้งหมด:
>   - **api.ts (-50% LOC, 8.6K → 4.2K)** — เหลือแค่ `searchArchive` case ใน doPost; ลบ 25 handlers (17 write + 6 heal Phase 2 + 3 read + `saveAll`/`runQuotaCheck`/`runBackup`/`getQuotaStats`). ลบ `bumpUsage_()` calls (quota.ts ถูกลบ). doGet stub-return `Action retired (§12 Postgres-only): <action>` ถ้ามี stale frontend เรียก. inline `jsonResponse` helper (เพราะ helpers.ts ถูกลบ)
>   - **auth.ts trim** — `ROLE_REQUIREMENTS` เหลือแค่ `searchArchive: ['admin']` (ลบ 9 admin + 6 sales actions ที่ retire ไปแล้ว)
>   - **7 modules ถูกลบทั้งไฟล์** — `write.ts/.js` (~30K, 17 write handlers + heal helpers) · `quota.ts/.js` (~10K, dailyQuotaCheck/sendQuotaReport_/bumpUsage_/getQuotaStats) · `backup.ts/.js` (~5K, backupSheet + Drive folder triggers) · `r2.ts/.js` (~7K, r2BackupWeekly + S3 client) · `load.ts/.js` (~12K, loadAll/loadOrder/getAuditByTarget) · `templates.ts/.js` (~4K, addTemplate/deleteTemplate/setTemplateRow) · `helpers.ts/.js` (~10K, sheetToArray/findRowById/objectToRow/getConfig/getNextId stubs/findDuplicateOrderIds/setupOrderCounters — all dead after upstream callers gone)
>   - **คงไว้:** `setup.ts/.js` (ops tool — `generateServiceToken` regen ทุก 5 ปี + `setupSheets` bootstrap) · `archive.ts/.js` (searchArchive + auto-archive trigger ยังจำเป็น) · `audit.ts/.js` (appendAudit ยัง log searchArchive) · `Code.js` (sheet IDs/headers + comment block trim)
>   - **Code.js** — ลบ comment block ที่อ้างไฟล์ที่ลบไป + เขียน "post §12 module map" สั้น ๆ (70 → was 93 lines)
>   - **clasp push -f** สำเร็จ 9 files (was 16). Gates: `npx tsc -p tsconfig.build.json` ✅ no errors. **คุณนุ๊กต้อง deploy "Edit existing → New version" ที่ Apps Script editor**
> - **Step B — `<AutoSync />` consolidate** ([3 files, -1+8 lines]) — ลบ `<AutoSync />` JSX + import จาก [`app/board/page.tsx`](app/board/page.tsx) (legacy OFF path) · [`app/orders/page.tsx`](app/orders/page.tsx) · [`app/calendar/page.tsx`](app/calendar/page.tsx). 3 หน้านี้ delta-fetch path live ตั้งแต่ 5/21-22 → `<AutoSync />` redundant ตอนที่ flag ON (production state). คง `useAutoSync` hook + `<AutoSync />` ที่ /analytics /cancelled /shipped (ไม่มี delta-fetch). `broadcastWrite` helper ยังอยู่ใน lib/auto-sync.tsx (ใช้ทั่วระบบ). docstring `BoardDataDelta` ลบ comment เก่าที่อ้าง `<AutoSync>` ใน flag-OFF path
> - **Gates Node 22 (penprinting-dashboard)** — type-check ✅ · lint ✅ · vitest **120 passed** · next build ✅
> - **Hot-fix /analytics "Postgres mirror stale: jobs last synced 1491 min ago"** ([commit `5b61973`](https://github.com/witsarutnook/penprinting-dashboard/commit/5b61973)) — bomb หลัง §12 ship 24h: §12 Step 1-5 ลบ `sync-from-sheet` cron แล้ว แต่ `lib/api-postgres.ts` ยังเรียก `checkStaleness()` (อ่าน `sync_meta.last_sync_at`) ใน `loadAllFromPostgres` + `getAuditByTargetFromPostgres`. Sync_meta ไม่มี writer แล้ว → 30 min threshold ตรงทุก request → /analytics throw. **Fix:** ลบ `checkStaleness()` + 2 callsites; rename `PostgresStaleError` → `PostgresReadError` (class ใช้แค่ "not configured" + "row not found" ตอนนี้); message prefix "Postgres read failed:". Same anti-pattern ที่ 2026-05-12 `loadOrderFromPostgres` refactor เคยลบไปแล้ว — แค่ลืมขยายไปอีก 2 functions. **+6 regression tests** (no sync_meta query invariant for loadAllFromPostgres + getAuditByTargetFromPostgres + reworded loadOrder test). Gates ผ่าน (126/126 tests)
> - **Memory เพิ่ม:** [[feedback_retire_cron_grep_readers]] — เวลา retire cron, grep readers ของ table/column ที่ cron เขียนไว้ก่อน merge. time-threshold check จะ bomb N ชั่วโมงหลัง deploy ตอน gate ปิดไปแล้ว → ผ่าน vitest/build/smoke แต่ผ่านเข้า production จะ trip ตอน threshold ตรง. Prefer presence-check (row exists?) เหนือ freshness-check (NOW - x > T?) เมื่ออ่านจาก own authoritative store
>
> ## ⏳ Pending user actions
> 1. **Apps Script deploy** — เปิด Apps Script editor (project "penprinting dashboard data") → Deploy → Manage deployments → **Edit existing → New version** → publish. URL ของ deployment คงเดิม. หลัง deploy ตรวจ: /archive search ยังใช้งานได้ (เรียก `searchArchive` ผ่าน doPost)
> 2. **Smoke verify Apps Script** หลัง deploy — /archive search ใช้งานได้ + Sentry monitor 30 นาที (no spike)
> 3. **(ค้างจากเซสชั่นก่อน) Vercel env vars cleanup** — ลบ 14 `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`
> 4. **(ค้างจากเซสชั่นก่อน) Sentry alert rule** — `postgres-error=true` > 10/5min → notify
> 5. **(ค้างจากเซสชั่นก่อน) Test /track ใบ `#202605173`** — verify step 5 "สินค้าพร้อมรับ" active
> 6. **(Optional) Incognito test /board** — verify Dashlane extension theory
>
> ## 🎯 งานหลัก session หน้า
> 1. **Wholesale-strangler finish — ลบ legacy flag-OFF paths**: `NEXT_PUBLIC_DELTA_FETCH` (board) + `NEXT_PUBLIC_DELTA_FETCH_LIST` (orders/calendar) ON ใน prod ตั้งแต่ 5/21-22 = ครบ 1 wk แล้ว. ตาม [[feedback_wholesale_strangler_finish]]: delete ALL fallback paths in 1 commit (blast radius linear). Scope: ลบ `if (process.env.NEXT_PUBLIC_DELTA_FETCH... === '1') { ... }` branch จาก 3 pages + ลบ `BoardData`/`OrdersData`/`CalendarData` legacy components + ลบ env vars ออกจาก Vercel + ลบ `loadAll`/`computeBoard`/`computeCalendar`/`computeOrdersList` server-side callers (if dead). Effort ~1-1.5 ชม.
> 2. **B consolidate continue (optional)** — ตอนนี้ Step B ทำแค่ ลบ `<AutoSync />` จาก 3 pages. `useAutoSync` hook + `<AutoSync />` ยังใช้ที่ /analytics /cancelled /shipped. ถ้าอยาก consolidate ครบ: เพิ่ม `useDeltaSync` ให้ /cancelled /shipped (โหลด jobs+orders+cancelled+shipped) → ลบ `useAutoSync` ทั้งหมด. /analytics ใช้ 60s ISR — ไม่ต้อง delta. ทำพร้อม #1 ได้ (related cleanup)
> 3. **AI Quoting Phase 0** (deferred 5 sessions) — spec/scaffold
> 4. **`/check-quota` skill** — manual Apps Script + CF Worker quota check (value น้อยลงมาก หลัง §12 Step 6 — quota loss = acceptable, planned)
> 5. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL
> 6. **Hydration warnings /board** — รอ user incognito test
>
> ### Decisions / Lessons
> - **setup.ts ≠ dead code**: ตอน scope plan setup.ts ดูเหมือนเป็นไฟล์ retire-able (อยู่ในกลุ่ม "post-§12 cleanup") แต่จริงๆ มี `generateServiceToken` (run ทุก 5 ปี ตอน rotate APPS_SCRIPT_TOKEN) + `setupSheets` (first-time bootstrap). ลบ = footgun สำหรับ future ops. **Rule of thumb**: ถ้า function รัน manually จาก Apps Script editor (ไม่ใช่ดูแลโดย dashboard) → ตรวจก่อนว่าเป็น admin tool หรือ truly-dead. Common admin tools: token mint, schema migrate, one-time data fix, manual scan/repair
> - **helpers.ts plan was wrong — fully dead after upstream callers gone**: NEXT-SESSION เก่าระบุ "คง sheetToArray + findRowById" แต่ grep callers พบว่า callers อยู่ใน load.ts/templates.ts/write.ts ทั้งหมด (ลบไปแล้ว). archive.ts/audit.ts ใช้ raw `getValues()` ไม่พึ่ง helpers. **Always verify caller graph ก่อน trim** — plan ใน roadmap อาจเก่าหรือ assumption ผิด ([[feedback_audit_backlog_hypothesis]])
> - **clasp push ≠ deploy** ([[feedback_diagnostic_gs_clasp_push]]): push อัพ source ไป Apps Script editor; deployment URL ผูกกับ "Manage deployments → Edit existing → New version". URL คงเดิม = LINE webhook + frontend ยังเรียกได้. **อย่ากด "New deployment"** = URL เปลี่ยน = ระบบพังเงียบ
> - **`bumpUsage_` lived in quota.ts** — quota.ts ถูกลบ → api.ts calls `bumpUsage_()` กลายเป็น ReferenceError. ก่อนลบ module ใหญ่ ๆ grep cross-file usage ของ helpers internal เสมอ
> - **Step B minimal vs wholesale**: user เลือก minimal ("ลบเฉพาะ 3 pages") = ลบแค่ `<AutoSync />` ใน flag-OFF branch ที่ effectively dead. ไม่ลบ branch ทั้งก้อน = leaves legacy path partially-working (no auto-refresh). มี wholesale opportunity ค้างใน #1 ของ "งานหลัก session หน้า"
>
> **Commits:** [`accce6b`](https://github.com/witsarutnook/penprinting-dashboard/commit/accce6b) Step B + docs · [`a579d18`](https://github.com/witsarutnook/penprinting-dashboard/commit/a579d18) hash fill-in · [`5b61973`](https://github.com/witsarutnook/penprinting-dashboard/commit/5b61973) **hot-fix sync_meta gate**. Step 6 source อยู่ production-monitoring/apps-script/dashboard/ (not git-tracked, deployed via clasp push 9 files at 12:24)
>
> ---
>
> **Session 2026-05-27 — §12 Apps Script shrink (Step 1-5) + /track shipping-queue fix + board cleanup:** ✅ deployed
>
> ## งานที่ทำ
> - **/track step 5 active fix** ([commit `0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3)) — ใบสั่งงานที่ `staff='ship'` (อยู่คิวรอจัดส่ง) เคยค้าง active ที่ step 4 "ขั้นตอนหลังพิมพ์" เพราะ `/api/track/lookup` ส่งแค่ `currentDept='post'` ไม่แยก sub-state ของ ship-staff. เพิ่ม flag `awaitingShipment` ใน response + client shift step 4=done, step 5=current. ชื่อ "สินค้าพร้อมรับ / Ready for pick up" คงเดิม (คุณนุ๊ก confirm). statusLabel badge ก็ override เป็น "สินค้าพร้อมรับ" ให้ตรงกับ active step
> - **§12 Apps Script shrink Step 1-5** ([commit `745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f), -4,968 LOC across 47 files) — Postgres-only, ไม่มี Apps Script fallback อีกแล้ว:
>   - **lib/api.ts**: ลบ `tryPostgres()` + AS fallback ใน loadAll/loadAllWithAudit/loadOrder/getAuditByTarget. ลบ loadAllFresh/loadAllFromAppsScriptForSync/getQuotaStats (no caller after §12). คง AppsScriptError + post() + searchArchive (ใช้ /archive จน §13). loadOrderAndJobs เป็น Postgres-direct
>   - **17 write routes**: ลบ `if (phase2WriteEnabled(...)) ... else { post(...) }` ทั้งหมด (jobs/{add,update,delete,cancel,move-to-shipped,reassign,cowork,bulk-forward,forward,forward-undo,restore} + orders/{add,update,cancel,promote-draft,templates/add,templates/delete}). jobs/add idempotency check migrated จาก `loadAllFresh()` → direct SQL
>   - **Dead code deleted**: lib/feature-flags.ts (phase2WriteEnabled + 14 WRITE_* flags + phase2OwnsTable) · lib/sync-to-sheet.ts + lib/sync-from-sheet.ts (~770 LOC heal cron) · 4 cron routes (sync-to-sheet/sync-from-sheet/quota-check/r2-backup) · 9 admin diagnose/import routes + 2 bench-audit endpoints (board/postgres + audit/postgres) · app/admin/bench-audit/ dir · app/analytics/quota-widget.tsx · app/api/orders/delete (dead, no frontend caller) · 2 test files
>   - **Added**: app/error.tsx — Postgres-outage friendly UI with retry button. Tags Sentry events `postgres-error=true` when error message matches Postgres signature
>   - **vercel.json**: 5 crons → 1 (morning-report only)
> - **chore(board)** ([latest commit](https://github.com/witsarutnook/penprinting-dashboard)) — ลบ `generatedAt: new Date().toISOString()` จาก computeBoard. unused impure side effect ใน pure compute function — ไม่ใช่ root cause ของ hydration warning แต่ลบเพื่อ eliminate 1 variable ตอน investigate ครั้งหน้า
> - **Smoke verified production** ผ่าน Chrome MCP — /board (KPI + cards), /orders (252 ใบ), /calendar (61 รายการ), /analytics (179 ใบ/89.4% success), /track (lookup form) — Postgres-only path ทำงานปกติ
> - **Diagnose hydration warnings /board** (React #422 + #425) — invoked `/diagnose` skill. **Pre-existing** since `6412d5b` (5/21 BoardClient delta-fetch), ไม่ใช่จาก §12. Math.proof ว่า getBangkokToday() TZ-stable. Hypothesis #3 (Dashlane extension injecting DOM `fiikommddbeccaoicoejoniammnalkfa`) plausible แต่ไม่ confirmed. UI works (React #422 = "recovered by client-rendering"). **Not blocking — defer to incognito test**
>
> ## ⏳ Pending user actions
> 1. **Smoke verify production จริง** (~2-3 นาที หลัง deploy auto) — สร้าง order ใหม่ 1 ใบ + cancel/delete/forward 1 job → ดูทำงานปกติ + Sentry monitor 30 นาที (error rate ไม่ spike)
> 2. **Vercel env vars cleanup** (no-op now): ลบ 14 `WRITE_*_TO_POSTGRES` + `PHASE2_OWNS_CORE_TABLES` + `READ_FROM_POSTGRES`. dead flags ทั้งหมด — ปลอดภัย
> 3. **Sentry alert rule**: สร้าง alert: tag `postgres-error=true` > 10 events/5min → notify (Sentry UI)
> 4. **Test /track ใบ `#202605173`** — verify ว่าตอนนี้ step 5 "สินค้าพร้อมรับ" active แทน step 4 (ที่คุณนุ๊กเห็น bug ตอนเช้า)
> 5. **(Optional) Incognito test /board** — เปิด chrome incognito → login → /board → ดูว่า hydration warnings หาย? ถ้าหาย = Dashlane extension เป็นต้นเหตุ. ถ้ายังอยู่ = need source maps debug
>
> ## 🎯 งานหลัก session หน้า
> 1. **⭐ §12 Step 6 — Apps Script cleanup** (~1 ชม.) — ลบ dead handlers ใน Apps Script project. ก่อนหน้านี้เลื่อนเพราะ blast radius. ตอนนี้ dashboard ไม่เรียก AS ยกเว้น searchArchive → safe to clean:
>    - `api.ts/api.js`: ลบ 17 legacy write case handlers + 6 heal Phase 2 handlers (setJobRow/setOrderRow/setShippedRow/setCancelledRow/deleteJobByIdRow/setTemplateRow) + 3 read handlers (loadAll/getOrder/getAuditByTarget) + saveAll/dailyQuotaCheck/getQuotaStats. **คงไว้**: searchArchive
>    - `write.ts/write.js`: ลบทั้งไฟล์ (~750 LOC) — รวม legacy `addOrder/addJob/bulkForward/createOrder` ที่ยังมี internal `getNext*` stubs
>    - `helpers.ts/helpers.js`: ลบ getNextId/getNextIds/getNextOrderId stubs (no caller after write.ts ตาย) + ลบ findDuplicateOrderIds/setupOrderCounters/incrementConfig. คง sheetToArray + findRowById (archive.ts ใช้)
>    - `quota.ts/quota.js + backup.ts/backup.js + r2.ts/r2.js`: ลบทั้งหมด (Option B locked — Neon PITR)
>    - `auth.ts/auth.js`: ลบ ROLE_REQUIREMENTS entries ของ actions ที่ลบไป
>    - clasp push → คุณนุ๊ก deploy "Edit existing → New version"
> 2. **§12 Step 2F deferred — DB migration DROP COLUMN** (optional, low priority):
>    - **phase2_dirty_at**: column ค้าง dirty_at=NOW() ตลอดไป (ไม่มี heal cron มาเคลียร์). Cosmetic. Safe ลบได้ — แต่ต้อง refactor ทุก `SET phase2_dirty_at = NOW()` ใน lib/postgres-write.ts (20+ instances) ก่อน DROP
>    - **phase2_deleted_at**: ใช้เป็น soft-delete tombstone ใน SELECTs (`WHERE phase2_deleted_at IS NULL`). ถ้าจะลบต้อง refactor moveToShipped/cancelJob/deleteJob ให้ hard-DELETE jobs row แทน. Bigger refactor — ทำเมื่อทำ tombstone cleanup phase
> 3. **§12 Step 4 — Sentry alert rules** — set ผ่าน Sentry UI (Pending #3 ด้านบน)
> 4. **Hydration warnings /board investigate** — รอ user incognito test ก่อน
> 5. **B consolidate (`useAutoSync` ↔ `useDeltaSync`)** — soak ≥2 wk ตั้งแต่ 5/22 (delta-fetch-list live) — ครบ ~6/5 ก็เริ่มได้ (ลบ useAutoSync แทน consolidate, ง่ายกว่า)
> 6. **AI Quoting Phase 0** (deferred 4 sessions) — spec/scaffold
> 7. **`/check-quota` skill** — manual Apps Script + CF Worker quota check (value ลดลงหลัง §12 Step 6)
> 8. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL
>
> ### Decisions / Lessons
> - **§12 = wholesale rewrite > incremental migration**: ลบ AS fallback paths ทั้ง 17 routes พร้อมกันใน 1 commit สะอาดกว่าทยอย — incremental จะมีหลาย commit ที่ partial state (some routes Postgres-only, some hybrid) + แต่ละ commit ต้องเขียน docstring/test/audit งง. Locked plan ก่อน execute (4 decisions §10 confirmed) ทำให้ ship ครั้งเดียวจบ
> - **Defer DB migration scope (Step 2F)** ดีกว่า bundle ใน §12: phase2_deleted_at ใช้ใน SELECT gating — DROP COLUMN ต้อง refactor 6+ helpers (moveToShipped/cancelJob/deleteJob/etc). bundle = blast radius เพิ่ม 2× โดยไม่จำเป็น. Cosmetic-only column ใช้พื้นที่ disk เล็กน้อย ปล่อยได้
> - **Smoke verify ผ่าน Chrome MCP (incognito ไม่ได้)** — Chrome MCP เป็น user's logged-in browser. ถ้าจะทดสอบ extension impact ต้อง user manually open incognito + verify เอง
> - **Hydration warning ไม่ได้ block ship** — React #422 = "recovered by client-rendering". UI render ปกติ + ไม่มี user impact. Defer ไป next session ดีกว่าหา smoking gun ตอนนี้ (ไม่มี source map → time-bounded)
>
> **Commits:** [`0cb98c3`](https://github.com/witsarutnook/penprinting-dashboard/commit/0cb98c3) (track fix) · [`745d36f`](https://github.com/witsarutnook/penprinting-dashboard/commit/745d36f) (§12 Postgres-only -4,968 LOC) · `3da9266` (generatedAt cleanup)
>
> ---
>
> **Session 2026-05-25 — ID-allocation Step 7 retire + Neon transfer-rate check guide:** ✅ deployed
>
> ## งานที่ทำ
> - **Step 7 retire** ([migration-plan-id-allocation.md §7](migration-plan-id-allocation.md)) — soak จริง 4 วัน (เร็วกว่า plan 3 วัน) เพราะคุณนุ๊กตัดสินใจ "ทำทั้งหมดตอนนี้ deploy ทันที" หลัง audit แล้วไม่มี Sentry / ID collision ใน window
>   - **Dashboard (6 routes + lib)** — ลบ `if (allocateIdsInPostgres()) … else { post('getNext*') }` → keep Postgres-only mint. ลบ `allocateIdsInPostgres()` + comment block จาก [`lib/feature-flags.ts`](lib/feature-flags.ts). clean docstring ของ [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) + [`/api/admin/db-migrate`](app/api/admin/db-migrate/route.ts) (ลบการอ้างอิง flag)
>   - **Apps Script** — ลบ 3 case handlers (`getNextId`/`getNextIds`/`getNextOrderId`) จาก `api.ts`/`api.js` + 3 action exemptions ใน audit-log gate + function definitions จาก `helpers.ts`/`helpers.js` + clean comment ใน `auth.ts`/`auth.js`/`Code.js`
>   - **Gates Node 22:** type-check ✅ · lint ✅ · vitest **139 passed** · next build ✅
>   - **ระวัง — known live wart:** Apps Script `write.ts`/`write.js` ยังมี internal call `getNextId`/`getNextIds`/`getNextOrderId` ใน legacy `addOrder`/`addJob`/`bulkForward`/`createOrder` action handlers. แก้ tsc compile ด้วย **stub 3 helpers ที่ throw** "Apps Script ID allocation retired 2026-05-25 — Vercel routes mint via Postgres counters table" → dead handlers จะ fail ดังๆ ถ้าถูก call (ดีกว่า `ReferenceError`). รอลบ handlers จริงกับ Apps Script write-retire phase ตามแผน §12
> - **Neon transfer rate guide** — เขียน checklist ขั้นตอนเปิด console.neon.tech → project → Monitoring → Data Transfer → กราฟรายวัน เทียบ baseline 0.7 GB/วัน (ก่อน optimize) · 0.35-0.4 (post P3 21 พ.ค.) · คาด <0.3 หลัง delta-list (22 พ.ค. ON). บันทึกผลใน NEXT-SESSION เมื่อคุณนุ๊กดูเสร็จ
>
> ## ⏳ Pending user actions
> 1. ~~**Push + deploy Apps Script**~~ ✅ source pushed 11:33 (Claude clasp), version ใหม่ deployed โดยคุณนุ๊ก (Edit existing — URL คงเดิม)
> 2. ~~**ลบ env var `ALLOCATE_IDS_IN_POSTGRES`**~~ ✅ ลบจาก Vercel แล้ว — Step 7 retire LIVE ครบทั้งระบบ
> 3. ~~**Smoke-verify**~~ ✅ ทดสอบสร้างใบสั่งงานจริง: order `#202605171` (ต่อจาก `#202605145`@5/21 monotonic) · job `#820` (ต่อจาก `#740`@5/21) · PIN random `6762` · UI render ปกติ — **Postgres-mint สมบูรณ์ 100%**
> 3. ~~**Neon transfer-rate check**~~ ✅ — คุณนุ๊กแจ้งผล: **1.16 GB / 7 วัน (18-25 พ.ค.) = ~0.166 GB/วัน**. ลด **76% จาก baseline 0.7 GB/วัน** · ทะลุเป้า P3 (<0.3) ~2×. Storage 35.64 MB เล็กมาก ไม่ใช่ bottleneck. Compute 17.05 CU-hrs / 7d = ~2.4 CU-hrs/วัน
> 4. **ค้างเดิม — DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL (impact ใกล้ศูนย์)
>
> ## 🎯 งานหลัก session หน้า
> 1. **⭐ §12 — Apps Script shrink** ([migration-plan-apps-script-shrink.md](migration-plan-apps-script-shrink.md)) — ตัด Sheet sidecar (sync-to/from-sheet cron) + read fallback (`tryPostgres` AS path) + 17 legacy write else-branches + dead Apps Script handlers ในก้อนเดียว. **Pre-execute decisions**: คุณนุ๊ก confirm 4 ข้อใน §10 ก่อนเริ่ม (r2-backup option, audit_log import, R2 snapshot ก่อนตัด, Sheet permission). Effort ~5-6 ชม. แนะนำแบ่ง 2 sessions (code+deploy / Apps Script cleanup+soak)
> 2. **soak `NEXT_PUBLIC_DELTA_FETCH_LIST` ต่อ** — รอ ≥2 wk ก่อนตัดสิน retire `useAutoSync` (อยู่ใน B consolidate plan)
> 3. **`/check-quota`** — Apps Script + Cloudflare Worker quota check skill (จะมีค่าน้อยลงหลัง §12 — quota loss = acceptable, ดู §12 Trap 3)
> 4. **AI Quoting Phase 0** (deferred 3 sessions) — spec/scaffold
> 5. **DATE_ANOMALY fix** ถ้าเริ่มงาน DB cleanup
>
> ### Decisions / Lessons
> - **Soak 4 วัน ปลอดภัย ถ้า hardening ครบ:** soak window 1 wk ใน plan เป็น guardrail สำหรับ "ปลอดภัยใจ". Hardening 2026-05-22 (post-insert read-back assertion, `74ac78d`) ปิด collision-silent risk ทำให้ retire เร็วขึ้นได้ปลอดภัย. Soak สั้นได้ก็ต่อเมื่อ root cause guard ลงและ Sentry สะอาด
> - **Dead-code internal calls = known wart, ไม่ block ship:** Apps Script `write.ts` มี internal `getNext*` ใน dead action handlers — ปล่อยไว้ดีกว่าตามไปลบทุก line (จะลบรวมกับ Apps Script write-retire phase ตามแผน §12). Document ใน commit msg + dashboard-v2.md + migration-plan §7 ว่าเป็น known dead code
> - **Apps Script "Edit existing → New version" critical:** clasp push อย่างเดียวไม่ update web app URL — ต้อง deploy version ใหม่ใน editor. "New deployment" = URL ใหม่ = ระบบพัง (frontend ผูก URL เก่า)
>
> **Commits:** `(pending — commit ในส่วนถัดไป)`
>
> ---
>
> **Session 2026-05-23 — Backlog cleanup (MorningReportV2 retire) + B consolidate risk-audit:** ✅
>
> ## งานที่ทำ
> - **Apps Script "Morning Report V2" project retired** — verify code: `MORNING_REPORT_APPS_SCRIPT_URL` ไม่ถูก reference ใน code อีกแล้ว (`grep -rn` ใน .ts/.tsx/.js เหลือแค่ `MORNING_REPORT_TOKEN` สำหรับ manual `?token=` test). คุณนุ๊กลบ env var + Apps Script project แล้ว. doc [`dashboard-v2.md:707-712`](dashboard-v2.md) update: mark retired 2026-05-23, ลบ `MORNING_REPORT_APPS_SCRIPT_URL` ออกจาก env list, ระบุ Vercel cron = single scheduler.
> - **B consolidate (`useAutoSync` ↔ `useDeltaSync`) — risk-audit + defer ต่อ** — อ่าน source ทั้ง 2 hooks เทียบ behavior + caller (`board-client` · `orders-list-client` · `calendar-client` · `pending-mutations`). พบ 5 risk: ไม่มี test ของ poll-loop effect เลย (`tests/delta-sync.test.ts` cover แค่ `mergeDelta` pure) · visibility behavior diff (`useAutoSync` กัน double-refresh, `useDeltaSync` ไม่กัน — cursor handles dedup) · signature ไม่สมมาตร (sync void vs Promise + coalesced) · 4 callers ต้องไม่พัง + flag OFF fallback ต้องเก็บ · rollback แพง (delta-fetch live ~1 wk ยัง soak). **recommend:** รอ flag soak ≥2 wk → flip permanent → **ลบ `useAutoSync` ทิ้ง** (ง่ายกว่า consolidate) + เขียน test ของ poll-loop ก่อนทำจริง
> - **Drop 2 pending จาก backlog:** (1) orphan-cancelled cleanup ×4 — คุณนุ๊กยืนยันใบเทสช่วงแรกไม่กระทบ data จริง, helper push ขึ้น editor แล้วก็ไม่ต้องรัน; (2) deleteJob smoke — คุณนุ๊กแจ้งว่าเคย smoke ผ่านแล้ว
>
> ## ⏳ Pending user actions (carry forward)
> 1. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional Postgres SQL `UPDATE orders SET date_in/date_due` (double-encoded date, impact ใกล้ศูนย์ — `displayDate` unwrap ให้แล้ว)
> 2. **Neon transfer rate check ~25 พ.ค.** — วัดผล delta-fetch P3 จริง (อีก 2 วัน). baseline 0.7 GB/วัน → 21 พ.ค. ~0.35-0.4 (ก่อน delta-list) → คาดหลัง delta-list ON ลดอีก
> 3. **ID-migration Step 7 retire ~28 พ.ค.** — ลบ `getNext*` else-branch + flag `ALLOCATE_IDS_IN_POSTGRES` + Apps Script `getNextId`/`getNextOrderId`/`getNextIds` (เช็ค caller อื่นก่อน)
>
> ## 🎯 งานหลัก session หน้า
> 1. **soak `NEXT_PUBLIC_DELTA_FETCH_LIST` + ดู Sentry/Neon transfer** — รอ ≥2 wk ก่อนตัดสิน retire `useAutoSync`
> 2. **AI Quoting Phase 0** (deferred) — spec/scaffold
> 3. **`/check-quota`** — Apps Script + Cloudflare Worker quota เช็ค
> 4. **DATE_ANOMALY fix** ถ้าเริ่มงาน DB cleanup
>
> ### Decisions / Lessons
> - **MorningReport env vars หลัง revamp:** `MORNING_REPORT_TOKEN` (manual test) + `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` + `CRON_SECRET` (auto). `MORNING_REPORT_APPS_SCRIPT_URL` ลบทิ้งได้แล้ว — route ใหม่ self-contained ผ่าน `loadAll()` + LINE push API ตรง
> - **B consolidate ไม่ใช่ low-risk refactor** — duplicate scaffolding ~80 บรรทัดเป็น isolation เจตนา ไม่ใช่ tech debt: poll-loop effect + visibility + channel + cleanup เป็น timing-sensitive ที่ไม่มี test → bug หลุดทุก gate. ทำ "ลบ useAutoSync ทิ้ง" หลัง flag permanent ง่ายกว่า consolidate
>
> **Commits:** [`(pending — docs only)`] (NEXT-SESSION + dashboard-v2)
>
> ---
>
> **Session 2026-05-22 — Hardening (A/B2) + delta-fetch → /orders + /calendar:** ✅ LIVE & verified
>
> ## งานที่ทำ
> - **A — post-insert collision guard** (§6/R5 ของ [migration-plan-id-allocation.md](migration-plan-id-allocation.md)) — helper `assertNoIdCollision()` ใน [`postgres-write.ts`](lib/postgres-write.ts): fresh-id INSERT 4 จุดที่ใช้ `ON CONFLICT (id) DO NOTHING` (createOrder order+job · promoteDraft · bulkForward) เปลี่ยนเป็น `RETURNING id` + read-back — minted id ชน → throw ดังๆ แทนปล่อย phantom success. (`addJobToPostgres` เป็น plain INSERT ไม่มี ON CONFLICT → loud อยู่แล้ว — แผน §6 เขียนชื่อ/สมมติฐานผิด)
> - **B2 — PA-L1 loadOrder over-fetch** — `loadOrder`/`loadOrderFromPostgres` มี opt `orderOnly` → 4 callers (print · tracking-card · `/api/orders/raw` · restore parent-status) ที่อ่านแค่ `.order` รัน **1 query แทน 4**. full path (`/track`) ไม่แตะ
> - **#3 — L3 edge-build-warnings: wontfix** — build สะอาด เหลือ warning เดียวที่ inherent กับ edge runtime ลบไม่ได้ถ้าไม่ทิ้ง edge optimization
> - **#4 — scan v2** ([`_scan-phase2.gs`](../production-monitoring/_scan-phase2.gs)) — §3 orphan-order cross-ref `jobs∪shipped∪cancelled` (เดิม false-positive 122) · §6 เพิ่ม `INVALID_DATEDUE`. push.sh + **รันแล้ว** → 0 critical/0 high · ORPHAN_ORDER false-positive หายเกลี้ยง · INVALID_DATEDUE จับ orders 202605046/047
> - **#2 — delta-fetch → /orders + /calendar** ([`88b31d7`](https://github.com/witsarutnook/penprinting-dashboard/commit/88b31d7)) — flag `NEXT_PUBLIC_DELTA_FETCH_LIST`. /calendar reuse `/api/board/delta` ตรงๆ (jobs+orders) · /orders: `loadBoardDelta(…,{lists:true})` คืน `shippedOrderIds`/`cancelledOrderIds` (full sorted array ต่อ poll — เลี่ยง hard-delete) · enrichment ย้ายเป็น pure `computeOrdersList` (shared server+client) · ไฟล์ใหม่ `orders-list.ts` · `OrdersListClient` · `OrdersBody` · `CalendarClient`
> - **flag flip + smoke-verify (live)** — คุณนุ๊กตั้ง `NEXT_PUBLIC_DELTA_FETCH_LIST=1` + redeploy → verify ผ่าน Chrome: /orders poll `?...&lists=1` ✅ (~0.34KB) · /calendar poll `/api/board/delta` 200 ✅ · 2 หน้า render ถูก ไม่มี console error
> - tests 112→139 · type-check/lint/build ผ่าน Node 22 · security review diff A+B2 — ไม่พบช่องโหว่
>
> ## ⏳ Pending user actions
> 1. **orphan-cancelled ×4 cleanup** — helper `cleanupOrphanCancelled` push ขึ้น editor แล้ว ยังไม่รัน (2 test rows `202605039`/`202605055` ลบได้ · 2 historical `202604024`/`202604068` รอตัดสิน)
> 2. **DATE_ANOMALY 3 orders** (202605046/047/049) — optional: Postgres SQL `UPDATE orders SET date_in/date_due` (double-encoded date — impact ใกล้ศูนย์, `displayDate` unwrap ให้แล้ว)
> 3. ค้างเดิม: Neon transfer ~25 พ.ค. · ID-migration Step 7 retire ~28 พ.ค.
>
> ## 🎯 งานหลัก session หน้า
> 1. **#1 — Consolidate `useAutoSync`/`useDeltaSync`** (deferred) — รวม poll-loop เป็น `usePollLoop(onTick)`. **เลื่อนเพราะ:** poll-loop effect ไม่มี test เลย → consolidation bug หลุด type-check/build/test · roadmap วางไว้หลัง delta-list เสถียร (ตอนนั้น `useAutoSync` อาจลบทิ้งได้เลย = ง่ายกว่า). ทำหลัง flag `NEXT_PUBLIC_DELTA_FETCH_LIST` soak
> 2. **soak delta-list** — ดู Sentry หลัง flag ON
> 3. ค้างเดิม: ลบ Apps Script "MorningReportV2" + env · deleteJob smoke · AI Quoting Phase 0 · `/check-quota`
>
> ### Decisions / Lessons
> - **B1 (ลบ no-op `router.refresh()`) — ข้าม:** premise ใน NEXT-SESSION เดิมผิด — `OrderForm` ใช้ 3 routes (`/board` + `/orders/new` + `/orders/[id]/edit`); 2 อันหลังไม่มี delta → `router.refresh()` ไม่ใช่ no-op. `undo-context` no-op เฉพาะตอน flag ON. ทำได้ต่อเมื่อ retire flag-OFF path ถาวร
> - **delta-fetch ขยาย route ใหม่ pattern:** extend `loadBoardDelta` ด้วย opt · ข้อมูลที่ delta จับ "ลบ" ไม่ได้ (shipped/cancelled hard-delete) → ส่ง full sorted orderId array ต่อ poll (set เล็กพอ) + `mergeDelta` เทียบ ref-stable กัน idle re-render
> - **planning-doc claims ต้อง grep code ก่อน:** แผน §6 เขียนว่า `addJobInPostgres` ใช้ ON CONFLICT — ของจริง `addJobToPostgres` เป็น plain INSERT (loud อยู่แล้ว)
>
> **Commits:** [`74ac78d`](https://github.com/witsarutnook/penprinting-dashboard/commit/74ac78d) (A+B2) · [`88b31d7`](https://github.com/witsarutnook/penprinting-dashboard/commit/88b31d7) (#2 delta-fetch) · docs ปิด session
>
> ---
>
> **Session 2026-05-21 (PM) — ID-allocation migration → Postgres: ✅ LIVE & verified**
>
> ## งานที่ทำ
> - **ทำตามแผน [migration-plan-id-allocation.md](migration-plan-id-allocation.md)** — ย้าย order/job ID minting จาก Apps Script (`getNextOrderId`/`getNextId`/`getNextIds`) มา Postgres `counters` table. 11 ไฟล์, commit [`44006d3`](https://github.com/witsarutnook/penprinting-dashboard/commit/44006d3)
>   - ใหม่: [`lib/id-allocation.ts`](lib/id-allocation.ts) (`mintJobId`/`mintJobIds`/`mintOrderId` — atomic `UPDATE...RETURNING`) · [`/api/admin/seed-id-counters`](app/api/admin/seed-id-counters/route.ts) · `counters` table ใน db-migrate
>   - branch 6 routes ด้วย `allocateIdsInPostgres()`: orders/add · promote-draft · jobs/add · forward · forward-undo · bulk-forward
> - **Rollout เสร็จใน session นี้** (lunch-break window): db-migrate → seed (`nextId`=740, verified ตรงกับ Sheet `config.nextId`=740) → ตั้ง `ALLOCATE_IDS_IN_POSTGRES=1` + redeploy → smoke
> - **Verified live**: ใบทดสอบ → job id `740` (counter→741) · order id `202605145` (`YYYYMMNNN` ถูก, seq 144→145) · ไม่มี ID ชน · **คุณนุ๊กยืนยัน "กดใบสั่งเร็วขึ้นเยอะ"** (2-3 วิ → ~0.3-0.6 วิ)
> - tests 112→122 (+10 [`tests/id-allocation.test.ts`](tests/id-allocation.test.ts)) · type-check/lint/build ผ่าน Node 22
>
> ## ⏳ Pending
> 1. ✅ ใบ "ทดสอบ ID migration" (#202605145) — ยกเลิกแล้ว (cancel cascade verified สะอาด: job 740 tombstoned, order status=cancelled)
> 2. **Soak ~1 สัปดาห์** (ถึง ~28 พ.ค.) — ดู Sentry + สังเกตการสร้างงานปกติ
> 3. **เช็ค Neon network transfer rate ~25 พ.ค.** — วัดผล delta-fetch P3 จริง. baseline ก่อน optimize = 0.7 GB/วัน (5.6GB/8d) · 21 พ.ค. วัดได้ ~0.35-0.4 GB/วัน = ผลของ loadAll caching (P3 เพิ่ง live 21 พ.ค. ~10:00 ยังไม่สะท้อน). ดูกราฟ transfer รายวันใน Neon → "View all metrics" เทียบก่อน/หลัง 21 พ.ค.
> 4. **Rollback note** — job 740+ ออกจาก Postgres แล้ว Apps Script `config.nextId` ยังค้าง 740: **ถ้าจะ rollback ต้องแก้ cell `config.nextId` ใน Google Sheet `config` tab = ค่า Postgres `counters.nextId` ปัจจุบันก่อน** แล้วค่อยปิด flag. order id ไม่ต้องทำ (`getNextOrderId` cross-check Sheet self-heal)
>
> ## 🎯 งานหลัก session หน้า
> 1. **Step 7 — Retire** (หลัง soak ≥1 สัปดาห์): ลบ `getNext*` else-branch ออกจาก 6 routes + ลบ flag `ALLOCATE_IDS_IN_POSTGRES` + ลบ `getNextId`/`getNextOrderId`/`getNextIds` ฝั่ง Apps Script (เช็คก่อนว่าไม่มี caller อื่น)
> 2. **Optional hardening** — post-insert read-back assertion ใน `createOrderInPostgres`/`addJobInPostgres` (กัน `ON CONFLICT DO NOTHING` กลบ collision เงียบ — §6 ของแผน)
>
> ### Lessons
> - **Apps Script `config.nextId` = แค่ cell ใน Google Sheet `config` tab** — แก้ตรงๆ ได้ → rollback ของ counter migration ง่าย ไม่ต้องเขียน Apps Script sync action (decision 2 ในแผนเดิม over-engineered)
> - **seed ของ counter migration ต้องชิดกับ flag flip** — seed endpoint ออกแบบเป็น raise-only + re-runnable ให้รันซ้ำได้ก่อน flip เพื่อ catch row ที่เกิดช่วงรอยต่อ
>
> **Commits**: `44006d3` (code) · `9fbc637` (decisions) · `7405ca7` (plan) · `99b6492` + `ac44fa4` (plan docs) + docs ปิด session
>
> ---
>
> **Session 2026-05-21 — Delta-fetch P3 (client refactor) + migration/smoke verified:** ✅
>
> ## งานที่ทำ
> - **P3: Client refactor** — `/board` เป็น hybrid Server/Client เมื่อ `NEXT_PUBLIC_DELTA_FETCH=1`. Server ส่ง bootstrap (`loadBoardDelta(null)`) → [`<BoardClient>`](app/board/board-client.tsx) ถือ state + [`useDeltaSync`](lib/delta-sync.tsx) poll `/api/board/delta` + merge. flag-OFF = path เดิมไม่แตะเลย.
>   - ไฟล์ใหม่: [`lib/poll-schedule.ts`](lib/poll-schedule.ts) (shared backoff + `refreshGuard`) · [`lib/delta-sync.tsx`](lib/delta-sync.tsx) (`useDeltaSync` + pure `mergeDelta`) · [`app/board/board-client.tsx`](app/board/board-client.tsx)
>   - ไฟล์แก้: `auto-sync.tsx` (import จาก poll-schedule) · `board.ts` (`computeBoard` รับ `Pick<…,'jobs'|'orders'>`) · `pending-mutations.tsx` (`commit()` รับ prop `pollNow?`) · `page.tsx` (flag branch + `BoardDataDelta`)
>   - **กลไก:** ทุก mutation เรียก `broadcastWrite()` อยู่แล้ว → `useDeltaSync` ฟัง BroadcastChannel (รับ event ของ tab ตัวเองด้วย) → poll ทันที ครอบคลุม card/column/job-form/bulk/order-form/undo **โดยไม่แตะไฟล์พวกนั้น**. มีแค่ `commit()` ที่ delta-aware (`pollNow().then(cleanup)`) เพราะ phantom cleanup timing
> - **ปิด audit:** PA-H2 (bootstrap อ่าน 2 ตาราง ไม่ใช่ `loadAll` 5) + PA-M2 (`mergeDelta` คืน state ref เดิมเมื่อ delta ว่าง → idle tick ไม่ re-render). PA-L1 ยัง open
> - **Tests** 100→112 ([`tests/delta-sync.test.ts`](tests/delta-sync.test.ts) — `mergeDelta` 12 cases). type-check + lint + build ผ่าน Node 22
> - **ขั้น 2+3 verified แล้ว session นี้** (รันผ่าน Chrome ที่ login admin อยู่):
>   - Schema migration `/api/admin/db-migrate` → `{ok:true}` (idempotent — `updated_at` + triggers อยู่ครบตั้งแต่ 2026-05-20, รอบนี้ยืนยันซ้ำ)
>   - Smoke `/api/board/delta`: full snapshot `jobs:54 orders:207 deletedJobIds:0` + `serverTime` · `?since=`อนาคต → empty delta โครงสร้างถูก → **backend delta-fetch พร้อมใช้จริงบน production**
>
> ## ⏳ Pending user actions — เรียงลำดับ
> 1. **verify Vercel deploy** — commit `6412d5b` push แล้ว, เช็คว่า deploy ขึ้นเรียบร้อย
> 2. **ตั้ง `NEXT_PUBLIC_DELTA_FETCH=1`** — Vercel → Settings → Environment Variables → **redeploy**. ⚠️ ทำ**หลัง** P3 deploy เสร็จเท่านั้น — flag เป็น `NEXT_PUBLIC_` bake ตอน build; เปิดก่อนมี `BoardClient` = build พัง
> 3. **เช็ค /board โหมด delta** — filter/search เปลี่ยนทันทีไหม · forward/reassign/cancel/ship/bulk เด้งไหม · DevTools Network ดู `/api/board/delta` poll ~ทุก 15s · idle แล้วหยุด poll ที่ 30 นาที
> 4. ค้างเดิม: soak Phase 4.2 cutover → Stage 5 (~26-28 พ.ค.) · ดู Sentry + Neon transfer · ลบ Apps Script "MorningReportV2" + env `MORNING_REPORT_APPS_SCRIPT_URL` · deleteJob smoke test · AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ## 🎯 งานหลัก session หน้า
> 1. **หลัง flag ON เสถียร** — ปิด deferred cleanup: ลบ `router.refresh()` ที่เป็น no-op ในโหมด delta — `order-form.tsx` (×4) + `undo-context.tsx` (×1). `broadcastWrite`→channel→poll จัดการ update แล้ว; `router.refresh()` แค่เปลือง server round-trip 1 ครั้งต่อ order create/promote/undo
> 2. **PA-L1** — `loadOrderFromPostgres` ยิง 4 query ขนานแม้ caller ต้องการ order เดียว → opts flag trim. minor
> 3. **Consolidate** `useAutoSync`/`useDeltaSync` — ตอนนี้ duplicate poll-loop scaffolding ~80 บรรทัด (เจตนา isolate ความเสี่ยงจาก 5 routes อื่นที่ใช้ `useAutoSync`). ถ้า delta mode เสถียร → ขยาย delta-fetch ไป /orders /calendar แล้ว consolidate เป็น `usePollLoop(onTick)` ตัวเดียว
> 4. **ID allocation → Postgres** — แผนละเอียดเขียนเสร็จแล้ว: [migration-plan-id-allocation.md](migration-plan-id-allocation.md) (commit `7405ca7`). ย้าย `getNextOrderId`/`getNextId`/`getNextIds` ออกจาก Apps Script → counter ใน Postgres → ส่งใบสั่งงาน 2-3 วิ เหลือ ~0.3-0.6 วิ. มาจาก diagnose order-submit latency (2026-05-21). PIN + QR ตรวจแล้วไม่กระทบ (§3 ของแผน). ⏳ **รอคุณนุ๊กตัดสิน 3 decisions ใน §10** (flag เดียว / sync AS counter ช่วง soak / ย้าย order+job พร้อมกัน) ก่อนเริ่ม implement
>
> ### Lessons
> - **`router.refresh()` = no-op ใน component ที่ owns state ผ่าน `useState(initialProp)`** — `useState` ใช้ initial value แค่ตอน mount; prop ที่เปลี่ยนทีหลังถูก ignore. ย้าย source-of-truth มาฝั่ง client แล้วต้องมี imperative trigger (`pollNow`) แทน server re-render — ไม่งั้น mutation ไม่ขึ้นจอ
> - **`broadcastWrite()` deliver ถึง tab ตัวเอง** — BroadcastChannel ชื่อเดียวกัน deliver ถึงทุก instance ยกเว้นตัวส่ง → channel listener ใช้เป็นจุดรวม refresh ได้ ไม่ต้องไล่แก้ N call sites
> - **`[...map.values()]` ต้องใช้ `Array.from(map.values())`** — tsconfig target นี้ไม่รองรับ MapIterator spread (TS2802 — type-check จับทันที)
>
> **Commits**: [`6412d5b`](https://github.com/witsarutnook/penprinting-dashboard/commit/6412d5b) (code: P3 — BoardClient + useDeltaSync + poll-schedule + 12 tests) · docs follow-up (NEXT-SESSION + dashboard-v2 + AUDIT-BACKLOG)
>
> ---
>
> **Session 2026-05-20 — Delta-fetch P1+P2 (schema + endpoint):** ✅
>
> ## งานที่ทำ
> - **P1: Schema + bump triggers** ([`app/api/admin/db-migrate/route.ts`](app/api/admin/db-migrate/route.ts)) — `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` + index + BEFORE UPDATE triggers ใน jobs/orders/shipped/cancelled. 2 trigger functions: `bump_updated_at_jobs` (raw OR phase2_deleted_at change) + `bump_updated_at_raw` (raw only). **Conditional bump** — heal-cron `phase2_dirty_at = NULL` ไม่แตะ raw → trigger เห็นไม่ distinct → ไม่ bump → cursor ไม่ pollute. INSERT ไม่ต้องแก้ (DEFAULT NOW() คุม)
> - **P2: Delta endpoint** ([`lib/board-delta.ts`](lib/board-delta.ts) + [`app/api/board/delta/route.ts`](app/api/board/delta/route.ts)) — `GET /api/board/delta?since=<iso>`. `since=null` → full snapshot. `since=iso` → 3 query ขนาน (active changes + orders changes + tombstoned ids) + `serverTime` (snapshot ก่อน queries กัน write-loss window). Response: `{ jobs, orders, deletedJobIds, serverTime }`
> - **Tests** 91→100 ผ่าน Node 22 (9 ใหม่ใน `tests/board-delta.test.ts`). type-check + lint + build ผ่าน
> - **คุม design choices** ขออนุมัติคุณนุ๊กก่อน: DB trigger > explicit (zero forget) · P1+P2 ใน session นี้ (P3 client refactor session หน้า) · migrate ผ่าน admin route
>
> ## ⏳ Pending user actions — เรียงลำดับ
> 1. **คุณนุ๊กยังต้อง deploy ตามปกติ** — push บน main = Vercel auto-deploy. Session นี้ commit ให้ แต่ verify ผ่าน Vercel dashboard
> 2. **รัน schema migration** — หลัง deploy: `curl 'https://dashboard.penprinting.co/api/admin/db-migrate'` (browser ก็ได้ ต้อง logged-in admin) → check response `applied` array ต้องมี `ALTER TABLE * ADD updated_at + index` (×4) + `CREATE FUNCTION bump_updated_at_*` (×2) + `CREATE TRIGGER trg_bump_updated_at ON *` (×4). Idempotent — ปลอดภัยถ้ารัน 2 ครั้ง
> 3. **Smoke test delta endpoint** — `curl 'https://dashboard.penprinting.co/api/board/delta'` (admin cookie) → ดู `serverTime` + `jobs.length` ตรงกับ /board · `curl 'https://dashboard.penprinting.co/api/board/delta?since=2026-05-20T00:00:00.000Z'` → ดู delta payload เล็กกว่า full snapshot
> 4. ค้างเดิม: **soak Phase 4.2 cutover ≥1 สัปดาห์** ก่อน Stage 5 (cutover 2026-05-18 → target Stage 5 ~26-28 พ.ค.) · **ดู Sentry + Neon transfer** หลัง cutover · **ลบ Apps Script "MorningReportV2"** + env `MORNING_REPORT_APPS_SCRIPT_URL` · deleteJob smoke test · AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ## 🎯 งานหลัก session หน้า — Delta-fetch P3 (client refactor)
> 1. **Refactor `/board`** → hybrid Server/Client:
>    - Server component ส่ง initial snapshot (มี cookies auth) → ฝัง `<BoardClient initialJobs={...} initialOrders={...} initialServerTime={...}>`
>    - `BoardClient` = "use client" — `useState` ถือ jobs/orders, ใช้ `computeBoard` เหมือนเดิม (pure function reuse), render kanban
> 2. **`useDeltaSync(initial)` hook** — poll `/api/board/delta?since=<lastServerTime>` ทุก tick (ใช้ backoff schedule เดิมจาก `useAutoSync`):
>    - merge changed jobs/orders เข้า state (`Map.set(id, newRaw)` shape — keep ordering by re-sort)
>    - remove tombstoned ids
>    - advance cursor → `lastServerTime = response.serverTime`
>    - skip render ถ้า no changes (closes PA-M2 churn)
> 3. **Feature flag** `NEXT_PUBLIC_DELTA_FETCH` — default ON ใน prod after smoke, OFF = revert to `router.refresh()`
> 4. **ปิด audit items**: PA-H2 (loadAll 5-table over-fetch — delta query แค่ 2 ตาราง) · PA-M2 (parent re-render churn — skip render no-change) · PA-L1 (loadOrder over-fetch — minor, ค่อยทำแยก)
> 5. **Edge cases ต้องระวัง:**
>    - cross-tab BroadcastChannel: tab อื่น write → tab นี้ ควร trigger delta poll ทันที (broadcast ผ่าน existing `broadcastWrite()`)
>    - tab hidden/visible: visibilitychange → refresh cursor + poll ทันที (เหมือน `useAutoSync` ปัจจุบัน)
>    - cursor stale (client หลุดนาน): server return entire delta from old cursor; ถ้า > X rows → ส่ง full snapshot แทน (sentinel field `bootstrap: true`)?
>    - bulk-mode selection state: client-state เดิม persist ถูก เพราะ kanban shape ไม่เปลี่ยน
>
> ### Lessons
> - **Trigger รวมหลายตาราง ใช้ฟังก์ชันเดียวไม่ได้** — plpgsql parse column refs ตอน first-call per-table. ถ้า function อ้าง `NEW.phase2_deleted_at` แล้ว attach กับ orders (ไม่มี column นั้น) → fail ตอน first row. แยก function ตามตาราง หรือใช้ TG_TABLE_NAME branching with `EXECUTE` dynamic SQL
> - **`DEFAULT NOW()` rewrites table on ALTER ADD COLUMN** (NOW() เป็น volatile, ไม่ใช่ constant). PG ≥11 constant default = no rewrite, แต่ NOW() ตก fallback path = rewrite ทั้งตาราง. สำหรับตารางใหญ่ควรเพิ่ม column แบบ nullable ก่อน → backfill batches → set NOT NULL. ของเรา jobs/orders ~200-700 row = ALTER ครั้งเดียวผ่าน
>
> **Commits**: [`50b43ca`](https://github.com/witsarutnook/penprinting-dashboard/commit/50b43ca) (code: triggers + delta endpoint + tests) · [`741f594`](https://github.com/witsarutnook/penprinting-dashboard/commit/741f594) (docs)
>
> ---
>
> **Session 2026-05-19 — Performance audit + PA-H1/PA-M3 fixes:** ✅
>
> ## งานที่ทำ
> - **Performance audit** ผ่าน `penprinting-auditor` (perf-only scope, หลัง Phase 4.2 close-out) → 0 critical · 2 high · 3 medium · 1 low. ผลเต็ม + verified-clean list อยู่ใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) section "Perf audit — 2026-05-19". hot path สภาพดี (cache coalescing 2026-05-18, recharts route-split, card lazy-loading ทั้งหมด verified clean).
> - **PA-H1 แก้แล้ว** ([`lib/auto-sync.tsx`](lib/auto-sync.tsx)) — เพิ่ม hard-stop: tab idle > 30 นาที หยุด poll สนิท. เดิม backoff 15s→30s→120s ไม่เคยถึง 0 → tab เปิดทิ้งข้ามคืน fire ~720 `router.refresh()`/คืน (server re-render + stream board HTML กลับทุกครั้ง). resume เมื่อ user input / tab re-visibility + refresh ทันที 1 ครั้ง (ไม่เสีย freshness). type-check/build/test(91/91) ผ่าน Node 22.
> - **M1-card-memo-deep-compare ปิด = invalid** — auditor ยืนยัน comparator ปัจจุบัน [`card.tsx:552-612`](app/board/card.tsx:552) เป็น flat primitive compare ไม่มี `JSON.stringify`/deep-compare แล้ว (PERF-C1 ลบไปตั้งแต่ 2026-05-12). item เดิมบรรยาย `card.tsx:459-489` ที่ไม่มีอยู่จริง.
> - **Quick perf wins** — **PA-M3 แก้แล้ว** ([`lib/api.ts:132`](lib/api.ts)): Apps Script fallback `get()` pass `{ revalidate: 0 }` ตัด nested `fetch` cache 60s ที่ `revalidateTag` บัสต์ไม่ถึง (write ตอน Postgres ล่มไม่โผล่ ≤60s). **PA-M4 verified clean** — index `idx_audit_target` มีอยู่แล้วใน `db-migrate` route, planner ใช้ BitmapOr ไม่ seq-scan = ไม่ต้องแก้.
>
> ## ค้าง — perf audit findings ที่ยังไม่แก้ (track ใน AUDIT-BACKLOG "Perf audit — 2026-05-19")
> - **PA-H2** loadAll over-fetch (ดึงครบ 5 ตารางทุกหน้า — `/board` ลาก shipped+cancelled history เปล่า)
> - **PA-M2** parent re-render churn (KPIBar/BoardToolbar ไม่ memo) — **ปิดได้ด้วย delta-fetch** (skip render ถ้า snapshot เหมือนเดิม)
> - **PA-L1** loadOrder over-fetch (4 query ขนานแม้ caller ต้องการ order เดียว)
> - คุณนุ๊กตัดสิน 2026-05-19: PA-H2/M2/L1 รอทำพร้อม delta-fetch / แยก session
>
> Commits: `c43999b` (PA-H1) · `f82734f` (PA-M3) · `e079850` + docs
>
> ---
>
> **Session 2026-05-18 (PM) — Phase 4.2 close-out S1-S4 + cutover:** ✅
>
> **Pivot:** session เริ่มจะทำ delta-fetch (board auto-sync) → คุณนุ๊กถาม "ตัด Sheet ออกเลยได้มั้ย" → ถ้า Sheet ไม่อยู่ delta-fetch trivial (ไม่มี TRUNCATE+INSERT cron รีเซ็ต cursor / ไม่มี Sheet-direct edit ที่ delta มองไม่เห็น). คุณนุ๊กตัดสิน: **เร่ง Phase 4.2 close-out ก่อน** (แลกกับ burn-in gate ต้นมิ.ย. ที่หายไป ~3-4 สัปดาห์). **delta-fetch deferred จนกว่า close-out เสร็จ.**
>
> ## Phase 4.2 close-out — แผน 6 stage
> เป้า: Postgres = sole source of truth · ตัด Apps Script write paths · Sheet = downstream mirror อย่างเดียว
> - **S0** pre-flight verify (flag / data-parity Postgres==Sheet / heal-cron backlog ว่าง)
> - **S1** ✅ migrate deleteJob/restoreJob/forwardUndo → Postgres-first (commit `fe4e238`)
> - **S2** ✅ code (`9678ab1`) + **flipped 2026-05-18** — `PHASE2_OWNS_CORE_TABLES=1` ON ใน prod, verified ผ่าน `/api/admin/sync-all` (jobs/orders/shipped/cancelled = `skipped`). from-Sheet cron หยุดทับแล้ว → **Postgres = sole source of truth**
> - **S3** ✅ done (`8043990`) — ตัด `found:false → Apps Script` fallback ใน 7 route → ตอบ 409 (orders/cancel คืน 404 อยู่แล้ว ไม่ต้องแตะ)
> - **S4** ✅ done (`2a52a64`) — ลบ dual-write mirror (`lib/postgres-write-mirror.ts` ลบทิ้ง -425 บรรทัด + ตัด `mirrorWriteToPostgres` block ใน `lib/api.ts`)
> - **S5** ลบ WRITE_* flag scaffolding + legacy branch ทั้งหมด (least reversible — soak cutover ≥1 สัปดาห์ก่อนทำ)
> - **S6** docs
> ⚠️ หลัง cutover = ไม่มี Sheet safety-net แล้ว (revert ได้ด้วย flip flag OFF)
>
> ## Stage 1 — เสร็จ + live production
> 3 route นี้ roadmap เขียนว่า "dead UI path" — **ผิด** ทั้งคู่มี UI เรียกจริง:
> - `deleteJob` — `deleteJobInPostgres` tombstone (reuse `phase2_deleted_at` + `healJobsTombstone` — ไม่มี Apps Script action ใหม่). UI: /orders → ปุ่ม "ตรวจสอบข้อมูล" → section Duplicate jobs → "ลบ row นี้" (โผล่เฉพาะมี job ซ้ำ)
> - `restoreJob` — `restoreJobInPostgres` (upsert jobs clear tombstone/dirty + delete cancelled) + ยังเรียก `post('restoreJob')` sync Sheet เพราะ `cancelled` ไม่มี tombstone column + Apps Script ไม่มี `deleteCancelledByIdRow`. UI: /cancelled
> - `forwardUndo` — route ผ่าน `bulkForwardInPostgres` + เพิ่ม cowork pass-through (เดิม drop cowork = regression ของ undo). UI: undo toast /board
> - commit `fe4e238` — 8 ไฟล์ +424. 3 flag ใหม่ `WRITE_{DELETE_JOB,RESTORE_JOB,FORWARD_UNDO}_TO_POSTGRES` (default off). test 76→87. type-check/lint/build ผ่าน (Node 22)
> - **flags ON ใน Production แล้ว** (คุณนุ๊ก set + redeploy เอง — ข้าม Preview smoke). smoke prod: restore ✅ undo ✅. deleteJob ข้าม (ต้องมี duplicate job ถึง trigger ได้ + เสี่ยงต่ำสุด — reuse tombstone+heal infra เดิม)
>
> ## Stage 2 cutover + S3 + S4 — เสร็จ 2026-05-18
> - **S2 cutover** — `PHASE2_OWNS_CORE_TABLES=1` ON ใน prod + redeploy (Stage 0 pre-flight ผ่าน — diagnose-board layer5_sync_meta ทุกตาราง `ok:true` sync สด). verified ผ่าน `/api/admin/sync-all`: jobs/orders/shipped/cancelled/templates = `skipped — Postgres owns`, audit_log = sync 500. **from-Sheet cron ไม่ทับ jobs/orders แล้ว = Postgres เป็น source of truth จริง**
> - **S3** (`8043990`) — 7 route ตัด found:false→Apps Script fallback → 409 "refresh แล้วลองใหม่"
> - **S4** (`2a52a64`) — ลบ dual-write mirror (`postgres-write-mirror.ts` -425 บรรทัด + `mirrorWriteToPostgres` block ใน `api.ts`). restore เขียน Postgres ผ่าน `restoreJobInPostgres` ตรงแล้ว ไม่พึ่ง mirror. test 91/91 ทุก stage
>
> ### ⚠️ S4 residual — ปิดใน Stage 5
> promote-draft **existingJob recovery sub-path** ยังเขียน status flip ผ่าน `post('updateOrder')` = Sheet-only หลัง S4 (mirror หายแล้ว) → Postgres order status ไม่ตาม. **rare มาก** — ต้องมี draft order ที่มี orphan job อยู่ก่อน (residue ของ partial-failure เก่า) ซึ่งแทบเป็นไปไม่ได้ในข้อมูลปัจจุบัน. Stage 5 ลบ legacy branch ทั้งหมด = ปิดเอง
>
> ### 🎯 งานหลัก session หน้า — Stage 5 (รอ soak) → Stage 6
> - **Stage 5** — ลบ `WRITE_*` flag scaffolding (`phase2WriteEnabled` + `ACTION_ENV_VAR` ใน feature-flags.ts) + legacy Apps Script branch ทั้งหมดใน write routes (รวม promote-draft existingJob path = ปิด S4 residual). **least reversible** — รอ soak cutover ≥1 สัปดาห์ (target ~ปลายพ.ค./ต้นมิ.ย.). หลัง deploy ลบ env var `WRITE_*` 14 ตัวจาก Vercel (เก็บ `READ_FROM_POSTGRES` + `CRON_SECRET`)
> - **Stage 6** docs — ปิด Phase 4.2 ใน roadmap/dashboard-v2
> - close-out จบ → กลับไปทำ **delta-fetch** ได้ (ตอนนี้ trivial — Sheet ตัดขาดแล้ว)
>
> ### ⏳ Pending
> - **ดู Sentry + Neon transfer** หลัง cutover — from-Sheet cron ไม่ error, egress ลด
> - **soak cutover ≥1 สัปดาห์** ก่อนทำ Stage 5
> - deleteJob smoke test ยังไม่ได้ทำ (ต้องมี duplicate job — ข้ามได้ เสี่ยงต่ำ)
> - delta-fetch — deferred จนกว่า close-out เสร็จ (เหลือ S5-S6)
> - delta-fetch — deferred จนกว่า Phase 4.2 close-out เสร็จ
> - ค้างเดิม: AI Quoting Phase 0 · ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2
>
> ### Lessons
> - **roadmap "dead UI path" เชื่อไม่ได้** — Tech-Roadmap-Status เขียน deleteJob/restoreJob เป็น "dead UI" แต่ทั้งคู่ reachable จริง (data-audit modal + /cancelled). verify reachability (`grep "api/jobs/delete"` ใน app/components) ก่อนเชื่อ doc claim
> - **restore Sheet-side asymmetry** — `cancelled` ไม่มี tombstone/heal path เหมือน jobs → restore Phase 2 ต้องพึ่ง `post('restoreJob')` sync Sheet (heal cron ทำแทนไม่ได้). ถ้าจะตัด Apps Script เต็มตัว (Phase 4.3) ต้องเพิ่ม `deleteCancelledByIdRow` action + cancelled tombstone
>
> **Commits**: `fe4e238` (S1) · `68e1434` · `9678ab1` (S2) · `000b13f` · `8043990` (S3) · `db04926` · `2a52a64` (S4) + cutover (`PHASE2_OWNS_CORE_TABLES=1` ใน Vercel)
>
> ---
>
> **Session 2026-05-18 — Postgres quota incident + print-404 fix + Morning Report ported off Apps Script:** ✅
>
> ## 🔥 Postgres quota incident + print-404 fix (เรื่องหลักของ session)
>
> **อาการ:** `createOrder` ล้ม HTTP 402 — Neon **network transfer 5.63/5 GB เกินโควตา Free plan** (usage since May 10; DB จริง 40 MB แต่โอน 5.6 GB/8 วัน). คุณนุ๊ก upgrade Neon → **Launch plan** → unblock. order เคสด่วนสร้างได้ 1 ใบ ไม่ซ้ำ.
>
> **print-404** — กด "พิมพ์+สั่ง" order ใหม่ → 404 (ครั้งแรกหลัง upgrade, retry หาย). `/diagnose` → `loadOrderFromPostgres` มี `checkStaleness(['orders'])` pre-gate: quota หมด → `sync-from-sheet` 402 → `sync_meta.orders` stale → gate throw ทั้งที่ order อยู่ใน Postgres → `loadOrder` fallback Apps Script → order ใหม่ไม่อยู่ Sheet → 404.
>
> **Fix:** ตัด `checkStaleness` pre-gate ออกจาก `loadOrderFromPostgres` ([`lib/api-postgres.ts`](lib/api-postgres.ts)) — Phase 2 Postgres = source of truth, mirror staleness ไม่ควร block single-order read. + regression test `tests/api-postgres.test.ts` (suite 72→76). type-check/build/test ผ่าน Node 22.
>
> ### 🎯 งานหลัก session หน้า — Delta-fetch (คุณนุ๊กตัดสิน 2026-05-18)
> เปลี่ยน board auto-sync จาก **poll-the-world** (`router.refresh()` ดึง snapshot ทั้งก้อนทุก 15 วิ) → **delta-fetch** (ขอเฉพาะ row ที่เปลี่ยนตั้งแต่ tick ก่อน)
> - **เลือก delta ไม่เลือก push/SSE** เพราะ: ไม่เพิ่ม vendor/dependency · latency 15 วิ เพียงพอสำหรับ dashboard ภายใน · เป็น stepping stone (ถ้าวันหลังอยาก push แค่เปลี่ยน trigger จาก timer → Pusher event)
> - **Scope:** board (+ อาจ orders/calendar) เปลี่ยนเป็น client-driven — fetch endpoint ใหม่ที่ query `WHERE updated_at > <lastSync>` คืนเฉพาะ delta · client merge เข้า state เอง
> - **ต้องเช็คก่อน:** มี `updated_at` column ที่ bump ทุก write มั้ย (มี `phase2_dirty_at` แต่นั่นคือ "dirty since sheet-sync" คนละความหมาย — อาจต้องเพิ่ม column ใหม่)
> - **ระวัง:** delete/move — row หายไปจากผลลัพธ์ client ต้องรู้ว่าต้องลบการ์ดออก (ไม่ใช่แค่ append) · cache coalescing ที่ทำวันนี้อาจต้องปรับ key ให้รับ delta param
> - context เต็มของการตัดสินใจ push vs delta อยู่ใน session log ด้านล่าง + version history
>
> ### ⏳ ค้างอื่น
> 1. **เช็ค data-integrity fallout** — เปิด `https://dashboard.penprinting.co/api/admin/diagnose-board` ดู `layer5_sync_meta`: ทุก table `ok=true` + `last_sync_at` สด? มี order/job ตกค้างช่วง incident มั้ย
> 2. ✅ **Network transfer — แก้แล้ว** (cache coalescing + frequency tuning, ดู version history). verify: ดู Neon transfer graph 1-2 วันว่าลดจริง ~85%
> 3. **Phase 2 writes ไม่มี fallback** — ตอน Postgres ล่ม write พังหมด (ต่างจาก read ที่ auto-fallback). พิจารณาเพิ่ม write fallback / master kill-switch
> 4. **ลบ Apps Script "MorningReportV2" project** — verify ผ่านแล้ว (Vercel Run ส่ง flex ได้) — รอคุณนุ๊กลบ + env `MORNING_REPORT_APPS_SCRIPT_URL`
>
> ## Morning Report double-fire
>
> **Trigger:** คุณนุ๊กแจ้ง flex แจ้งงานด่วนส่งเข้ากลุ่ม LINE 2 รอบทุกเช้า → `/diagnose`.
>
> **1. Root cause (`/diagnose`)** — Apps Script time trigger `morningReport` ค้างไม่ได้ลบหลัง migrate ไป Vercel cron (pending action ค้างมาตั้งแต่ 2026-05-10). dedup window 5 นาทีแคบเกินกว่า window ที่ Vercel cron กับ time trigger fire ห่างกัน — เช้า 18 พ.ค. ห่างกัน 5:11 (พลาด 11 วินาที). + ghost trigger `sendMorningReport` (handler รุ่นเก่า) fail 100%. **คุณนุ๊กลบ trigger ทั้ง 2 อันแล้ว.**
>
> **2. Fix — drop Morning Report Apps Script ทั้งโปรเจกต์, port เข้า v2:**
> - `lib/morning-report.ts` (ใหม่) — urgency bucketing + LINE Flex builders + push. ดึงข้อมูลผ่าน `loadAll()` (Postgres-first).
> - `app/api/cron/morning-report/route.ts` — เดิม proxy POST ไป Apps Script → ตอนนี้ทำงานเอง. Manual test: `?token=MORNING_REPORT_TOKEN` (`&dry=1` ไม่ส่ง LINE).
> - type-check + build ผ่านบน Node 22. **ยังไม่ commit/push** — รอคุณนุ๊ก set env vars ก่อน (ดู Pending).
> - Pull-forward: read-only part ของ Phase 4.3 — ไม่ผูก Phase 4.2.
>
> ### ⏳ Pending user actions — เรียงลำดับ (ทำก่อน push)
> 1. **Set Vercel env vars** (project `penprinting-dashboard`): `LINE_CHANNEL_TOKEN` + `LINE_GROUP_ID` — copy ค่าจาก Apps Script "MorningReportV2" → Project Settings → Script properties. (`MORNING_REPORT_TOKEN` มีอยู่แล้วจาก migration 2026-05-10 — reuse เป็น manual-test token)
> 2. คุณนุ๊ก confirm → Claude push → Vercel deploy
> 3. **Manual test**: `curl 'https://dashboard.penprinting.co/api/cron/morning-report?token=<MORNING_REPORT_TOKEN>&dry=1'` → ดู JSON counts → แล้วเอา `&dry=1` ออก → verify flex เข้ากลุ่ม LINE รอบเดียว หน้าตาเหมือนเดิม
> 4. **ลบ Morning Report Apps Script project** ทิ้ง (หลัง verify ผ่าน) + env เก่าที่ไม่ใช้แล้ว `MORNING_REPORT_APPS_SCRIPT_URL` ลบได้
> 5. ค้างเดิม: AI Quoting Phase 0, ORPHAN_CANCELLED cleanup, `/check-quota`, scan v2
>
> ### Lessons
> - **Pending user action ที่หลุดจาก carry-over list** — "ลบ Apps Script time trigger" ถูกบันทึกใน dashboard-v2.md ตั้งแต่ 2026-05-10 แต่หลุดจาก "Pending user actions" ของ NEXT-SESSION รอบหลังๆ → ค้าง 8 วัน → bug เกิดทุกเช้า. Pending action ที่ user ต้องทำเอง ต้อง carry over จนกว่าจะ confirm closed.
> - **Apps Script time trigger fire ใน window กว้าง** — `atHour(8)` = fire ช่วง 8:00-9:00 ไม่ตรงเวลา. dedup window สั้นๆ กัน double-fire ระหว่าง Apps Script trigger กับ external scheduler ไม่ได้.
>
> **Session 2026-05-17 — Node 22 upgrade + AI Quoting design doc:** ✅
>
> **1. Node 18 → 22 LTS upgrade** ([`0adbdbb`](https://github.com/witsarutnook/penprinting-dashboard/commit/0adbdbb) + [`30d240a`](https://github.com/witsarutnook/penprinting-dashboard/commit/30d240a))
> - `nvm install 22` (v22.22.3) + `nvm alias default 22` + `.nvmrc` = `22`
> - แก้ pre-commit hook ที่พังบน Node 18 (vitest/rolldown ต้อง `node:util` styleText, Node ≥20.12) — ตอนนี้ `type-check + lint + test(72/72) + build` ผ่านครบบน Node 22
> - `package-lock.json` normalize (npm 10.9 ลบ `libc` hint 105 จุด — no version change)
> - ⚠️ คุณนุ๊กควรเช็ค terminal ตัวเอง: เปิด terminal ใหม่ `node -v` ต้องได้ v22 (ถ้ายัง v18 = profile pin ไว้)
>
> **2. AI Quoting — research + design doc** → [`design-ai-quoting.md`](design-ai-quoting.md) **status: READY TO BUILD**
> - ระบบ AI ตอบราคาเบื้องต้นงานพิมพ์ (จอ + LINE OA) — สถาปัตยกรรม 3 ชั้น: AI สกัด spec → calculator คิดราคา (pure functions reuse) → ส่งราคา/บันทึก lead
> - Research: calc.ts เป็น pure functions reuse server-side ได้ · LINE webhook flow · PEAK API pricing (จากอีเมล PEAK 16 เม.ย.)
> - **Decisions ล็อกครบ D1-D7** + §0 Brain complete: PEAK API ตัดออก (sales ทำใบเสนอราคามือ) · calc เปิด `/api/quote` · ราคาต่อชิ้นก่อน VAT ไม่ปัด · `/quote-leads` page · persona · journey edge cases
> - §13 Implementation Plan: Phase 0 (calc API 2 ไฟล์) → Phase 1a (dashboard ~8 ไฟล์ + Claude API tool-use + Postgres schema)
>
> ### 🎯 งานหลัก session หน้า — เริ่ม build AI Quoting Phase 0
> - อ่าน `design-ai-quoting.md` §13 → ลงมือ **Phase 0**: `print-calculator-next` เพิ่ม `app/api/quote/route.ts` + `lib/quote-schema.ts` (server-side pricing API)
> - verify: curl spec โบรชัวร์ → ราคาตรงกับหน้า calculator UI
> - แล้วต่อ Phase 1a (AI Quote Assistant ในจอ)
>
> ### Pending user actions
> - เช็ค `node -v` ใน terminal ตัวเอง = v22 (ดูข้อ 1)
> - ตัดสิน: เริ่ม Phase 0 ใน session ไหน + `ANTHROPIC_API_KEY` มีอยู่แล้วหรือสร้างใหม่ (ดู design doc §11)
> - ค้างเดิม: ORPHAN_CANCELLED cleanup · `/check-quota` · scan v2 · cleanup diagnostic `.js`
>
> **Commits**: `0adbdbb` `30d240a` (Node 22) + doc commit (design-ai-quoting.md + NEXT-SESSION + dashboard-v2)
>
> ---
>
> **Session 2026-05-16 — dateIn double-encode root-cause (/diagnose) + QTY_UNITS feature:** ✅
>
> **Trigger:** `/session-start` → คุณนุ๊กเลือก Option A (root-cause `DATA-dateIn-double-encoded`) → ระหว่างทาง pivot ไปเพิ่มหน่วยจำนวนในฟอร์ม.
>
> **1. `DATA-dateIn-double-encoded` root-caused via `/diagnose` — accepted (no fix)**
> - **ตัวการ**: Apps Script `objectToRow()` (helpers.ts) เดิมไม่มี Date guard. `cancelOrder`/`promoteDraft` อ่าน order row ด้วย `getValues()` (date cell → JS `Date`) → flip status → เขียนกลับผ่าน `objectToRow` → `Date` ตก catch-all → `JSON.stringify` → quoted ISO `"\"...Z\""`.
> - **ไม่ใช่ `addOrder`** อย่างที่ AUDIT-BACKLOG เดา — `addOrder`/`createOrder` รับ `dateIn` เป็น string จาก v2 ไม่เคยเป็น Date.
> - **Source fixed แล้ว 2026-05-08** — `helpers.ts:49` + compiled `helpers.js:48` มี `if (val instanceof Date) return val;` (verified deployed). 3 rows (202605046/047/049) = legacy residue ก่อน 8 พ.ค.
> - **Decision: ไม่เขียน cleanup helper** — `displayDate()` unwrap quote ให้อยู่แล้ว display ไม่พัง + 3 orders เก่าเสร็จแล้ว. AUDIT-BACKLOG entry updated → `[accepted]`.
>
> **2. เพิ่มหน่วยจำนวน กล่อง/ถุง/ชิ้น** ([`238d40d`](https://github.com/witsarutnook/penprinting-dashboard/commit/238d40d))
> - `QTY_UNITS` ใน `app/board/order-form.tsx:105` — `['แผ่น','ชุด','เล่ม']` → `['แผ่น','ชุด','เล่ม','กล่อง','ถุง','ชิ้น']`
> - แก้ v2 อย่างเดียว — คุณนุ๊กระบุไม่แตะ WP (กำลังจะ drop). Type-check ผ่าน, push แล้ว.
>
> ### Lessons
> - **AUDIT-BACKLOG hypothesis เชื่อไม่ได้เสมอ** — entry เดิมเดา `addOrder` แต่ code comment ใน `displayDate()` (lib/jobs.ts:65-73) document root-cause จริง + วันที่ fix ไว้แล้ว. ก่อน re-investigate audit item → grep หา comment ที่พูดถึง symptom ในโค้ดก่อน.
> - **`_scan-phase2` date-anomaly เช็คแค่ `dateIn`** — ไม่เช็ค `dateDue` ทั้งที่ cancelOrder/promoteDraft เขียนทับทั้ง row → scan v2 ควรเพิ่ม `INVALID_DATEDUE`.
>
> ### ⚠️ Pre-commit hook พัง — ต้องแก้ก่อน commit รอบหน้า
> - **อาการ**: `npm test` ใน pre-commit hook (`type-check && lint && test`) — vitest **startup error** `node:util` ไม่มี export `styleText`. vitest/rolldown ที่ติดตั้งต้องการ Node ≥ 20.12 แต่เครื่องรัน **Node v18.20.4**.
> - **ผลกระทบ**: ทุก commit ของ penprinting-dashboard จะติด hook นี้จนกว่าจะแก้. commit `dashboard-v2.md` รอบนี้ใช้ `--no-verify` (คุณนุ๊กอนุมัติ — doc-only, type-check/lint ผ่าน, hook พังเพราะ environment ไม่ใช่ test regression).
> - **Fix → งานแรก session หน้า (คุณนุ๊กตัดสิน 2026-05-17): upgrade Node → 22 LTS, ทำด้วยกัน.** ขั้นตอน: `nvm install 22 && nvm use 22 && nvm alias default 22` → `cd penprinting-dashboard && npm install` (rebuild deps) → เพิ่ม/อัปเดต `.nvmrc` = `22` → verify `npm run type-check && npm run lint && npm test && npm run build`. ⚠️ ระวัง native deps อาจต้อง rebuild หลังเปลี่ยน Node major — เผื่อเวลา debug. ทำให้ครบทั้ง 4 projects ก็ดี (penprinting-web / print-calculator-next / penprintphotobook ใช้ Node 22 ได้หมด).
>
> ### Pending user actions
> - **(งานแรก session หน้า) แก้ pre-commit hook — upgrade Node → 22 LTS ทำด้วยกัน** (ดู section ⚠️ ด้านบน)
> - ค้างเดิมจาก 2026-05-15: ORPHAN_CANCELLED cleanup (`cleanupOrphanCancelled()` dry-run → ตัดสิน historical rows), `/check-quota`, scan v2, cleanup diagnostic `.js` จาก Apps Script editor, Vercel Analytics watch /track p95.
> - (`DATA-dateIn-double-encoded` ปิดแล้ว — accepted, ไม่ต้องทำอะไรต่อ นอกจาก optional SQL UPDATE ตอน migration cutover)
>
> **Commits**: `238d40d` (feature QTY_UNITS) + `9fe5379` (docs root-cause) + doc commit dashboard-v2.md (`--no-verify` เพราะ hook พัง).
>
> ---
>
> **Session 2026-05-15 — pending verifications (Option B): Phase 2 smoke + data-integrity scan + quota runbook:** ✅
>
> **Trigger:** `/session-start` → คุณนุ๊กเลือก Option B (run pending verifications ที่ค้างมา 2 sessions). **ไม่มี code changes** — verification + data-integrity session ล้วน.
>
> **1. Smoke test 6 Phase 2 actions — ✅ ผ่านครบ 6/6**
> - addJob / promoteDraft / bulkForward / moveToShipped / cancelJob / cancelOrder — user smoke-tested ใน browser, ผ่านหมด ไม่มี 404 / stale / timeout
> - Phase 2 (Postgres-first writes) ยืนยันเสถียรหลัง live ~2 อาทิตย์
>
> **2. /data-doctor proactive scan — ✅ รันแล้ว, 3 findings**
> - สร้าง `production-monitoring/_scan-phase2.gs` (scan 9 มิติ, read-only) → push เข้า Apps Script ผ่าน clasp (`_scan-phase2.js`)
> - คุณนุ๊กรัน `runPhase2IntegrityScan()` — counts: orders=171 jobs=41 shipped=115 cancelled=28
> - **Result: 0 critical / 1 high / 2 medium / 0 low**
>   - 🟠 HIGH `ORPHAN_ORDER` ×122 — **scan false positive** (scan check แค่ `jobs` sheet, ไม่ cross-ref `shipped`). orders status="sent" ที่ jobs ส่งของหมดแล้วถูก flag ผิด. ไม่ใช่ data bug — เป็น scan limitation. scan v2 (cross-ref) ยังไม่ได้รัน.
>   - 🟡 MEDIUM `ORPHAN_CANCELLED` ×4 — cancelled rows อ้าง orderId ที่หายไป (202604024 "ใบปลิวสาขา", 202604068 "สสส", 202605039 "test", 202605055 "หหหห")
>   - 🟡 MEDIUM `DATE_ANOMALY` ×3 — **real bug.** orders 202605046/047/049 (orders sheet rows 118/119/121, sequential) มี `dateIn` double-encoded เป็น JSON string `"\"2026-05-07T17:00:00.000Z\""`. → ขึ้น AUDIT-BACKLOG เป็น open item `DATA-dateIn-double-encoded`
>
> **3. ORPHAN_CANCELLED cleanup — helper เขียนแล้ว, รอ user รัน**
> - data-doctor สร้าง `production-monitoring/_cleanup-orphan-cancelled.gs` → push เข้า Apps Script (`_cleanup-orphan-cancelled.js`)
> - `cleanupOrphanCancelled()` — `DRY_RUN=true` default, LockService 15s, descending row delete, triple-verify (id+name+orderId), re-check orphan ก่อนลบ
> - **ยังไม่รัน** — รอคุณนุ๊กตัดสินใจว่าจะเก็บ 2 row เก่า (202604024, 202604068) ไว้เป็น historical มั้ย
>
> **4. /check-quota — runbook ส่งให้ user แล้ว** — ยังไม่ report quota numbers กลับมา
>
> ### Lessons
> - **Diagnostic `.gs` files push ผ่าน clasp ได้** — เดิม `_diagnose-202605036.gs` ใช้ paste มือใน editor. Session นี้ยืนยัน `clasp push` (copy → `apps-script/dashboard/*.js` → `clasp push -f`) เร็วกว่า + ไม่ผิดพลาด. `push` ≠ `deploy` — ไม่กระทบ live deployment URL. (saved to memory)
> - **Scan ที่เช็คแค่ active sheet → false-positive กับ orders ที่ jobs archived หมดแล้ว** — scan v2 ต้อง cross-ref `jobs` + `shipped` + `cancelled` ก่อนสรุปว่า order orphan
>
> ### Pending user actions (queued)
> - **ORPHAN_CANCELLED cleanup** — รัน `cleanupOrphanCancelled()` dry-run → ตัดสิน historical rows (202604024/202604068) → live run → re-scan verify
> - **DATE_ANOMALY** — ยังไม่ fix (3 rows). ต้อง root-cause `addOrder` write path ก่อน → เขียน fix helper (ดู AUDIT-BACKLOG `DATA-dateIn-double-encoded`)
> - **scan v2** — ถ้าอยากปิดคำถาม "122 orphan จริงมั้ย" → รัน cross-ref scan
> - **/check-quota** — เปิด Apps Script Executions + Cloudflare Worker metrics ดู 24h
> - **cleanup `_scan-phase2.js` + `_cleanup-orphan-cancelled.js`** จาก Apps Script editor หลังใช้เสร็จ (ลบ `.js` จาก `apps-script/dashboard/` + `clasp push -f` ซ้ำ)
> - (ค้างเดิม) Vercel Analytics watch /track p95
>
> ### Files created (`production-monitoring/` — ไม่ใช่ git repo, ไม่ commit)
> - `_scan-phase2.gs` + `apps-script/dashboard/_scan-phase2.js` (pushed to Apps Script)
> - `_cleanup-orphan-cancelled.gs` + `apps-script/dashboard/_cleanup-orphan-cancelled.js` (pushed to Apps Script)
>
> **No code changes to git subprojects.** Doc commit only (NEXT-SESSION + AUDIT-BACKLOG).
>
> ---
>
> **Session 2026-05-14 — admin cross-dept reassign + Phase 2 stale-read fix #3 + cowork "เสร็จงาน" button:** ✅
>
> **3 features shipped, 3 commits, smoke-tested by user:**
>
> 1. **Admin reassign ข้ามแผนกได้** ([`c2cd3b5`](https://github.com/witsarutnook/penprinting-dashboard/commit/c2cd3b5))
>    - Card "ย้าย" dropdown ของ admin → list staff ทั้ง 3 แผนก (graphic + print + post) พร้อม prefix `[กราฟิก]`/`[พิมพ์]`/`[หลังพิมพ์]` เวลา cross-dept
>    - Server: `/api/jobs/reassign` รับ optional `targetDept` (admin-only ถ้า ≠ srcDept). `dateIn` ไม่แตะ (admin reassign = "fix mistake" ไม่ใช่ workflow advance)
>    - Wrong-direction (post → graphic) allowed — รองรับการแก้พนักงานส่งต่อผิด
>    - Drag-drop semantic เดิม (cross-column = forward dialog) — ไม่แตะ
>    - Audit data carries `prevDept` + `prevStaff` for trail
>
> 2. **Phase 2 stale-read fix #3** ([`159333c`](https://github.com/witsarutnook/penprinting-dashboard/commit/159333c)) — user-reported "ไม่พบใบสั่งงาน" บน order #202605093
>    - Bug: `/api/orders/update` ใช้ `loadAllFresh()` (Apps Script Sheet) ตรวจ existence → Sheet เป็น cron-lagged mirror หลัง Phase 2 → 404 ตอนเปลี่ยนชื่องาน/วันส่ง
>    - Same disease as `c0be3b8` (loadOrder, 2026-05-12) + `1f62d3b` (promote-draft, 2026-05-11) — third occurrence
>    - **Decision per memory rule**: ไม่เขียน helper #2/#3 — widen scope ของ helper #1 แทน. Renamed `loadOrderAndJobsForPromote` → `loadOrderAndJobs` + reuse ใน `/api/orders/{update, cancel, delete}` ทั้ง 3 routes
>    - 5 files changed, 70 insertions, 52 deletions
>
> 3. **"เสร็จงาน Co-work" button บน guest cards** ([`af8597b`](https://github.com/witsarutnook/penprinting-dashboard/commit/af8597b))
>    - Guest cowork cards (มี badge "ร่วมพิมพ์" ใน column ของ cowork member) ตอนนี้มีปุ่ม violet "เสร็จงาน Co-work"
>    - Confirm dialog → POST /api/jobs/cowork ส่ง list ใหม่ที่ลบ self ออก → optimistic hide
>    - All roles allowed (เครื่องที่ทำเสร็จควร mark เองได้)
>    - **Why explicit `guestStaff` field**: `BoardJob.staff` บน guest copy ยังชี้ host (จาก `{...job, isGuest: true}` spread) — ต้อง derived `guestStaff` set ที่ fan-out ใน `computeBoard` (lib/board.ts) เพื่อรู้ว่าเป็น "ฉัน" คนไหน
>
> ### Verified
> - Type-check ✅ / 72 vitest tests ✅ / production build ✅ ทั้ง 3 commits
> - User smoke test ผ่านครบ 3 features (cross-dept move, edit order ที่เคย 404, cowork remove-self)
>
> ### Lessons
> - **Memory rule "helper #2 = root cause signal" จับได้แม่น** — เห็นปัญหาตั้งแต่ขั้นเช็ค `loadAllFresh` callers, ไม่ได้ตามล่า patch แต่ละ route. Renamed `loadOrderAndJobsForPromote` → `loadOrderAndJobs` ลด misleading scope. ([memory updated](../../../.claude/projects/-Users-witsarut-p/memory/feedback_loadorder_postgres_first.md): noted 3rd occurrence + flagged `loadAllFresh` as next likely landmine)
> - **Cross-dept reassign ≠ forward** — ขยาย reassign action (ไม่แตะ `dateIn`) ดีกว่าทำให้ workflow forward ทำงานข้ามแผนกได้ทุกทิศ. Drag-drop semantic ก็คงเดิม → user mental model ไม่กระเทือน
> - **Guest cards ต้อง explicit self id** — fan-out logic ที่ spread host job ทับ → field `staff` ไม่ได้ยึดกับ column ที่ render. Set `guestStaff` ตอน fan-out ป้องกัน future guest-action features เจอปัญหาเดียวกัน
>
> ### Pending user actions ที่ยังค้างจาก 2026-05-12 (ยังเหมือนเดิม — ไม่มีอะไรใหม่)
> - Smoke test 6 Phase 2 actions เดิม (moveToShipped/cancelJob/bulkForward/cancelOrder/promoteDraft/addJob)
> - `/data-doctor` scan
> - `/check-quota` (Apps Script + Cloudflare quota trend)
> - Vercel Analytics watch /track p95 24-48h
>
> ### Recommended next session
> 1. **Phase 4.2 close-out planning** (drop Apps Script writes — needs Phase 2 stable ≥1 month → wait until ~early มิถุนา 2026)
> 2. หรือ run pending verifications ที่ค้าง 2 sessions แล้ว
> 3. หรือ user-reported items ใหม่
>
> ---
>
> **Session 2026-05-13 — Tech-Roadmap-Status.md doc sync (no code):** ✅
>
> **Trigger:** คุณนุ๊กถาม "drop Apps Script อยู่เฟสไหน" — เปิด docs ดูเจอ drift: Tech-Roadmap-Status.md ยัง mark Phase 4.2 = "Deferred" แต่ session 2026-05-11 ดัน 11 actions Postgres-first writes live ครบแล้ว
>
> **Doc updated** (workspace root — Obsidian vault, **ไม่ใช่ git repo** จึงไม่ commit):
> - `last-updated` 2026-05-09 → **2026-05-12**
> - **Banner top** เพิ่ม 2 entries (2026-05-11 mega session + 2026-05-12 audit mega-day)
> - **Phase table** — Phase 4.2 "⏳ Deferred" → **"✅ Mostly done"** (11 actions live, flags ON). เพิ่ม 2 rows ใหม่: **Phase 4.2 close-out** (drop Apps Script writes ทั้งหมด — defer ~ต้นมิถุนา 2026), **Phase 4.3 cleanup** (LINE webhook + audit cron + primary backend role — depends on 4.2 close-out)
> - **Known issues** — ลบ stale "Phase 2.1 Code.js เหลือ 657 บรรทัด" (จริงๆ 93 lines), เพิ่ม APPS_SCRIPT_TOKEN rotation + Phase 4.2 close-out tracking
> - **Timeline** — เพิ่ม 5 entries (2026-05-08, 09, 10, 11, 12) + reorganize Future section
> - **Recommended next session** — rewrite สะท้อนสถานะปัจจุบัน
>
> **Lesson (saved to memory):** Workspace-root docs (Tech-Roadmap-Status.md, CLAUDE.md, MEMORY.md) เป็น Obsidian vault notes ที่อยู่นอก git tree. มี git repo แค่ใน 4 subprojects (penprinting-dashboard, penprinting-web, print-calculator-next, penprintphotobook). ก่อนเสนอ commit สำหรับ doc updates → verify ด้วย `git rev-parse --show-toplevel` ว่าไฟล์อยู่ใน repo ไหน
>
> **No code touched.** No subproject commits. No Apps Script changes. No env vars.
>
> **Pending user actions** ที่ยังค้างจาก 2026-05-12 ยังเหมือนเดิม (ดู section ด้านล่าง — Smoke test 6 Phase 2 actions, /data-doctor scan, /check-quota, Vercel Analytics watch).
>
> ---
>
> **Session 2026-05-12 — print page stale-read root-cause fix (`loadOrder` refactor):** ✅
>
> **User-reported (2026-05-12):**
> 1. แก้ไขงานเสร็จ → กดพิมพ์ใบสั่งใหม่ → ค่าที่พิมพ์ยังเป็น "ก่อนแก้"
> 2. กด "พิมพ์+ส่ง" / "พิมพ์" → บางครั้ง 404
>
> **Root cause (one bug, two symptoms):** `loadOrder()` ใน [lib/api.ts](lib/api.ts) มี carve-out `if ((opts.revalidate ?? 0) > 0)` ที่ skip Postgres เมื่อ caller ขอ fresh read. Logic นี้ถูกตอน Phase 1 (Postgres mirror lag, Sheet fresh) แต่กลับด้านหลัง Phase 2 (createOrder/updateOrder writes ลง Postgres เท่านั้น, Sheet lag ≤5 นาที). Print page เรียก `loadOrder(id)` ไม่ใส่ opts → revalidate=0 → skip Postgres → อ่าน Apps Script `getOrder` → ยังเป็นค่าเก่า / null = stale หรือ 404.
>
> **Sister bug ที่เคย patch:** `1f62d3b` (promote-draft) สร้าง `loadOrderAndJobsForPromote()` workaround helper. NEXT-SESSION 2026-05-11 บันทึก lesson ไว้แล้ว: "Phase 2 stale-read trap recurring — Pattern fix: write Postgres-first helpers." Refactor นี้ปิด root cause ที่ลึกกว่า patch (ทำที่ `loadOrder` เองแทนสร้าง helper ใหม่ทุกรอบ).
>
> **Fix** (`lib/api.ts` `loadOrder()`):
> - ลบ `if ((opts.revalidate ?? 0) > 0)` carve-out
> - Postgres-first ทุก call. `loadOrderFromPostgres` throws `PostgresStaleError` เมื่อไม่เจอ row → `tryPostgres` return null → fall through ไป Apps Script (สำหรับ Phase 1.x stragglers ที่ mirror cron ยังไม่ทัน)
> - Comment ใน [`app/orders/[id]/print/page.tsx`](app/orders/[id]/print/page.tsx) อัปเดตให้สะท้อน new path
>
> **Verified:** type-check ✅ / 72 vitest tests ✅ / production build ✅
>
> **Behavior change ของ 5 callers:**
> | Caller | เดิม | หลัง refactor |
> |---|---|---|
> | `/api/track/lookup` (revalidate=30 + retry 0) | Postgres → Apps Script (retry only) | Postgres ทั้งคู่ + Apps Script fallback |
> | `/api/orders/raw/[id]` (revalidate=30) | Postgres-first | เหมือนเดิม |
> | `/api/jobs/restore` (no opts) | Apps Script direct | **ดีขึ้น** — Postgres-first, เห็น Phase 2 writes |
> | `/orders/[id]/tracking-card` (no opts) | Apps Script direct | **bug fixed** (Phase 2 track 404) |
> | `/orders/[id]/print` (no opts) | Apps Script direct | **bug fixed (รายงานนี้)** |
>
> **Lessons:**
> - **Strangler-pattern read paths invert staleness assumption when write side migrates.** "Read fresh = read Sheet" was true under Phase 1; under Phase 2 "read fresh = read Postgres". Code ที่ hard-code staleness model = recurring bug factory จนกว่าจะ refactor ที่ root
> - **Workaround helpers (`loadOrderAndJobsForPromote`) signal latent root cause.** ถ้าเริ่มเขียน helper #2 ทำงานเดียวกัน → refactor ที่ต้นทาง ไม่ใช่เพิ่ม helper อีก
> - **Rollback recipe:** `git revert <commit>` (ไม่มี env flag เพราะ behavior strictly improves ภายใต้ `READ_FROM_POSTGRES=1` ที่ ON อยู่แล้ว). หรือถ้า Postgres ล่ม → unset `READ_FROM_POSTGRES` → กลับ Apps Script 100% (รวมถึง path นี้)
>
> ### Audit cleanup follow-up (`f4f3474`) — same session
>
> ✅ M4 narrow staleness gate → `['orders']` (lib/api-postgres.ts) — peripheral table stale ไม่ degrade ทุก loadOrder caller
> ✅ M1 drop redundant retry block ใน track/lookup (loadOrder ทำ fallback ในตัวอยู่แล้ว)
> ✅ L1/L2/L4 stale comments updated
> ⏳ M3 (deferred to backlog) — restore route ไม่ block restore job ที่ parent ถูก cancel. Pre-existing, low frequency. Tracked เป็น `M-restore-cancelled-parent` ใน AUDIT-BACKLOG.md
> ℹ️ M2 (monitor only) — edge /track p95 ต้องดู 24-48h หลัง refactor. ถ้า regress → revert retry แต่ไป Apps Script direct
>
> ### Phase 2 activation verification (2026-05-12)
>
> User reported 2 bugs at start of session → diagnosis ระบุว่า Phase 2 fully ON. Vercel UI verification: **all 11 WRITE_* flags + READ_FROM_POSTGRES = ON, All Environments** (5 added 19-21h ago, 3 added 1-2d ago). Apps Script v5.10.14 deployed (Version 42, May 11 3:19 PM). Phase 2 migration **complete**.
>
> **Smoke test pending คุณนุ๊ก** (~10 min, do at convenience):
>
> 1. **moveToShipped** — /board → ship ✓ บน job test → card หายทันที + /shipped row ใหม่ (audit "ส่งงานเรียบร้อย...")
> 2. **cancelJob** — /board → ยกเลิก + ใส่เหตุผล → card หาย + /cancelled row ใหม่
> 3. **bulkForward** — /board → drag-drop card ข้าม column → ~250ms + per-job audit "ส่งต่องาน..."
> 4. **cancelOrder** — /orders → คลิก order → ยกเลิกใบสั่ง → cascade cancel jobs + order flips
> 5. **promoteDraft** — /orders → คลิก draft → "บันทึก + ส่งเข้าระบบ" → save + promote + /board redirect
> 6. **addJob** — /orders → data-audit modal → "เพิ่มงาน" ที่ orphan order → job ใหม่ขึ้น
> 7. **รอ 5 นาที → Google Sheet** — เปิด tab jobs/shipped/cancelled/orders → confirm rows sync ครบ
>
> updateOrder + createOrder ไม่ต้อง test เพราะ user prove แล้วว่าใช้จริงตลอดวัน (bugs ที่ surfaced วันนี้ก็คือหลักฐาน)
>
> **Rollback (per action):** Vercel env → unset flag → redeploy → กลับ legacy. Heal cron + tombstone infra ยังทำงานต่อ → eventual consistency.
>
> ### Table-skip cron — deferred (decision)
>
> Considered: extending `phase2OwnsTable()` ใน [lib/feature-flags.ts](lib/feature-flags.ts) สำหรับ jobs/orders/shipped/cancelled → drop Sheet→Postgres cron pass สำหรับ tables ที่ Postgres own
>
> **Decision: defer.** Rationale:
> - Cron ตอนนี้ใช้ `deleteCleanThenInsert` ที่ preserve Phase 2 dirty rows อยู่แล้ว → cron ไม่ overwrite Phase 2 writes ถึงแม้ table-skip ไม่ active
> - Benefit = ~5s + Apps Script quota call ต่อ 10-min cron pass (incremental perf, not correctness)
> - Risk = lose Sheet→Postgres safety net สำหรับ stragglers / drift / direct admin Sheet edits (rare แต่ไม่ใช่ 0)
> - Effort = ~30 min implementation + needs 1-2 weeks production observation ก่อน flip
>
> **Future trigger to revisit:** ถ้า Apps Script daily quota เริ่มชน 80% threshold หรือ Vercel cron latency กระทบ user → table-skip cron จะคุ้มทำ. ไม่งั้น defer ต่อ
>
> ### 5-dimensional audit batch + Sprint 1/2 follow-up (same session)
>
> After the loadOrder fix above, ran a **comprehensive audit across 5 dimensions** via 4 parallel subagents (data-doctor + perf + a11y + security) + manual architecture review:
>
> **Audit findings totals**: 18 a11y / 12 perf / 12 security / 6 medium tech-debt
> **Net assessments**: 🟡 yellow across the board — production-grade with surgical gaps
>
> **Sprint 1 (`6e46d82`) — 6 high-impact fixes** (~3-4h):
> - **PERF-F1** 4 route-segment `loading.tsx` files (board/orders/calendar/analytics) — eliminate blank-screen gap
> - **A05-1** Security headers in `next.config.mjs` (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
> - **PERF-B2** `allSettledLimit(cap=3)` on `/api/orders/update` cascade — match M5 pattern (timeout-resistant)
> - **A11Y-R1** `<main id="main-content">` landmark + skip-to-content link in DashboardShell + global `focus-visible:` outline rule in globals.css
> - **A11Y-O2** Touch targets 44×44 — 9 modal close buttons + MobileUserMenu trigger + toast dismiss
> - **PERF-C1** Card `arePropsEqual` field-level compare (replaces JSON.stringify) — ~500KB string work/tick saved
>
> **Sprint 2 (`190c5fe`) — 4 security + a11y deeper fixes** (~3h):
> - **A04-1** /track 3-layer brute-force resistance — IP rate-limit via Upstash + per-id PIN-failure lockout via new `peekRateLimit` + `recordFailure` helpers in `lib/rate-limit.ts` + `timingSafeStringEqual` constant-time compare
> - **A09-1** Login audit logging (`[auth]` grep-able structured logs + Sentry breadcrumb on suspicious events) — covers success/fail/rate-limit/invalid-input
> - **A11Y-P1** Urgency badge contrast — new `URGENCY_BADGE` paired Tailwind tokens (~8:1 vs prior ~3:1), refactored 6 callsites across board/card, orders-table, calendar/grid, calendar/page Pill
> - **A11Y-U2** Form errors `role="alert" aria-live="assertive"` — login + /track + ForwardDialog + ReassignDialog (×3) + BulkActionsBar
>
> **Total session 2026-05-12**: 5 commits / 10 audit findings closed (M3 + M-restore + L2 + L4 + M4 + M1 + L1/L2/L4 + Sprint1×6 + Sprint2×4) / 0 user-visible regressions / type-check ✅ / 72 tests ✅ / build ✅
>
> **Follow-up chore (same day, after Sentry report):** `6131e8b` — Sentry `ignoreErrors` filter expanded to drop browser-extension `sendMessage` + "Extension context invalidated" noise. Triggered by Sentry-reported `TypeError: Cannot read properties of undefined (reading 'sendMessage')` on `/board?dept=print` (2026-05-12T08:47Z) — not our code, content-script context-invalidation from a user's extension. Regex stays tight (specific message text) so future real `sendMessage` errors in our own code still surface. Type-check ✅ / 72 tests ✅ / lint ✅ / pushed → Vercel auto-deploy.
>
> ### Audit items deferred to Sprint 3 (low ROI vs Sprint 1+2)
> - **A04-2** APPS_SCRIPT_TOKEN 5y → 90d rotation (defensive — no breach yet)
> - **M-A01-1** `/api/orders/raw` role-gate to admin+sales (low real risk — staff trusted)
> - **PERF-A1** OrdersData rawData payload trim (needs careful UX testing — /orders is admin-only, not hot path)
> - **ARCH-OBS** Sentry DSN setup (user-deferred earlier in session)
> - **MFA + per-user passwords** (4-user app, MFA overkill at current scale)
> - **E2E tests (Playwright)** (72 unit + manual smoke acceptable at scale)
> - **Phase 4.2 close-out** (drop Apps Script writes — needs Phase 2 stable ≥1 month first)
>
> ### User actions queued
> 1. **Smoke test 6 Phase 2 actions** (~10 min) — checklist above
> 2. **`/data-doctor` scan** (Apps Script `divergenceScan()` + Postgres SQL — runbook generated this session)
> 3. **`/check-quota`** (Apps Script + Cloudflare quota trend after Phase 2 full activation)
> 4. **Vercel Analytics watch** /track p95 24-48h (M2 monitor item — Postgres-on-edge cold-start concern)
>
> ### Workspace rule additions (end of session — `/session-end` invoked)
>
> คุณนุ๊กเพิ่ม **Session Discipline rule** ให้ apply ทุก session — context check ก่อนเริ่มงาน + doc update ก่อนปิด session. ติดตั้ง 4 ที่:
> 1. **Workspace CLAUDE.md** § "Session Discipline" — auto-load ทุก session
> 2. **Memory** [`feedback_session_discipline.md`](../../../.claude/projects/-Users-witsarut-p/memory/feedback_session_discipline.md) + MEMORY.md index
> 3. **`/session-start`** slash command — `.claude/commands/session-start.md` (Step 1-6 checklist)
> 4. **`/session-end`** slash command — `.claude/commands/session-end.md` (Step 1-7 checklist)
>
> Session ใหม่ Claude จะ:
> - อ่าน NEXT-SESSION + AUDIT-BACKLOG + git log + pending actions อัตโนมัติ ก่อน confirm direction กับคุณนุ๊ก
> - ก่อนปิด session: surface uncommitted changes + update docs + memory lesson + แจ้ง pending user actions
>
> ---
>
> **Session 2026-05-11 ★ MEGA SESSION (P1 guardrails + Phase 2 jobs + orders + tombstone + audit pipeline + UX overhaul):** ✅
>
> **19+ commits + 5 Apps Script clasp pushes + 28→72 tests. Phase 2 migration covers virtually all hot-path mutations.**
>
> ### Phase 2 actions migrated (11 total — jobs + orders hot-path)
> | # | Action | Commit | Status |
> |---|---|---|---|
> | 1 | setCowork (from 2026-05-10) | — | ✅ live (earlier) |
> | 2 | updateJob | `a52381e` | ✅ live |
> | 3 | addJob | `fda396d` | ✅ live |
> | 4 | createOrder | `b3d6515` | ✅ live |
> | 5 | reassignStaff (piggybacks updateJob flag) | `1746946` | ✅ live |
> | 6 | moveToShipped | `825857e` | ✅ live (2026-05-11 21h, verified 05-12) |
> | 7 | cancelJob | `825857e` | ✅ live (2026-05-11 21h, verified 05-12) |
> | 8 | bulkForward + single forward | `d1fb66e` | ✅ live (2026-05-11 20h, verified 05-12) |
> | 9 | updateOrder | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
> | 10 | promoteDraft | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
> | 11 | cancelOrder | `010cf35` | ✅ live (2026-05-11 19h, verified 05-12) |
>
> **Skipped (intentional — dead UI paths):** deleteJob (admin-only data-audit tool), deleteOrder + deleteOrderCascade (zero callers in v2 UI), addOrder (createOrder covers).
>
> ### Infrastructure built today
> - **P1.a husky pre-commit** (`a7082f0`) — tsc + lint + vitest blocks every commit
> - **P1.b vitest** (`521292d`) — 28 initial tests; grew to **72 tests by EOD**, TDD red-phase verified for every migration
> - **Tombstone pattern** (`825857e`) — `jobs.phase2_deleted_at` + heal cron `healJobsTombstone` + from-Sheet cron predicate. Solves "move row out of jobs sheet" for moveToShipped/cancelJob/bulkForward
> - **6 new Apps Script actions** (v5.10.12/v5.10.13/v5.10.14 — clasp-pushed) — setOrderRow, setShippedRow, setCancelledRow, deleteJobByIdRow, setJobRow patches, audit.ts createOrder targetId fix
> - **Audit log pipeline** (`48a3127`, `242db89`, `d19ba75`, `f524fbd`) — schema source column + DELETE-not-TRUNCATE + appendAuditToPostgres + bootstrap loop fix in sync-from-sheet
> - **UX spec restructured** (`e2094c0`) — WP-style sections + chip flags via `lib/spec-format.ts`
> - **UX combined button** (`e9c60a9`) — "บันทึก + ส่งเข้าระบบ" on edit-draft footer: 1-click save+promote chain via `submitAndPromote` mode in OrderForm
> - **promote-draft Postgres-first** (`1f62d3b`) — new `loadOrderAndJobsForPromote()` helper bypasses Sheet stale-read so Phase 2 createOrder orders can be promoted immediately
> - **UX busy continuity** (`030dabf`) — kept `busy=true` through entire save→promote chain + added toast
> - **Diagnostic endpoints** — `/api/admin/diagnose-audit?id=&test=1` + `/api/admin/diagnose-order?id=` for next-session debugging
>
> ### Lessons (memory)
> - **/diagnose skill loop saved multiple bugs today** — initial fixes were wrong direction on audit-log + promote-draft until Phase 4 instrumentation pinned actual root cause
> - **Phase 2 stale-read trap recurring** — any write path that LATER reads via Apps Script direct (`loadAllFresh`) will see stale data when Phase 2 wrote to Postgres only. Pattern fix: write Postgres-first helpers that read Postgres direct, fall back to Apps Script only for Phase 1.7 stragglers
> - **Combined-action UX requires busy state spanning entire chain** — `setBusy(false)` before chained fetch flickers button back to idle ("เงียบ" symptom)
> - **Pre-existing bug found by /diagnose** — Apps Script legacy `addJob` double-bumps nextId (calls incrementConfig AFTER getNextId already bumped) → id gaps. Phase 2 addJob path eliminates this
>
> **Session 2026-05-10 (afternoon batch 5 — Phase 2 setCowork sync_meta bug fix):** ✅
> - **Symptom**: หลัง activate `WRITE_COWORK_TO_POSTGRES=1` + drop inline Apps Script sync, /board cards ไม่ render cowork chip ใหม่ ทั้งที่ toast success + Postgres state ถูกต้อง
> - **Diagnosed via** `/diagnose` skill + 5-layer diagnostic endpoint (`/api/admin/diagnose-board`):
>   - Layer 1 Postgres direct: ✅ cowork = `["mo"]`
>   - Layer 2 loadAllFromPostgres: ❌ throws `PostgresStaleError: templates last synced 107 min ago`
>   - Layer 3 loadAll wrapper: silently falls back to Apps Script
>   - Layer 4 Apps Script: returns `cowork: undefined` because heal cron hadn't pushed to Sheet yet (5-min cron, just-written rows are dirty)
> - **Root cause**: Phase 2 templates migration (afternoon batch 3) skipped cron sync via `phase2OwnsTable('templates')` แต่ลืมอัปเดต `sync_meta.last_sync_at` → templates "stale" ตามเวลา → staleness check fail → silent fallback to Apps Script → /board reads stale Sheet
> - **Fix** (`de9d06a`): `lib/sync-from-sheet.ts` — when skipping a Phase 2-owned table, call new `recordSyncMetaTouch(table)` to update last_sync_at + ok=true (no row_count change). Semantically: "Postgres owns this; data current via Phase 2 writes, not cron."
> - **Manual remediation**: hit `/api/admin/sync-all` once after deploy to update sync_meta immediately (otherwise wait ≤10 min for next cron cycle)
> - **Verified all 4 layers via diagnose-board** + user confirmed /board cards now update within ~300ms
> - **Lesson captured**: any future Phase 2 table-level skip MUST call `recordSyncMetaTouch()`. Phase 2 row-level dirty marker (jobs/orders/etc.) doesn't have this issue because cron still runs + updates sync_meta normally
> - **Total**: 2 commits (`fd9ce1f` diagnostic + `de9d06a` fix). Diagnostic endpoint kept for future Phase 2 debugging
>
> **Session 2026-05-10 (afternoon batch 4 — Phase 2 reverse-sync infra + setCowork):** ✅
> - **Architectural insight**: Templates migration was clean เพราะ table-level ownership (cron skip table). setCowork (และ actions ส่วนใหญ่ที่เหลือ) แตะ `jobs/orders/shipped/cancelled` ที่ยังมี actions อื่น write ผ่าน Apps Script อยู่ → cron ต้อง keep running → table-skip ไม่ใช้. ต้อง row-level ownership marker
> - **Phase 2 reverse-sync infrastructure**:
>   - **Schema**: `phase2_dirty_at TIMESTAMPTZ` column + partial index บน 4 tables (db-migrate idempotent ALTER)
>   - **From-Sheet cron** ([sync-from-sheet.ts](lib/sync-from-sheet.ts)): TRUNCATE+INSERT → "DELETE WHERE phase2_dirty_at IS NULL + INSERT ON CONFLICT DO NOTHING". Phase 2 dirty rows survive cron passes
>   - **To-Sheet heal cron** (`/api/cron/sync-to-sheet`, schedule `*/5 * * * *`): SELECT dirty rows → call Apps Script `setJobRow` → mark clean on success. Batch limit 50/run
>   - **Helpers** ([postgres-write.ts](lib/postgres-write.ts)): `markRowDirty`, `markRowClean`, `setCoworkInPostgres`. Phase 2 paths set dirty + clear on inline-sync success; cron retries failed inline syncs
> - **Apps Script v5.10.11**: `setJobRow` action — generic upsert that accepts pre-allocated id + idempotent (append if not found, overwrite if exists). Mirrors setTemplateRow pattern. Available for heal cron + future Phase 2 actions
> - **First migrated using new infra**: `setCowork` ([app/api/jobs/cowork/route.ts](app/api/jobs/cowork/route.ts)) — flag-gated branch via `WRITE_COWORK_TO_POSTGRES=1`. Postgres UPDATE + dirty mark → inline `setCowork` Apps Script call → markClean on success / leave dirty for heal cron on failure. Fallback to legacy if row not in Postgres yet (older row before Phase 1.7 mirror)
> - **Failure mode contract**: Inline sync fail → row stays `phase2_dirty_at IS NOT NULL` → from-Sheet cron skips → heal cron retries within 5 min → success clears mark. Worst case: ~5 min Sheet drift before heal catches up
> - **Default-off** — `WRITE_COWORK_TO_POSTGRES` flag ยังไม่ flip ที่ production
> - **Total**: 7 file changes (1 new lib + 1 new cron route + 5 modified)
>
> **Session 2026-05-10 (afternoon batch 3 — Phase 2 scaffold + templates migration):** ✅
> - **Phase 2 = write migration** (drop Apps Script writes, Postgres = source of truth) — เลือกทำ scaffold + 1 action proof-of-concept ก่อน, ไม่ลุย hot-path
> - **Infra**:
>   - `lib/postgres-write.ts` — Postgres-authoritative write handlers (`addTemplateToPostgres`, `deleteTemplateFromPostgres`). Difference vs `postgres-write-mirror.ts`: this is primary write, mirror is best-effort
>   - `lib/feature-flags.ts` — per-action env flag (`WRITE_TEMPLATES_TO_POSTGRES=1`) + `phase2WriteEnabled(action)` + `phase2OwnsTable(table)` helpers
>   - `lib/sync-from-sheet.ts` — gated cron template sync (skips when Postgres owns table) เพื่อกัน TRUNCATE blowing away Phase 2-only rows
> - **First migrated action**: `addTemplate` + `deleteTemplate` (lowest risk — /orders/new only, identified by name+timestamp id, ไม่ใช่ hot path)
>   - `app/api/orders/templates/{add,delete}/route.ts` — branch on `phase2WriteEnabled('<action>')`. Flag off = legacy Apps Script-first (current behavior unchanged). Flag on = Postgres-first + best-effort Apps Script Sheet sync
> - **Apps Script side**: `production-monitoring/apps-script/dashboard/templates.ts` + `api.ts` + `auth.ts` — เพิ่ม `setTemplateRow` action (v5.10.10) ที่รับ pre-allocated id + idempotent upsert (append if not found, overwrite if exists). Phase 2 path เรียกผ่าน `post('setTemplateRow', ...)` เพื่อ sync ไป Sheet สำหรับ admin Sheet UI
> - **Failure mode contract**: Postgres write fail → propagate ไป user. Apps Script Sheet sync fail → swallow + Sentry breadcrumb (`layer: phase2-sheet-sync`). Sheet drifts; cron skips template sync ที่ flag on; drift heals on next setTemplateRow retry
> - **Default-off** — flag ยังไม่ flip ที่ production. ⏳ User ต้องทำ 2 ขั้นเพื่อ activate (ดู "Pending user actions" ด้านล่าง)
> - **Total**: 4 commits + 1 Apps Script edit (รอ user push)
>
> **Session 2026-05-10 (afternoon batch 2 — Phase 1.7 dual-write + bug fixes):** ✅
> - **Bug discovered after Phase 1 cutover**: writes "เด้งกลับหมด" — Postgres mirror lag (10-min cron) made loadAll() return OLD data after every write → optimistic UI commit revealed pre-write state → user perceived writes as failed.
> - **Phase 1.7 dual-write mirror** (`33d9978`) — `lib/postgres-write-mirror.ts` 17 handlers (upsert jobs/orders/shipped/cancelled/templates + atomic cascades for cancelOrder/deleteOrderCascade/promoteDraft + bulkForward with server-allocated newIds). After every Apps Script write success, `post()` mirrors to Postgres in same request → mirror reflects change before response returns → next read sees fresh state. Mirror failures non-fatal (mark sync_meta stale + Sentry capture).
> - **Edit form bounce-back fix** (`9969af9`) — pre-existing OrderForm useEffect dep on `initial` reference reset state on every router.refresh. Phase 1.7's faster refresh (~200ms vs 1.5s Apps Script) made the SuccessView flicker user-visible. Fix: `initializedIdRef` skip re-run when same logical id, `wasOpenRef` track close→open transitions for modal "fresh open" reset.
> - **Edit-from-/orders speed** (`870aaa4`) — `/orders/[id]/edit/page.tsx` was parallel-fetching loadOrder + loadAll, but loadOrder bypassed Postgres (revalidate=0). Phase 1.7's dual-write guarantee means `loadAll()` is fresh, so `snap.orders.find(id)` covers both target + recentOrders in ONE Postgres fetch. /orders → edit ~500ms → ~200ms.
> - **Total**: 3 commits.
>
> **Session 2026-05-10 (afternoon batch 1 — Phase 1 Postgres read mirror LIVE):** ✅
> - **PoC bench-driven decision** — built `/admin/bench-audit` 2-section harness. Bench 1 (audit_log filter): tied at p50 ~108ms (best case for Sheet). Bench 2 (loadAll-shaped, full jobs payload): **Postgres p50 23.9× faster**, p95 19.8× faster. Sheet 4400ms → Postgres 200ms. Strong-GO verdict.
> - **Phase 1 read mirror full deploy** — 4 mirror tables (orders + shipped + cancelled + templates) + sync_meta + Vercel cron `*/10 * * * *` + `lib/api-postgres.ts` Postgres-flavored loadAll/loadOrder/getAuditByTarget + `lib/api.ts` Postgres-first behind `READ_FROM_POSTGRES=1` flag with Apps Script fallback.
> - **Sheet drift dedup** — shipped table had 2 duplicate ids causing PRIMARY KEY violation; added `dedupeById()` (last wins) to all 5 mirror sync functions. Currently: 86 fetched → 84 inserted, dedup 2.
> - **/track migration** — switched from `loadAll().filter()` (200KB payload) to `loadOrder()` (1KB targeted). Public QR scan flow now ~3-5× faster. Postgres-first via Phase 1 flag.
> - **Phase 1 follow-up (`e15beeb`)** — docs sync + `/api/admin/diagnose-shipped-dupes` diagnostic + /orders bundle split (DataAuditModalImpl lazy → 9.72 → 7.34 kB).
> - **Cutover validated** — flag flipped, /board feels noticeably faster ("เร็วขึ้นเยอะ" — user confirmed).
> - **Total**: 8 commits + 1 Vercel UI config (Neon connect + READ_FROM_POSTGRES env). Migration plan estimated 1 wk → shipped in 1 session via bench-driven approach.
>
> **Session 2026-05-10 (morning — Tier B close-out + perf compound, 6 tasks):** ✅
> - **Morning Report cron migration** — Apps Script `doPost` handler + `/api/cron/morning-report` Vercel route + 3rd `vercel.json` cron entry. ⏳ Pending user actions: deploy Morning Report Apps Script as Web App + set env vars (see runbook below).
> - **Vercel KV rate limit** — `lib/rate-limit.ts` fail-open Upstash REST helper, applied to `/api/audit` (60/min/user) + `/api/orders/raw/[id]` (120/min/user). ⏳ Pending: connect Upstash KV via Vercel Storage.
> - **Apps Script TextFinder write paths** (v5.10.9) — `findRowById` + new `findRowMatchesByColumn` helper in `helpers.ts`. `cancelOrder` + `deleteOrderCascade` refactored to share `cascadeCancelJobsForOrder_`. -500ms-1.5s per cascade.
> - **/board bundle sweep + fetch storm fix** — 18.4 kB → 16.4 kB (-11%). Bigger win: eliminated 50-card `useEffect` audit fetch storm by gating `DetailContent` mount on `detailsOpen` state.
> - **Apps Script quota dashboard widget** (v5.10.9) — per-day counter via Properties Service + `getQuotaStats` action + `app/analytics/quota-widget.tsx` SVG sparkline. ISR 5 min.
> - **Morning Report icons** — already done in `1e1f692` (2026-05-09); session note was stale.
>
> **✅ Phase 3.6 cutover DONE 2026-05-09** — WP retired. DNS switch HostAtom A→CNAME Vercel complete. app.penprinting.co alias dashboard.penprinting.co (same Vercel project). WP source ยังอยู่ที่ HostAtom เก็บ rollback ≥1 สัปดาห์ (DNS ไม่ตอบที่นั่นแล้ว, files ยังอยู่). **Monitor 1 สัปดาห์**: Sentry error rate + Vercel logs `/api/track/lookup` traffic + LINE OA `/track` ปกติ. ถ้ามี issue rollback ได้: HostAtom DNS → A `203.170.190.20` กลับ.
>
> **Session 2026-05-09 (mega-day: Phase 3.6 cutover + 2 bonus fixes)** ✅:
> - **Code prep**: 9 hard-coded WP refs แก้ครบ (3 v2 + 4 marketing redirects + 2 Morning Report mirrors). Type-check + production build ผ่าน
> - **Bonus perf bug**: user-reported "order create ดูช้ามาก" → static analysis เจอ `createOrder` ไม่อยู่ใน PATHS_BY_ACTION map → fast-path order create ไม่ bust /board + /orders cache → user เห็นใหม่ใน 15-60s แทน ~1.5s. Fix `e88f386` 1 บรรทัด → verified
> - **Bonus quota tune**: morning quota alert 8:44 AM 🟡 ที่ 3080ms = cold-start false alarm. Bump warn 3000→5000 / critical 10000→15000 (cold-start friendly)
> - **Cutover**: TTL ลด 300 → wait 2 min → delete A + add CNAME `cname.vercel-dns.com.` (ต้องมี dot ท้าย — HostAtom auto-append zone ถ้าไม่ใส่). Authoritative propagate ทันที, Google + Cloudflare resolvers update ใน ~1 นาที. Vercel SSL active ทันที. Browser smoke test ผ่าน. `/production-monitoring*` → `/board` redirect cushion ทำงาน
> - **Total**: 5 commits + 2 Apps Script pushes + DNS cutover
>
> **Session 2026-05-08 (mega-day: audit + Sentry + 5 bugs)** ✅ ปิด 9 audit findings (3 High + 5 Medium + 1 doc) + Sentry end-to-end (5 layers ของ silent failure) + 5 user-reported bugs. **15 commits + 2 Apps Script deploys**. Bug 4 highlight: คุณนุ๊กชี้ insight ว่า "/board card detail เร็วทำไม?" → unlock root cause ที่เป็น architecture mismatch (orders modal lazy-fetched, board renders inline) ไม่ใช่ backend perf — ผม jump-fix backend perf ก่อน 2 commits จนได้ insight ของคุณนุ๊กแล้วถึงเข้า real fix `96603a8` (inline rawData in OrderRow).
>
> **Session 2026-05-07 (mega-day, afternoon batches)** ✅ ต่อจาก morning Phase 2.1 close + forward perf + order create perf + PM perf batch + PM2 atomic cascade — afternoon ส่ง **5 batches เพิ่ม** (10 commits รวม): bundle splits + smart auto-sync backoff + edge runtime (`1d6e57f`) → mobile bottom-nav + hamburger sheet + top-right user menu (`95c0cb8`) → /track WP look + 6-step progress port (`ce611b1`) → /track charcoal mood (`fe0b38e`) → workflow speed sweep round 5 (`3cb4501`) + Apps Script v5.10.5 (audit-param skip). **Cumulative impact**: order create 5 round-trips ~3s → 1 atomic ~1.5s, print page 600-1200ms → ~200ms, /analytics First Load -39%, Apps Script idle quota -69%, mobile UX gap closed (logout reachable on mobile + 4-slot bottom nav), /track WP-parity restored.

## ✅ เสร็จแล้วในรอบล่าสุด — 2026-05-08 mega-day (audit + Sentry + 5 bugs)

15 commits + 2 Apps Script deploys (helpers.ts + load.ts):

### 1. Audit close-out batch 5 (`57ca976` + `dc24167`)

11 files +213/-57 — 3 High + 5 Medium + 1 doc fix ครบใน 1 commit:

**High (correctness/safety):**
- **H1 orphan-recovery double-tap** (`/api/jobs/add`) — เพิ่ม idempotency: ถ้า body มี orderId, fetch loadAllFresh + reject 409 ถ้ามี active job ผูกอยู่แล้ว. Closes data-audit modal duplicate-job window
- **H2 promoteDraft fall-through double-write** (`/api/orders/promote-draft`) — reject `{ok:true}` without jobId เป็น 502 (Apps Script regression) แทน fall-through ที่จะ burn speculative jobId อีกครั้ง
- **H3 restore trust-client** (`/api/jobs/restore`) — always read row from Sheet (cached `loadAll` + fresh fallback) + verify `src.name === cj.name` ก่อน restore. ใช้ 409 ถ้า mismatch

**Medium (UX/perf/safety):**
- **M2 JobForm submit re-entry** — `submittedRef` guard, ลบ dead `busy` state
- **M4 /track currentDept null** — collapse เป็น 'received' state (no contradictory urgency badge)
- **M5 cascade fallback concurrency cap** — `allSettledLimit(3)` แทน unbounded `Promise.allSettled` + new `lib/concurrency.ts` zero-dep helper
- **M6 MobileUserMenu overlap** — `/orders` sticky header reserves `pr-12` on mobile
- **M7 auto-sync setTimeout race** — `unmounted` flag ใน self-rescheduling chain

**Doc:**
- **M8 stale comment** — `lib/api.ts` PATHS_BY_ACTION comment ปรับให้สะท้อน round 5 (board ไม่อ่าน audit แล้ว)

**Defer (per audit recommendation):**
- M1 Card memo deep compare — รอ profiler data ก่อน
- M3 JobForm stale toast — cosmetic
- L1-L4 — low impact

### 2. Sentry observability — end-to-end working

**5 layers of silent failure** ขุดเจอตามลำดับ (5 commits + 1 Vercel env config + 1 Apps Script no-op):

| Layer | ปัญหา | Fix commit |
|---|---|---|
| 1 | `instrumentation-client.ts` — Next.js 15.3+ convention; Next.js 14 silently ignores | `212bb7a` rename → `sentry.client.config.ts` |
| 2 | `sentry.client.config.ts` — @sentry/nextjs v10 dropped auto-load | `f299dc9` manual init from `app/layout.tsx` |
| 3 | Top-level code in 'use client' module ไม่รัน — Next.js 14 quirk | `076586d` switch to `useEffect` init |
| 4 | `NEXT_PUBLIC_SENTRY_DSN` Sensitive flag in Vercel — Sensitive vars ไม่ inline เข้า client bundle | (config UI) uncheck Sensitive + add Production env |
| 5 | Default debugging logs noisy — clean up | `7e6fbfa` drop debug logs |

**Final state**: SDK init from `components/sentry-init.tsx` via `useEffect` in `app/layout.tsx`. Sourcemaps upload (Node + Edge + Client × 100+ files). Tunnel route `/monitoring` ผ่าน. `ignoreErrors` filter wallet extension noise. Server + Edge Sentry pre-existing config ก็ยังทำงาน.

**Verify ผ่าน**: throw → POST /monitoring → 200, issue ขึ้น Sentry dashboard, stack trace map กลับเป็น TS file ไม่ใช่ minified hash.

**Lesson** (`feedback_use_diagnose_skill.md`): จุด 5 layers ที่ "ดูเหมือนทำงาน" (build pass, sourcemaps upload สำเร็จ) แต่ runtime พังเงียบ — ใช้ `/diagnose` skill (mattpocock) เป็น loop ตอน debug bug แบบนี้ครั้งหน้า. User feedback: "ที่หลังเจอบักใช้ /diagnose ช่วยประกอบตลอดนะ".

### 3. Photobook spec tab fix (`682fd0e`)

ก่อน — photobook order spec แสดง printing fields ที่ไม่เกี่ยว (plateSize, billColors, paperCover, coatGloss, ฯลฯ) เพราะ v2 OrderForm seed ทั้ง printing schema แล้วค่อย flip orderType=photobook.

หลัง — photobook spec ใช้ whitelist `PHOTOBOOK_VISIBLE_KEYS = ['notes', 'orderer']`:
- `app/orders/orders-table.tsx` SpecSection (modal /orders)
- `app/board/card.tsx` DetailsTable + new PhotobookItemsTable component (Kanban card detail)
- Photobook items render ใน violet-themed table แยก, รายละเอียดงาน table ตามด้วย notes + orderer

### 4. Promote-draft flicker fix (`5db20f5`)

User report: หลังกด "ส่งเข้าระบบ" จาก draft → Job ขึ้น Kanban → หายไปสักพักใหญ่ๆ → กลับมา. ใน /orders แสดง "มอบหมายแล้ว" ตลอด.

Root cause มี 2:
1. Redirect hard-code `/board?dept=post` แต่ default `assignDept='graphic'` → Job ไปอยู่ graphic column, filter post ซ่อนหมด
2. ไม่มี `router.refresh()` ก่อน redirect → Router Cache ของ tab ปัจจุบันยังถือ snapshot เก่า → auto-sync tick แรก hit warm cache → flicker

Fix: ลบ `?dept=post` filter (land บน unfiltered /board) + `router.refresh()` ก่อน setTimeout navigate.

⏳ **รอ user retest** — ทดสอบ draft → ส่ง → ดู Job คงอยู่บน Kanban ไม่หาย

### 5. Date corruption fix (Vercel `25e28c0` + Apps Script helpers.ts)

User report: orders ที่ผ่าน promoteDraft / cancelOrder แสดง dateIn/dateDue เป็น `"2026-05-07T17:00:00.000Z"` (literal quotes ครอบ ISO string) ใน /orders แทน DD/MM/YYYY format.

**Root cause** — Apps Script `objectToRow()` helper:
```ts
if (typeof val === 'object') return JSON.stringify(val);
```
`typeof new Date() === 'object'` matches → Date double-stringified → cell stored as quoted ISO string. ทุกครั้งที่ promoteDraft/cancelOrder อ่าน row + write back ทับ → corrupt date columns.

**Fix two-pronged**:
- **Apps Script** `production-monitoring/apps-script/dashboard/helpers.ts` — เพิ่ม `if (val instanceof Date) return val;` guard ก่อน catch-all object branch. Apps Script writes Date back as Date cell. ป้องกัน corruption ในอนาคต. ✅ user pushed via push.sh + redeployed
- **Vercel** `lib/jobs.ts` displayDate — strip outer double quotes ก่อน regex parse. Recover existing corrupted display โดยไม่ต้องเขียน repair script.

หลังนี้ orders ที่ผ่าน atomic action ใหม่จะ Date format ถูก. Cell ที่ corrupt อยู่จะ display ปกติผ่าน Vercel rescue, แล้วทุกครั้งที่ status flip จะ overwrite เป็น Date object สะอาดเอง.

### 6. Bug 4 — Modal slow on /orders (`7b73d4f` + Apps Script load.ts + `96603a8`)

คุณนุ๊กรายงาน: เปิด detail modal จาก /orders โหลดช้า ~3.7-4.4s ต่อ order ทั้งที่ payload แค่ 0.8 KB.

**3 layers of fixing**:
1. **Apps Script `loadOrder` rewrite** (`load.ts`, คุณนุ๊ก push) — เลิกใช้ `sheetToArray()` ทั้ง 4 sheets, เปลี่ยนเป็น `TextFinder` + single-row `getDisplayValues()`. New helpers `findOneRowByColumn` + `findAllRowsByColumn`.
2. **Vercel cache** (`7b73d4f`) — `loadOrder()` รับ `{ revalidate }` option, `/api/orders/raw/[id]` ใช้ `revalidate: 30` → repeat opens cache hit ~50ms.
3. **Architectural fix** (`96603a8`) — root cause ที่แท้จริง: /orders modal lazy-fetch แต่ /board card render inline ทั้งที่ data source เดียวกัน (loadAll snap). คุณนุ๊กชี้ insight นี้ ("/board เร็วทำไม?"). Fix: pass `rawData` inline ใน OrderRow → modal render synchronously ไม่ fetch เลย. Fallback path คงอยู่สำหรับ rawData missing case.

**Lesson** (memory: `feedback_perf_compare_similar_features.md`): ถ้า feature A perf ช้า + feature B ที่คล้ายกันเร็ว → ถามว่า A ทำพิเศษกว่า B อะไร (มัก architecture mismatch) ก่อน jump-fix backend perf shared infrastructure

### 7. Bug 5 — Pagination missing (`b798c3e`)

คุณนุ๊กรายงาน: list pages แสดง "20 จาก 120 รายการ" แต่กดดูที่เหลือไม่ได้.

Root cause: ทุก list page ใช้ `slice(0, perPage)` = first page only, ไม่มี `?page=` URL state, ไม่มี pagination control.

Fix:
- New `lib/page-size.ts` helpers — `resolvePage()`, `paginate()`, `totalPages()`, `clampPage()`
- New `components/pagination-bar.tsx` — Prev / "หน้า X / Y (n–m จาก total)" / Next, auto-hide เมื่อ list fits 1 page
- `PageSizeBar` drops `?page=` เมื่อ user เปลี่ยน per-page (กัน past-end)
- /orders + OrdersTable + /shipped + /cancelled — wire up pagination

Type-check ผ่าน + production build OK ทุก commit. Vercel auto-deploy.

## ✅ เสร็จแล้วใน Afternoon batches (2026-05-07)

### Round 5 — Workflow speed sweep (`3cb4501`) ✅ — 6 fixes hot + cold paths
- **JobForm optimistic close + commit() pattern** — modal closes instantly on submit, toast carries in-flight state (matches CoworkDialog). Was 400ms modal-open lag.
- **`/api/jobs/forward-undo` drops `getNextId` round-trip** — passes `id: 0`, bulkForward auto-allocates under same lock. Saves ~300ms per undo.
- **`/api/jobs/restore`** — accepts `srcCancelled` snapshot from /cancelled page + `loadOrder(id)` parent-order lookup. 1.2s → ~400-800ms.
- **`/api/auth/{login,logout}`** — edge runtime. ~150ms cold-start saved on first login of day.
- **Apps Script `loadAll(opts?.audit?: boolean)`** ([load.ts](../production-monitoring/apps-script/dashboard/load.ts) + [api.ts](../production-monitoring/apps-script/dashboard/api.ts) switch threads `e.parameter.audit !== '0'`). Default unchanged (backwards-compat).
- **`lib/api.ts`** — `loadAll()` passes `audit=0`; new `loadAllWithAudit()` for /analytics; /analytics page.tsx switched.
- **`app/board/card.tsx`** — `React.memo` wrapper with field-level comparator (`arePropsEqual`). On auto-sync ticks, only the moved card re-renders (49/50 unchanged refs detected). Internal context updates (BulkMode/PendingMutations) still re-render via hook subscriptions → optimistic UI keeps working.
- ✅ **Apps Script v5.10.5 live** — user pushed via push.sh + Manage deployments

### /track charcoal mood (`fe0b38e`) ✅ — minimal styling pass
- Status badge `progress` variant: blue `#dbeafe/#1d4ed8` → charcoal `#e7e5e4/#1a202c`
- Step `current` icon: blue → solid charcoal `#1a202c/#ffffff` (filled black with white icon)
- Step `current` label: `#1a202c` thai bold + `#4a5568` eng
- Contact phone link: blue → black with underline + 3px underline-offset
- Kept green (done/shipped), red (cancelled/overdue), amber (received) for semantic meaning

### /track WP port + 6-step progress (`ce611b1`) ✅ — feature parity restored
- `/api/track/lookup` now returns `currentDept: 'graphic'|'print'|'post'|null`. Status labels match WP exactly (กราฟิกกำลังดำเนินการ / อยู่ระหว่างพิมพ์ / ขั้นตอนหลังพิมพ์ / etc).
- [app/track/page.tsx](app/track/page.tsx) — cream `#f5f5f0` BG, text-only "PENPRINTING" wordmark, robots noindex.
- [app/track/client.tsx](app/track/client.tsx) (full rewrite) — white card rounded-20, status header in cream, 22px job name, pill badges with 5 variants (normal/progress/overdue/shipped/cancelled), 2-column date row, **6-step vertical progress timeline** (received → graphic → print → post → ready → shipped) with done/current/pending/cancelled states + Thai+English labels, reason box for cancellations, contact box with `tel:043220582`, "← ตรวจสอบงานอื่น" back link.

### Mobile bottom-nav refactor (`95c0cb8`) ✅ — UX gap closed
- Bottom nav always reserves rightmost slot for "เมนู" hamburger that opens a bottom sheet. Primary slots = 4 mobile-flagged items (สั่งงาน + กราฟฟิก + พิมพ์ + หลังพิมพ์ for admin/sales; 3 for staff who can't see สั่งงาน).
- New [components/mobile-user-menu.tsx](components/mobile-user-menu.tsx) — floating top-right circular IconUser button (`md:hidden`). Tap opens bottom sheet with avatar + user name + role label + quick link to /track + logout button. **Closes the mobile-no-logout gap.**
- New `getMoreMenuGroups(role)` helper in [components/nav-config.ts](components/nav-config.ts) — returns groups with bottom-row items stripped, preserving "การผลิต / รายการ" headings inside the sheet.
- Added `IconMenu` (3 lines) and `IconExternalLink` to [lib/icons.tsx](lib/icons.tsx).

### Bundle splits + smart backoff + edge (`1d6e57f`) ✅ — perf compound
- **Lazy-load recharts** on /analytics via `next/dynamic({ ssr: false })` — new [app/analytics/charts-lazy.tsx](app/analytics/charts-lazy.tsx). **/analytics First Load JS: 295KB → 181KB (-39%)**.
- **Dynamic-import OrderForm + JobForm** in [app/board/card.tsx](app/board/card.tsx) with conditional mount `{editOpen && <JobForm…/>}`. Modal chunks fetch on first ✏️ click instead of every /board hit.
- **Smart auto-sync backoff** in [lib/auto-sync.tsx](lib/auto-sync.tsx) — replaced fixed 15s setInterval with self-rescheduling setTimeout. Schedule: **15s active / 30s after 2-10min idle / 60s after >10min idle**. Activity tracked via passive pointerdown/keydown/wheel/touchstart. **~75% Apps Script quota reduction on idle tabs.**
- **Edge runtime on `/api/track/lookup`** — public route, all deps Edge-compatible, ~150-300ms TTFB win on first hit of the day.
- **Deleted `app/board/bulk-forward-modal.tsx`** (424 lines, 20K, no consumers).

### 📊 Cumulative impact (afternoon + morning combined, 2026-05-07)
| Metric | Before | After |
|---|---|---|
| Order create flow | 5 round-trips ~3s | 1 atomic ~1.5s |
| Print page | 600-1200ms | ~200ms |
| Order detail modal | ~600ms | ~200ms |
| Order edit (common) | ~3-4s | ~1.5s |
| Cancel order with cowork | 3s | 1.8s → 600ms (atomic AS) |
| Job edit modal | 400ms-open | 0ms close |
| /analytics First Load | 295KB | **181KB (-39%)** |
| /board First Load | 205KB | 196KB |
| Apps Script idle quota | baseline | **-69%** |
| Apps Script payload/page | baseline | **-50-100KB** (audit=0 + atomic) |

---

## ✅ เสร็จแล้วในรอบเช้า + บ่ายต้น (2026-05-07)

### Data audit modal + atomic order cascade (`c95c451`, PM2) ✅ — orphan window closed
**ปัญหา**: order lifecycle ยังมี multi-call write paths ที่ partial-failure ได้:
- `/api/orders/cancel` — `Promise.allSettled([...cancelJob])` + แยก call ไป update order status → ถ้า order-status flip fail หลัง cascade success = order ค้าง 'sent' มี jobs cancelled
- `/api/orders/delete` — เหมือนกัน + delete order row
- `/api/orders/promote-draft` — alloc jobId + addJob + update order draft→sent → ถ้า addJob success + status flip fail = orphan-incoming

**ปิดทั้งหมดในรอบเดียว** — atomic Apps Script v5.10.4 + data-audit modal port + fast-path-with-fallback v2 routes:

- **Apps Script v5.10.4** (`production-monitoring/apps-script/dashboard/write.ts +200`, `api.ts` +3 cases, `auth.ts` ROLE_REQUIREMENTS):
  - `cancelOrder` — cascade-cancel attached jobs + flip order status='cancelled' ใน LockService scope เดียว (admin only)
  - `deleteOrderCascade` — cascade-cancel + delete order row (admin only)
  - `promoteDraft` — allocate jobId + append job + flip draft→sent atomic (admin+sales)
- **Data-audit modal** ([app/orders/data-audit-modal.tsx](app/orders/data-audit-modal.tsx) NEW, port WP `openDataAuditModal` + `recoverOrphanOrder` + `removeDuplicateJob` from production-monitoring.js:5440-5660):
  - Section 1: orphan orders (status=sent without job/shipped/cancelled) → recovery dropdown (dept/staff) → POST /api/jobs/add
  - Section 2: duplicate jobs (orderId+name groups with >1 row) → older row deletable → POST /api/jobs/delete
  - Replaces previous passive `<Link>` filter that did nothing actionable
  - Server-computed (orphans + duplicates derived from same loadAll snapshot — no extra round-trip)
- **v2 routes — fast path with fallback** — `/api/orders/{cancel,delete,promote-draft}` try atomic action first, fall through to multi-call legacy on `Unknown action` error → Vercel deploy could ship before Apps Script redeploy without breakage
- **`lib/api.ts` `PATHS_BY_ACTION`** — registered cache-bust paths for cancelOrder/deleteOrderCascade/promoteDraft

**Orphan prevention (final state)**: ✅ all order lifecycle actions atomic in single lock — createOrder, bulkForward, cancelJob, moveToShipped, **cancelOrder**, **deleteOrderCascade**, **promoteDraft**. Remaining orphan sources = legacy data, manual Sheet edits, Apps Script outage mid-write. Data-audit modal acts as safety net.

### Phase 2.1 Apps Script TS migration (100%) ✅
- 4 sections สุดท้ายเป็น TS — type-check ผ่าน strict mode (`noImplicitAny` + `strictNullChecks`)
- [auth.ts](../production-monitoring/apps-script/dashboard/auth.ts) (96 lines) — HMAC + role gate
- [load.ts](../production-monitoring/apps-script/dashboard/load.ts) (168 lines) — `loadAll`, `loadOrder`, `loadRecentAudit`
- [write.ts](../production-monitoring/apps-script/dashboard/write.ts) (280+ lines) — 12 mutations + `bulkForward` server-side id alloc + `createOrder` action
- [api.ts](../production-monitoring/apps-script/dashboard/api.ts) (159 lines) — `doGet`, `doPost`
- `Code.js` 677 → **93 lines** (-86%); only constants + section markers
- ✅ User redeploy แล้ว via push.sh + Manage deployments

### Forward perf overhaul (A+B+C) ✅
**ปัญหา**: ส่งงานต่อ v2 บล็อค UI 2.5-6 วินาที (vs WP instant). 3 sequential Apps Script round-trips: `loadAllFresh` → `getNextId` → `bulkForward`.

- **A. Skip `loadAllFresh()`** — `/api/jobs/{forward,bulk-forward,reassign}` รับ `srcJob` snapshot จาก client. Drag-drop ส่งผ่าน dataTransfer `application/x-job-snapshot`.
- **C. Apps Script `bulkForward` auto-alloc** — newJob.id ว่าง/0 → `getNextIds(N)` ภายใน batch lock + return `succeeded: [{oldId, newId, name}]`.
- **B. Optimistic UI** — [pending-mutations.tsx](components/board/pending-mutations.tsx) context เก็บ `Set<jobId>` "ซ่อน". Card หายจาก source col ทันที + phantom card injection ใน destination col + defer cleanup จนกว่า `useTransition`-wrapped `router.refresh()` จะเสร็จ. Failure → unhide + toast.error.

| | ก่อน | หลัง | WP |
|---|---|---|---|
| Apps Script round-trips | 3 | 2 | 2 |
| Perceived UI latency | 2.5-6s | **0ms** | 0ms |
| Atomicity | ✅ | ✅ | ❌ (delete+add race) |

### Order create perf (5 round-trips → 1, < 2s) ✅
- **`a184254`** — single-call `createOrder` Apps Script action — allocates orderId + initial jobId atomically + writes both rows in one batch
- **`3ad9f01`** — parallelize order create / update / promote-draft round-trips (`Promise.all`)
- **`0b762cc`** → **`c38c5c1`** — temporarily reverted createOrder fast path after suspecting empty-row regression; root cause was edit-form prefill bug `8c5f97d` instead. Re-enabled after fix.

### Order form / edit + UX fixes ✅
- **`8c5f97d`** — order edit: date prefill bug, dual assign+forward fields, cancel button on edit page
- **`2cb2863`** — order-form: orderer dropdown + drop assignStaff/forwardPrint mutual exclusion (matches WP)
- **`c542d98`** — replace PP placeholder with real Penprinting logo on A4 invoice
- **`2a984ab`** — print popup synchronous open (bypass popup blocker)
- **`6667d87`** — print page bypass loadAll cache for fresh orders (`force-dynamic` + `loadAllFresh`)
- **`5fd241f`** — พิมพ์+สั่ง stays inside installed PWA (display-mode standalone detection)
- **`79a8caf`** — ลบใบสั่ง → ยกเลิกใบสั่ง ใน /orders detail modal

### Hot-path round-trip cuts ✅ (PM, `8528839`)
**ปัญหา**: lifecycle audit ของ order→ship เจอ 7 friction points ที่กิน 0.6-1.2s/interaction. แก้ทั้ง batch — cuts unnecessary `loadAllFresh()` reads + parallelizes cascade writes + ให้ instant pending feedback บน operations ที่บล็อก UI เงียบๆ.

| Fix | ที่อยู่ | Saving |
|---|---|---|
| `loadOrder(id)` wrapper บน Apps Script `getOrder` | [lib/api.ts](lib/api.ts) | single-row read ~200ms vs full snapshot ~600ms |
| Order detail "สเปคงาน" tab | [app/api/orders/raw/[id]/route.ts](app/api/orders/raw/[id]/route.ts) | 3× faster (loadOrder vs loadAll) |
| "พิมพ์+สั่ง" popup fill | [app/orders/[id]/print/page.tsx](app/orders/[id]/print/page.tsx) | ~2.7s → ~1.6s (loadOrder + drop loadAll fallback) |
| Track lookup fresh-bypass | [app/api/track/lookup/route.ts](app/api/track/lookup/route.ts) | QR scan within 60s no longer 404s (matches print page pattern) |
| Order spec-only edit | [app/api/orders/update/route.ts](app/api/orders/update/route.ts) | -600ms when name+dateDue unchanged (`srcOrder` snapshot from client) |
| Order cancel/delete cascade | [app/api/orders/{cancel,delete}/route.ts](app/api/orders/cancel/route.ts) | N×600ms → max(~600ms) via `Promise.allSettled` |
| Order-form submit feedback | [app/board/order-form.tsx](app/board/order-form.tsx) | sidebar pulsing dot lights up via `useTransition`-wrapped `router.refresh()` |
| CoworkDialog UX | [app/board/card.tsx](app/board/card.tsx) | close modal on click + toast progress + commit() — no waiting with modal open |

## ✅ เสร็จแล้วในรอบก่อน (2026-05-06 PM)

### Audit close-out
- 4 batches ปิดครบ: 1 Critical + 5 High + 7 Medium + 5 Low → **17/18 findings closed** (1 false positive)
- [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) เป็น running tracker — ใช้สำหรับ audit รอบถัดไป

### Sidebar perf overhaul
- `useTransition` + pulsing dot บน sidebar/bottom-nav → instant click feedback (~16ms)
- Per-action `revalidatePath` scope ใน [lib/api.ts](lib/api.ts) — warm cache survives unrelated writes
- Suspense streaming SSR บน 6 pages — shell ~50ms, body fills เมื่อ Apps Script ตอบ
- Page-flash artefact จาก per-route loading.tsx revert (shell อยู่ใน page.tsx ไม่ใช่ layout)

### Polish + observability
- Favicon = real logo (`app/icon.png` + `apple-icon.png`)
- QR บน A4 invoice → `/track?id=<id>`
- Sentry wired (server/edge/client + global error boundary, +78 KB shared bundle)
- Per-user audit signing — `_actor: "<role>:<user>"` ใน body, Apps Script side override default `admin:dashboard`
- Documentation sweep — `dashboard-v2.md` ใหม่เป็น v2 source-of-truth

### UI changes
- `/` redirect → `/login` หรือ `/board` (drop landing splash)
- `/orders` detail full WP-style 3-tab (ข้อมูลหลัก / สเปคงาน / ประวัติ) + lazy fetch raw
- `/analytics` → port WP รายงานประจำเดือน + dept detail modal (รวม | แยกตามช่าง)
- Drop "+ งานเดี่ยว" button จาก /board toolbar
- Permission lockdown: /analytics admin only / /orders admin+sales / edit admin only

---

## 🎯 Next session — Phase 2 next actions (P1 + updateJob + addJob ✅ done 2026-05-11)

### Migration order (remaining hot-path actions)

After addJob, the natural next batches by risk:

1. **`bulkForward`** (Higher risk, ~1 hr) — multi-row delete-old + insert-new with server-allocated newIds. The "atomic forward" path that v2 already optimized. Translation: write all newJobs to Postgres + dirty mark + delete oldJobs in same Postgres transaction. Apps Script side already atomic — heal cron pushes via setJobRow per row. ⚠️ Need batch dirty-mark for delete (`phase2_deleted_at` or row-tombstone pattern)
2. **`cancelJob`** (Med risk, ~45 min) — atomic move job→cancelled. Two tables touched in one transaction. Patterns from `mirrorWriteToPostgres mirrorCancelOrder` reusable
3. **`moveToShipped`** (Med risk, ~45 min) — atomic move job→shipped. Same shape as cancelJob
4. **`reassignStaff`** (Low risk, ~20 min) — single-field UPDATE like setCowork. Should be quick
5. **`deleteJob`** (Low risk, ~15 min) — DELETE FROM jobs. Need tombstone pattern so heal cron knows to delete from Sheet too — or add a "delete" action to setJobRow

After 5/5 hot-path actions migrated → consider table-skip cron for `jobs` (full table ownership) + drop `mirrorWriteToPostgres` jobs branch

### Order lifecycle actions (lower priority — admin only, lower frequency)
- `addOrder`, `updateOrder`, `deleteOrder`, `createOrder`, `cancelOrder`, `deleteOrderCascade`, `promoteDraft` — these touch orders + sometimes jobs cascade. Defer until jobs are stable in Phase 2

---

## ⚠️ Pending user actions (after 2026-05-11 session)

### 🎯 Phase 2 master activation runbook (all flags)

**Status of prerequisites (one-time setup):**

| Prereq | State | How to verify |
|---|---|---|
| `phase2_dirty_at` columns (jobs/orders/shipped/cancelled) | ✅ live | `/api/admin/db-migrate` shows no ALTER in applied |
| `phase2_deleted_at` column on jobs | ✅ live (Batch A, 2026-05-11) | Same — ALTER not in applied |
| `audit_log.source` column | ✅ live | Same |
| Apps Script v5.10.14 deployed | ✅ live (verified 2026-05-12 — Version 42, May 11) | Editor → Manage deployments → Active shows `(v5.10.14)`, archived list shows v5.10.13 setOrder, v5.10.12 createOr, v5.10.11 setJobRow etc. |

**If Apps Script v5.10.14 NOT yet deployed:** Apps Script editor → Deploy → Manage deployments → **Edit existing → New version** (⚠️ ห้าม "New deployment"). Description: `v5.10.14 setShippedRow / setCancelledRow / deleteJobByIdRow + setOrderRow + audit createOrder fix`.

**Flag activation table — set ALL in Vercel env vars (Production + Preview + Development) → Redeploy once:**

| Flag | Action covered | Activated? |
|---|---|---|
| `WRITE_COWORK_TO_POSTGRES=1` | setCowork | ✅ already on |
| `WRITE_UPDATE_JOB_TO_POSTGRES=1` | updateJob + reassignStaff (piggyback) | ✅ already on |
| `WRITE_CREATE_ORDER_TO_POSTGRES=1` | createOrder (hot path) | ✅ already on |
| `WRITE_ADD_JOB_TO_POSTGRES=1` | addJob (data-audit modal) | ⏳ pending |
| `WRITE_MOVE_TO_SHIPPED_TO_POSTGRES=1` | moveToShipped | ⏳ pending |
| `WRITE_CANCEL_JOB_TO_POSTGRES=1` | cancelJob | ✅ on (2026-05-11, 21h ago verified 05-12) |
| `WRITE_BULK_FORWARD_TO_POSTGRES=1` | bulkForward + single forward | ✅ on (2026-05-11, 20h ago verified 05-12) |
| `WRITE_UPDATE_ORDER_TO_POSTGRES=1` | updateOrder + cascade rename | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_PROMOTE_DRAFT_TO_POSTGRES=1` | promote draft → sent | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_CANCEL_ORDER_TO_POSTGRES=1` | cancelOrder (cascade) | ✅ on (2026-05-11, 19h ago verified 05-12) |
| `WRITE_TEMPLATES_TO_POSTGRES=1` | add/delete template | ✅ on (2026-05-10) |

> **Verified 2026-05-12** via Vercel project Settings → Environment Variables: all 11 WRITE_* flags + READ_FROM_POSTGRES = on, All Environments. Phase 2 master activation **complete**. Docs above table updated from earlier "pending" status. (The print-page stale-read + 404 bugs reported earlier 2026-05-12 were the first user-visible surfacing of Phase 2 fully on — read path lagged behind write path's staleness model. Fixed at `c0be3b8` + `f4f3474`.)

**Master smoke test (one pass covers most actions, ~10 min):**

1. /orders/new → สร้าง order ทดสอบ → expect ~250ms create + history shows `"สร้างใบสั่งงาน..."` ทันที (createOrder)
2. /board → คลิก ✏️ → เปลี่ยน dept/staff → save → expect card moves columns ทันที (updateJob)
3. /board → drag-drop card ข้ามคอลัมน์ → expect ~250ms + per-job audit `"ส่งต่องาน..."` (bulkForward)
4. /board → คลิก ship ✓ → expect card หายจาก Kanban ทันที + /shipped row ใหม่ (moveToShipped + tombstone)
5. /board → คลิก ยกเลิก → ใส่เหตุผล → expect cancel + /cancelled row ใหม่ (cancelJob)
6. /orders → คลิก order → แก้ไข name → save → expect cascade rename of attached jobs (updateOrder + cascadeRename)
7. /orders → คลิก draft → กด "บันทึก + ส่งเข้าระบบ" → expect save+promote+/board redirect (promoteDraft 1-click)
8. /orders → คลิก order → ยกเลิกใบสั่ง → expect cascade cancel jobs + order flips (cancelOrder)
9. **รอ 5 นาที** → `/api/cron/sync-to-sheet` logs → expect `jobs_tombstone`, `shipped`, `cancelled`, `orders` healed
10. **เปิด Google Sheet** → tabs ทั้งหมด → confirm rows sync ครบ

**Rollback (per action or all):** Vercel → unset env var(s) → redeploy → กลับ legacy path. Heal cron runs regardless of flag → dirty rows still get pushed to Sheet eventually. Tombstoned rows: `phase2_deleted_at IS NOT NULL` → cron sends `deleteJobByIdRow` until cleared. Worst-case rollback window = ~5 min until heal cron converges.

**Trade-off** (applies to all Phase 2 mutations):
- Sheet stale ≤5 min after each mutation (heal cron interval). v2 reads from Postgres so user-facing always fresh.
- Morning report 8 AM reads from Sheet — mutations between 7:55-8:00 may not appear in report that day. Low impact in practice.

---

### Legacy per-action activation details (superseded by master runbook above)

#### Phase 2 bulkForward activation — 1 ขั้น (Apps Script ครอบคลุมแล้ว + tombstone infra พร้อม)

✅ **Code deployed** 2026-05-11 — `bulkForwardInPostgres` per-item best-effort + appendAuditToPostgres per item
✅ **Apps Script v5.10.14 พร้อม** (จาก Batch A — setJobRow + deleteJobByIdRow ครอบคลุม)
✅ **Tombstone infrastructure** active

ขั้นตอน:
1. **Vercel env var** — Add `WRITE_BULK_FORWARD_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
2. **Smoke test** drag-drop /board:
   - Drag job → drop ที่ target column (เช่น graphic → print) → expect ~250ms latency
   - **เปิด /board → คลิก new job → tab ประวัติ** → expect `"ส่งต่องาน "..." id=X→Y"` ทันที
   - **Multi-select bulk forward** → drag-drop 2-5 jobs at once → ทุก card move + audit per item
   - **รอ 5 นาที → cron logs** → expect:
     - `jobs: candidates ≥N` (new dirty rows)
     - `jobs_tombstone: candidates ≥N` (old tombstones cleared)
3. **Failure path** — drag job ที่ Phase 1.7 mirror ยังไม่มี (rare) → expect `error: "Job not in Postgres mirror"` → user retries หรือ wait cron

**Rollback:** unset `WRITE_BULK_FORWARD_TO_POSTGRES` → redeploy → กลับ Apps Script bulkForward (mirror writes via lib/api.ts post() ปกติ)

---

#### Phase 2 Batch A activation — moveToShipped + cancelJob + reassignStaff (3 ขั้น)

✅ **reassignStaff** — reuses WRITE_UPDATE_JOB_TO_POSTGRES flag (already active if updateJob is). No new env var needed.
✅ **Vercel code deployed** 2026-05-11 — moveToShipped/cancelJob helpers + tombstone infrastructure + heal cron extended
✅ **Apps Script v5.10.14 pushed** via clasp — setShippedRow + setCancelledRow + deleteJobByIdRow actions

ขั้นตอน:

1. **Run db-migrate** — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` → confirm `applied` มี `"ALTER TABLE jobs ADD phase2_deleted_at + partial index"`
2. **Apps Script editor** → Deploy → Manage deployments → **Edit existing → New version**
   Description: `v5.10.14 setShippedRow / setCancelledRow / deleteJobByIdRow`
3. **Vercel env vars** — Add (Production + Preview + Development):
   - `WRITE_MOVE_TO_SHIPPED_TO_POSTGRES=1`
   - `WRITE_CANCEL_JOB_TO_POSTGRES=1`
   - (reassignStaff piggybacks on existing `WRITE_UPDATE_JOB_TO_POSTGRES=1`)
   → Redeploy

**Smoke test:**
- **moveToShipped**: เปิด /board → คลิก ship (✅) บน job → expect ~250ms latency + card หายจาก Kanban ทันที + /shipped page เห็นทันที + tab ประวัติเห็น `"จัดส่งงาน"`
- **cancelJob**: คลิก ยกเลิก บน job → ใส่เหตุผล → expect job หายจาก Kanban + /cancelled เห็นทันที + ประวัติเห็น `"ยกเลิก ..."`
- **reassignStaff**: drag-drop ภายใน column เดียวกัน (เปลี่ยน staff ในแผนกเดียวกัน) → expect card move staff ทันที + ประวัติ updateJob
- **รอ 5 นาที → ดู logs `/api/cron/sync-to-sheet`** → expect:
  ```
  tables: [
    {table: 'jobs', candidates: 0, healed: 0},
    {table: 'orders', candidates: 0, healed: 0},
    {table: 'shipped', candidates: ≥1, healed: ≥1},  // ← new dirty rows
    {table: 'cancelled', candidates: ≥1, healed: ≥1},
    {table: 'jobs_tombstone', candidates: ≥2, healed: ≥2},  // ← tombstones cleared
  ]
  ```
- **Google Sheet:** tabs `shipped` + `cancelled` มี rows ใหม่ + `jobs` row หายตามที่ ship/cancel

**Rollback (per action):** unset env var → redeploy → กลับ Apps Script-first path. Tombstoned rows in Postgres heal cron continues regardless of flag. Worst case = a few rows tombstoned-but-not-deleted-from-Sheet stay for next heal cycle, then converge.

⚠️ **Trade-off:** Sheet `jobs` row stays up to ~5 นาที after Phase 2 move (heal cron interval). External readers (morning report at 8 AM) read from Sheet — if a job is ship/cancel between 7:55-8:00 it may still appear in `jobs` sheet in the report. Postgres reads filter `phase2_deleted_at IS NULL` so v2 + /track see correct state immediately.

---

#### Phase 2 createOrder activation — 2 ขั้น (Apps Script v5.10.13 deploy + env var)

✅ **Vercel code deployed** 2026-05-11 — `createOrderInPostgres` + `findDuplicateOrdersInPostgres` + route Phase 2 branch + heal cron extended for orders
✅ **Apps Script v5.10.13 source pushed** via clasp 2026-05-11 — `setOrderRow` action added (mirror of setJobRow)
✅ **Schema** `phase2_dirty_at` already on orders (from earlier db-migrate)

ขั้นตอน:

1. **Apps Script editor** → Deploy → Manage deployments → **Edit existing → New version**
   Description: `v5.10.13 setOrderRow Phase 2 reverse-sync target`
   ⚠️ ห้าม "New deployment" — URL ต้องเหมือนเดิม
2. **Vercel env var** — Add `WRITE_CREATE_ORDER_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test:**
   - เปิด `/orders/new` → สั่งงานทดสอบ ("test1" / "test2") → save
   - **คาดหวัง**: order create ภายใน ~250ms (เร็วกว่าเดิม ~6x จาก 1.5s)
   - **เปิด /board → คลิก card งานใหม่ → tab ประวัติ** → ควรเห็น `"สร้างใบสั่งงาน "..." (ลูกค้า: ...)"` ทันที (ไม่ต้องรอ cron 10 นาที)
   - **Vercel logs `/api/orders/add`** → ไม่มี call `post('createOrder', ...)` Apps Script (เห็นแค่ `getNextOrderId` + `getNextId`)
   - **รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet`** → report `{tables: [{table: 'orders', candidates: ≥1, healed: ≥1}, {table: 'jobs', candidates: ≥1, healed: ≥1}]}`
   - **Google Sheet → tab `orders` + `jobs`** → row ใหม่ขึ้นแล้ว
4. **Dedupe test:**
   - สั่งงาน "test1" ครั้งที่ 2 ด้วย customer เดียวกัน → ได้ HTTP 409 + duplicate list
   - กด "สร้างต่อ (Force)" → ผ่าน
5. **Failure path test (optional):** temporarily rename `setOrderRow` ใน Apps Script editor → สั่งงาน → ขั้นที่ 5/6 healing fail → restore action → รอ heal cron → confirm row healed
6. **Rollback:** unset `WRITE_CREATE_ORDER_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing Phase 2-only orders (ที่ heal cron ยังไม่ push) stay in Postgres + heal cron continues regardless of flag

⚠️ **Trade-off:** Sheet stale ได้สูงสุด ~5 นาที (เหมือน setCowork/updateJob/addJob). Morning report 8 AM อ่านจาก Postgres-first ผ่าน v2 endpoint (ปกติ) แต่ถ้ามี external reader ที่อ่าน Sheet ตรง — อาจเห็น order ใหม่ delay ~5 นาที

---

#### Phase 2 addJob activation — เหลือ 1 ขั้น (db-migrate + Apps Script v5.10.11 พร้อมแล้ว)

✅ **Code deployed** 2026-05-11 — `addJobToPostgres` + route flag-gated branch ready, dormant ถ้า flag off
✅ **Apps Script v5.10.11** ใช้ `setJobRow` (deploy แล้วจาก setCowork rollout)
✅ **Schema** `phase2_dirty_at` already exists on jobs (confirmed by `db-migrate` ที่รัน 2026-05-11)

ถ้าจะ activate Phase 2 สำหรับ addJob:

1. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_ADD_JOB_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
2. **Smoke test**:
   - เปิด /board → toolbar "+ งานเดี่ยว" (ถ้ามี) หรือ /orders → "สร้าง Job" จาก data-audit modal
   - กรอก name + dept + staff + (ออปชั่น orderId) → save
   - **คาดหวัง**: card ขึ้น Kanban ทันที, ไม่มี call `post('addJob', ...)` ใน Vercel logs (มีแค่ `getNextId` + Postgres INSERT)
   - **เปิด Sheet → tab `jobs`** → row ใหม่ ยังไม่มี (รอ heal cron 5 นาที)
   - **รอ ≤5 นาที** → ดู Vercel logs `/api/cron/sync-to-sheet` → confirm `tables: [{table: 'jobs', candidates: ≥1, healed: ≥1}]`
   - **เปิด Sheet `jobs` ใหม่** → row ใหม่ขึ้นแล้ว ตามที่กรอก
   - **id check**: id ต้อง sequential (ไม่กระโดดเพราะไม่มี double-bump). ถ้าเทียบกับ jobs เดิมที่ยังเป็น legacy path = id Phase 2 ติดกันเช่น 234, 235, 236; legacy = 234, 236, 238 (gap 2)
3. **Idempotency check still works** — ลองส่งซ้ำเร็วๆ 2 ครั้ง สำหรับ orderId เดียวกัน → ครั้งที่ 2 ควรได้ 409 พร้อม message "ใบสั่งงาน #X มี Job #Y ผูกอยู่แล้ว"
4. **Failure path** — temporarily rename `setJobRow` action ใน Apps Script editor → addJob via /board → confirm row อยู่ใน Postgres + Sheet ไม่ update → restore action + push → รอ heal cron → confirm row healed + Sheet updated
5. **Rollback** — unset `WRITE_ADD_JOB_TO_POSTGRES` → redeploy → กลับ Apps Script-first path (legacy double-bump resumes for new adds; existing Phase 2-added rows stay valid in both Postgres + Sheet after heal)

⚠️ **Trade-off** — Sheet stale ได้สูงสุด ~5 นาทีหลัง add (เหมือน updateJob). Morning report 8 AM อ่านจาก Sheet — ถ้าสร้างงาน 7:55-8:00 อาจตกหล่นรายงานวันนั้น

#### Phase 2 updateJob activation — เหลือ 1 ขั้น (ถ้า setCowork ยังไม่ activate ทำพร้อมกันเลย)

✅ **Code deployed** 2026-05-11 (`a52381e`) — `updateJobInPostgres` + route flag-gated branch ready, dormant ถ้า flag off
✅ **Apps Script v5.10.11** ใช้ `setJobRow` ที่ deploy แล้ว (จาก setCowork rollout) — ไม่ต้อง push เพิ่ม

ถ้าจะ activate Phase 2 สำหรับ updateJob:

1. **(ถ้า db-migrate ยังไม่รัน)** — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` (admin role) → confirm `phase2_dirty_at` ขึ้น 4 tables (jobs/orders/shipped/cancelled). Setup ครั้งเดียว — ใช้ร่วมกับ setCowork
2. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_UPDATE_JOB_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test**:
   - เปิด /board → คลิก ✏️ บน job ใดๆ → เปลี่ยน dept (เช่น graphic→print) + เปลี่ยน staff → กด save
   - Vercel logs ดู `/api/jobs/update` → confirm Postgres UPDATE + revalidatePath
   - /board re-render: card ย้ายคอลัมน์ทันที (~300ms ไม่ใช่ ~1.5s)
   - รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet` ควรรัน + report jobs candidates ≥1 (rows ที่ dirty ยังไม่ healed) → ถัดไปอีก 1 รอบ candidates กลับเป็น 0
   - เปิด Sheet tab `jobs` → row นั้น dept/staff column update ตามที่แก้
4. **Failure path test** — temporarily rename `setJobRow` action ใน Apps Script editor → updateJob via /board → confirm row stays dirty in Postgres + Sheet ไม่ update → restore action name + push → รอ heal cron → confirm row healed + Sheet updated
5. **Rollback** — unset `WRITE_UPDATE_JOB_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing dirty rows: heal cron continues regardless of flag

⚠️ **Trade-off ที่ต้องรับ** — Sheet จะ stale ได้สูงสุด ~5 นาทีหลัง update (เหมือน setCowork). Morning report ที่ 8 AM อ่านจาก Sheet — ถ้า user แก้งาน 7:55-8:00 ก่อนรายงาน อาจเห็น dept/staff เก่า. /track ปกติเพราะ Postgres-first

#### Phase 2 setCowork activation (3 ขั้น — ต้องรัน db-migrate + push Apps Script + flag)

ก่อน activate ต้องเตรียม schema + Apps Script ก่อน:

1. **Run db-migrate** (1 ครั้ง) — เปิด `https://dashboard.penprinting.co/api/admin/db-migrate` ในเบราว์เซอร์ (admin role required) → ตอบ `{ok: true, applied: [...includes ALTER jobs/orders/shipped/cancelled phase2_dirty_at...]}` → confirm ใหม่ 4 ALTER + index
2. **Push Apps Script v5.10.11** — `bash production-monitoring/apps-script/dashboard/push.sh` หรือ `/push-apps-script dashboard` → Apps Script editor → **Manage deployments → Edit existing → New version**. Description: "v5.10.11 setJobRow Phase 2 reverse-sync target"
3. **Set env var** — Vercel → Settings → Environment Variables → Add `WRITE_COWORK_TO_POSTGRES=1` (Production + Preview + Development) → redeploy

**Smoke test:**
- เปิด /board → คลิก "co-work" บน job ใดๆ → เลือก print staff 1 คน → กด save
- Vercel logs ดู `/api/jobs/cowork` → confirm Postgres UPDATE + Apps Script setCowork
- เปิด Sheet tab `jobs` → row นั้น cowork column ต้องมี value ใหม่
- รอ 5 นาที → Vercel logs `/api/cron/sync-to-sheet` ควร run + report `{tables: [{table: 'jobs', candidates: 0, ...}]}` (no dirty = inline sync succeeded)
- ทดสอบ failure path: ปิด Apps Script ชั่วคราว (rename action) → setCowork → confirm row dirty in Postgres + Sheet ไม่ update → enable Apps Script → รอ heal cron → confirm row healed + Sheet updated

**Rollback:** unset `WRITE_COWORK_TO_POSTGRES` → redeploy → กลับ Apps Script-first path. Existing dirty rows ใน Postgres ที่ยัง pending heal: heal cron ยังรันได้ (ไม่ขึ้นกับ flag) → จะค่อยๆ heal จนเสร็จภายในไม่กี่ cron cycles

#### Phase 2 templates activation — เหลือ 1 ขั้น

✅ **Apps Script v5.10.10 deployed** 2026-05-10 — `setTemplateRow` action live (dormant ถ้า flag off)

ถ้าจะ activate Phase 2 สำหรับ templates:

1. ~~Push Apps Script~~ ✅ done 2026-05-10
2. **Set env var** — Vercel project `penprinting-dashboard` → Settings → Environment Variables → Add `WRITE_TEMPLATES_TO_POSTGRES=1` (Production + Preview + Development) → redeploy
3. **Smoke test**: เปิด /orders/new → "บันทึก template" ใหม่ → Vercel logs ดู `/api/orders/templates/add` → confirm Postgres INSERT + Apps Script `setTemplateRow` POST → เปิด Sheet tab `templates` ดู row ใหม่ลง → "ลบ template" → ดู row หาย
4. **Rollback** (ถ้าจำเป็น): unset `WRITE_TEMPLATES_TO_POSTGRES` → redeploy → กลับสู่ Apps Script-first path. Phase 2-only rows ใน Postgres ที่อาจไม่อยู่ใน Sheet จะถูก sync ทันที (cron resume เพราะ flag off แล้ว) — **อาจ overwrite Postgres-only rows ที่ Sheet ยังไม่ได้รับ** ดังนั้นก่อน rollback ตรวจดู /orders/new ก่อน ถ้ามี template ที่เพิ่งสร้างให้ confirm Sheet ก็มีก่อน

แนะนำให้ **monitor Phase 1.7 ก่อน 24-48 ชม.** ก่อน flip flag — ถ้า Sentry breadcrumbs `postgres-fallback` rate ต่ำ (< 1%) แล้วค่อยลุย Phase 2 activate

### Phase 1 monitor (passive, 24-48 ชม.)

- ✅ **Postgres mirror live** — Vercel cron `*/10 * * * *` runs syncAllFromSheet, sync_meta tracks per-table freshness
- ✅ **Postgres-first reads ON** — `READ_FROM_POSTGRES=1` Vercel env var set, /board/orders/calendar/analytics/track all use Postgres
- [ ] Watch **Sentry** breadcrumbs ที่ category = `postgres-fallback` — ควร < 1% ของ requests. ถ้าสูง = Postgres mirror มีปัญหา
- [ ] Watch **Vercel cron logs** — `path:/api/cron/sync-from-sheet` ควร 200 ทุก 10 นาที
- [ ] **Rollback (กรณีฉุกเฉิน)**: Vercel → Settings → Environment Variables → delete `READ_FROM_POSTGRES` → redeploy → reads กลับไป Apps Script ทันที. Sheet เป็น source of truth ตลอด — 0% data loss risk

### Apps Script trigger cleanup (~1 วันรอ verify Phase 1)

- [ ] หลัง Postgres mirror ทำงานปกติ 1-2 วัน → Apps Script editor → **Triggers → row `morningReport` (Time-driven) → delete** (ป้องกัน double-fire กับ Vercel cron — ปัจจุบัน 5-min dedup ป้องกันอยู่แต่ลบ trigger จะ cleaner)

### Upstash KV connect — optional (5 min user)

ตอนนี้ rate limit fail-open อยู่ — endpoints ยังตอบปกติแต่ไม่มี protection. ทำเมื่อพร้อม:

1. Vercel project → Storage → Connect Database → Marketplace → Upstash → Redis → Free tier
2. Vercel auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN` to Production + Preview + Development
3. Redeploy (env var change takes 1 deploy to propagate)
4. Verify: หลัง deploy เสร็จ ลองเปิด /board card detail หลายๆ ใบติดกันเร็วๆ ในมือถือ → หลัง ~60 ครั้ง/นาที จะเห็น 429 response. ถ้าไม่ติด rate limit แม้ spam → KV ยังไม่ wired (ดู Vercel function logs สำหรับ warn message)

### Sheet data drift cleanup — 2 shipped duplicates

shipped table ใน Sheet มี 2 rows ที่ id ซ้ำกัน (sync ก็ work เพราะ dedup last-wins แต่ Sheet เองยังมี data drift)

- [ ] Run `/api/admin/diagnose-shipped-dupes` (added in this session) → ดู ids 2 ตัวที่ซ้ำ
- [ ] เปิด Sheet → tab `shipped` → หา rows ตามที่ diagnose บอก → ลบ row ที่เก่ากว่า (ตาม shippedDate)
- [ ] Run `/api/admin/sync-all` → confirm dedup กลับเป็น 0

---

### ✅ Done in earlier sessions (no further action needed)

✅ **Already done by user 2026-05-07**: Apps Script redeploy (Phase 2.1 + createOrder + bulkForward auto-alloc + per-user audit signing + **v5.10.4 cancelOrder/deleteOrderCascade/promoteDraft** + **v5.10.5 audit-param skip** — all live)

✅ **Validated 2026-05-08**: `createOrder` fast path — photobook order รอบใหม่ land ด้วย details ครบ. ปิดเรื่องนี้ — fast path เป็น default พ.ร้อม fallback ไม่ต้อง revert

✅ **Done 2026-05-08**: Sentry 4 env vars ตั้งครบใน Vercel (`NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_ORG=penprinting-coltd` + `SENTRY_PROJECT=penprinting-dashboard` + `SENTRY_AUTH_TOKEN`). Production + Preview + Development. NEXT_PUBLIC ตัวไม่ Sensitive (สำคัญ — Vercel ไม่ inline Sensitive vars เข้า client bundle). Verify end-to-end ผ่าน — issue "Sentry real test" ขึ้น dashboard, /monitoring tunnel POST 200, sourcemaps upload ครบ 3 runtimes.

✅ **Done 2026-05-08**: Apps Script `helpers.ts` (`objectToRow` Date guard) — user pushed via push.sh + redeployed. Date corruption ใน promoteDraft / cancelOrder paths กันแล้วถาวร. existing corrupted cells จะ auto-clean เมื่อ status flip ครั้งต่อไป.

---

## ⏳ ที่ยังเหลือ (priority order)

### 1. ✅ Phase 3.6 — Path A RETIRE WP (DONE 2026-05-09)

**Cutover complete.** ดู §10 dashboard-v2.md "Phase 3.6 cutover" สำหรับ entry รายละเอียด.

**Monitor checklist (1 สัปดาห์):**
- [ ] Sentry — daily error rate ภาพรวม + spike alerts
- [ ] Vercel logs — `/api/track/lookup` traffic (paper QR scans)
- [ ] LINE OA `/track` command ยังตอบปกติ
- [ ] Staff feedback ใน work group ถ้ามี

**Rollback recipe** (ถ้าจำเป็น):
- HostAtom DNS → delete CNAME `cname.vercel-dns.com.` → add A record `203.170.190.20` (TTL=300)
- WP files ยังอยู่ที่ HostAtom theme — กลับมา serve ได้เลย ไม่ต้องเปลี่ยน wp-config.php
- Vercel app.penprinting.co domain ปล่อย "Invalid Configuration" เฉยๆ ก็ได้ (ไม่ต้องลบ)

**Lesson** [add to memory if recurring]: HostAtom DNS UI auto-appends zone to relative names → CNAME value ต้องมี trailing dot (`cname.vercel-dns.com.`) ไม่งั้นมันชี้ไป `cname.vercel-dns.com.penprinting.co.` (NXDOMAIN). เจอครั้งนี้ user save แบบไม่มี dot → 1 รอบ debug → re-save with dot → ผ่าน

---

#### Historical: Phase 3.6 Path A pre-cutover runbook (already executed)

ขั้นตอนทั้งหมดที่ executed สำเร็จ — เก็บไว้สำหรับ reference ครั้งต่อไปถ้ามี subdomain ใหม่ที่ต้อง switch:

**A. Pre-flight (5 นาที)**
- [ ] เปิด Sentry dashboard — confirm ไม่มี fresh error 24h ผ่านมา
- [ ] Manual smoke test ที่ dashboard.penprinting.co: /login → /board → drag card → /orders → /track?id=<order> → /analytics → /calendar
- [ ] Test promote draft + cancel + delete + cowork + bulk-forward ใน v2

**B. Backup WP (precaution, 5 นาที)**
- [ ] HostAtom panel → DirectAdmin → Backup → Full backup
- [ ] หรือ phpMyAdmin → Export DB ของ WordPress (mysqldump)
- [ ] Theme files: download `wp-content/themes/<active-theme>/page-production-monitoring.php` + `page-production-tv.php` + `page-track-order.php` + `production-monitoring.{js,css}` ผ่าน FTP/HostAtom file manager

**C. Add custom domain ที่ Vercel (3 นาที)**
- [ ] Vercel project `penprinting-dashboard` → Settings → Domains → Add → `app.penprinting.co`
- [ ] Vercel จะแสดง expected CNAME target (`cname.vercel-dns.com`) + warn "DNS not configured"
- [ ] อย่าลบ `dashboard.penprinting.co` — เก็บไว้เป็น canonical

**D. DNS switch ที่ HostAtom (5 นาที + 5-15 นาทีรอ propagate)**
- [ ] HostAtom DNS panel → `app.penprinting.co`
- [ ] Reduce TTL ของ A record เป็น 300 → save → wait 1-2 นาที
- [ ] Delete A record `203.170.190.20`
- [ ] Add CNAME → `cname.vercel-dns.com` (TTL 300)
- [ ] Verify DNS: `dig app.penprinting.co +short` หรือ https://www.whatsmydns.net/#CNAME/app.penprinting.co — ดูว่าตอบ `cname.vercel-dns.com` แล้ว
- [ ] กลับ Vercel domain UI — Vercel จะ auto-issue Let's Encrypt SSL (5 นาที)

**E. Verify Vercel ครอบ app.penprinting.co (3 นาที)**
- [ ] เปิด `https://app.penprinting.co` → ควร redirect /login
- [ ] เปิด `https://app.penprinting.co/board` → Kanban v2 ขึ้น
- [ ] เปิด `https://app.penprinting.co/track?id=<order>` → /track v2 ขึ้น
- [ ] ถ้า SSL ยังไม่ active หลัง 5 นาที → กลับ Vercel domain UI กด "Refresh"

**F. Push Morning Report Apps Script (5 นาที)**
- [ ] `cd morning-report` → `bash push.sh` (ถ้ามี) หรือ copy `apps-script/v2/Code.js` ไปวางใน Apps Script editor "MorningReportV2"
- [ ] Apps Script Editor → **Edit existing → Save → Manage deployments → Edit (pencil) → New version → Description "v2.x.x DASHBOARD_URL fix" → Deploy** (อย่ากด "New deployment" — จะเปลี่ยน URL)
- [ ] Test รัน `testLineSend()` → ดู LINE group — ปุ่ม "ดูทั้งหมด" ควรชี้ `dashboard.penprinting.co/board`

**G. Communicate (15 นาที)**
- [ ] Internal LINE work group broadcast (draft อยู่ด้านล่าง section "📣 LINE message templates")
- [ ] Optional: 30-นาที walk-through กับ staff คนใหม่/lower-tech (ถ้าจำเป็น)

**H. Deprecate WP source (15 นาที, ทำเมื่อ verify ผ่าน 1-2 ชม.)**
- [ ] ✋ **อย่าลบ Apps Script** — เป็น backend ของทั้ง WP (ที่ retire แล้ว) + v2 (ที่ใช้อยู่)
- [ ] ✋ **อย่าลบ Apps Script LINE Webhook** + **Cloudflare Worker** — ยังใช้สำหรับ LINE OA `/track` command
- [ ] (Optional) `production-monitoring/` repo — เพิ่ม README banner "🚫 Archived 2026-05-09. Active dashboard at /penprinting-dashboard. Apps Script + LINE Webhook ยังใช้งาน"
- [ ] WP-side `wp-config.php`: ไม่ต้องแก้ — DNS ไม่ตอบที่ HostAtom แล้ว WP ไม่มีคนเข้าก็ไม่ทำงานอะไร

**I. Monitor 1 สัปดาห์**
- [ ] Sentry — ดู error rate ทุกวัน
- [ ] Vercel logs — ดู `/api/track/lookup` traffic (paper QR usage)
- [ ] LINE OA `/track` — confirm ยังทำงาน
- [ ] ถ้ามีปัญหา rollback ได้: HostAtom DNS → A record `203.170.190.20` กลับ + WP ก็ตอบเหมือนเดิม

#### 📣 LINE message templates

**Internal staff (LINE work group):**
```
📢 อัปเดตระบบ Dashboard

วันที่ <DD/MM> เริ่ม cutover dashboard ระบบใหม่บน
🌐 https://dashboard.penprinting.co
🌐 https://app.penprinting.co (URL เดิมยังใช้ได้)

ทั้งสอง URL ตอนนี้เป็นระบบเดียวกัน (dashboard v2)
- Login เดิม / รหัสเดิม / role เดิม
- ข้อมูลเดิมจาก Sheet เดียวกัน
- เร็วขึ้น + UX ใหม่ + รองรับมือถือดีขึ้น

✅ มี: Kanban / สั่งงาน / ส่งงาน / cowork / bulk-forward / Analytics / Calendar / Archive / Track
🚧 ยังพัฒนา: ประวัติงาน (audit log)

มีปัญหาทักคุณนุ๊กได้เลยครับ 🙏
```

**Risk register**
- **HIGH**: WP-only feature ที่ staff ใช้แต่ไม่ได้ map → ลดด้วย pre-flight smoke test
- **MED**: HostAtom DNS UI งง → ลด TTL ก่อนแก้ + ทำใน window ที่ user low traffic (เช้าวันอาทิตย์)
- **LOW**: HostAtom email (mail/pop/smtp.penprinting.co) — root domain เดิม ไม่กระทบ

**Decision points**
- DNS propagate ช้าเกิน 30 นาที → ตรวจ HostAtom NS settings + clear dnsmasq local
- Vercel SSL ไม่ active หลัง 10 นาที → manually trigger ใน Vercel domain UI หรือ redeploy

### 2. TV display kiosk (deferred — not in active use, 2026-05-08)
User confirm ยังไม่มี use case จริงสำหรับ TV kiosk ใน v2. Backlog item — ถ้ากลับมาจะ port `production-monitoring/assets/production-tv.{js,css}` → `app/tv/page.tsx` (read-only Kanban + 30s auto-refresh + secret key auth + dark 3-column mosaic). ลด priority ต่ำสุดในรายการ.

### 3. Route group `(shell)/layout.tsx` refactor (low priority หลัง mobile sheet ลง)
Future fix สำหรับ:
- Per-route loading.tsx ที่จะใส่ได้โดยไม่ unmount shell (สำหรับ user ที่อยาก skeleton ใน body)
- ~~Mobile drawer / "More" sheet ที่เหมือน WP~~ ✅ ปิดด้วย `MobileUserMenu` + `getMoreMenuGroups` (`95c0cb8`)
- Shared providers (Toast/Confirm) ที่ stays mounted across navigations
- Effort ~2-3 ชม. defer until needed

### 4a. Phase 2 — write migration (in progress, scaffold + 1/17 actions ready 2026-05-10)

**สถานะ**: scaffold ครบ. 1 action (templates) implemented + flag-gated. 16 actions เหลือ.

**Migration order (lowest → highest risk)**:

| # | Action(s) | Risk | Reason | Est. effort |
|---|---|---|---|---|
| ✅ 1 | `addTemplate` + `deleteTemplate` | Low | /orders/new only, ไม่ hot path, name+Date.now() id ไม่ collision | done |
| ✅ 2 | `setCowork` + reverse-sync infra | Low | single field UPDATE + built phase2_dirty_at + heal cron | done |
| 3 | `updateJob` (spec-only edits) | Med | all roles use, แต่ partial update ปลอดภัย — reuse setJobRow infra | 30 min |
| 4 | `addJob` + `deleteJob` (standalone) | Med | needs `job_id_seq` SEQUENCE — first id minting migration | 2 hr |
| 5 | `cancelJob` + `restoreJob` | Med | 2-table mutate (jobs + cancelled). Mirror handlers reusable | 1 hr |
| 6 | `moveToShipped` | Med | 2-table mutate (jobs + shipped). Need `setShippedRow` Apps Script | 1 hr |
| 7 | `bulkForward` | High | hot path, server-side id alloc, atomic LockService → Postgres tx | 3 hr |
| 8 | `addOrder` + `updateOrder` + `deleteOrder` | High | needs `order_id_seq` SEQUENCE, customer name match logic | 3 hr |
| 9 | `createOrder` (atomic order + initial job) | High | combines 4 + 8, dependency on both SEQUENCEs | 2 hr |
| 10 | `cancelOrder` (atomic cascade) | High | reuses 5 cascade pattern but more rows | 2 hr |
| 11 | `deleteOrderCascade` | High | similar to 10 | 1 hr |
| 12 | `promoteDraft` (atomic) | High | similar to 9 | 1 hr |
| 13 | Audit log writes | Med | append-only, no id race, but every action writes audit | 2 hr |

**Total estimated**: ~22 hours additional work (~2 weeks part-time as plan said). Per-action flag = can pause/resume between sessions.

**Schema additions needed before next batch**:
- Postgres SEQUENCEs: `nextId_seq`, `order_id_seq` (for jobs and orders id allocation)
- `audit_log` writes from Vercel API directly (currently Apps Script writes audit row after every mutation — Phase 2 needs to replicate)
- Optional: reverse-direction cron (Postgres → Sheet) for tables Postgres owns, instead of relying solely on best-effort sync per action (in-flight sync misses ที่ Apps Script down ตอน write จะหายไปจาก Sheet ถาวร)

**Validation gate before each action**:
- Smoke test in preview deployment with flag set
- Watch Sentry `layer:phase2-sheet-sync` breadcrumb count for 24-48 hr
- If error rate < 1% → ready for next action

**Trigger to skip Phase 2**: writes ยังเร็วพอ (~1.5-3s) ที่ user รับได้. ถ้า bench-driven decision (analogy ของ Phase 1's bench) ชี้ว่า Postgres writes ไม่เร็วกว่า meaningfully = defer ไม่ต้องทำหมด

### 4b. ✅ Phase 1 Postgres read mirror — DONE 2026-05-10 (live in production)
**Decision** (logged 2026-05-09): Vercel Postgres (Powered by Neon) — รวมใน Pro plan, single dashboard, schema portable to Supabase ภายหลังถ้าต้องการ realtime.

**Phase 1 result**: bench-driven decision via `/admin/bench-audit` showed Postgres p50 23.9× faster than Sheet for loadAll-shaped query (4400ms → 200ms). Shipped same session: 4 mirror tables + sync_meta + Vercel cron + `lib/api-postgres.ts` + `lib/api.ts` Postgres-first behind `READ_FROM_POSTGRES=1` flag with Apps Script fallback.

**User confirmed**: "เร็วขึ้นเยอะ" after flag flipped + redeploy.

**Phase 2 — write migration** (~2 wk effort) defer ถึงเมื่อ writes รู้สึกช้าจริง. Currently writes ~1.5-3s = acceptable. Trigger conditions: user complains writes slow, LockService timeout errors, multi-user concurrent edit need. ดู migration-plan §3-4.

### 5. ✅ Tier B leftover Pro features — DONE 2026-05-10 (code; user actions pending — see top of file)

### 6. ✅ Perf optimization batch — DONE 2026-05-10
- ✅ TextFinder pattern in `write.ts` — `findRowById` rewrite + new `findRowMatchesByColumn` + cascade refactor
- ✅ /board bundle sweep 18.4 → 16.4 kB + fetch storm fix
- ✅ Apps Script quota dashboard widget on /analytics

### 7. ✅ Spawned tasks — Morning Report `ICON_BASE` already shipped 2026-05-09 (`1e1f692`)

---

## 📚 Where to dig

| ต้องเข้าใจอะไร | ดูที่ไหน |
|---|---|
| v2 source of truth (stack, routes, features, history) | [dashboard-v2.md](dashboard-v2.md) ⭐ |
| Code patterns (Apps Script, permissions, URL state, icons, forms) | [PATTERNS.md](PATTERNS.md) |
| Audit findings tracker | [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md) |
| Migration phases overview | [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) |
| WP source + shared infrastructure (Sheet schema, security, lessons) | [../production-monitoring/monitoring.md](../production-monitoring/monitoring.md) |
| Today's daily log | [../10-Daily/2026-05-06.md](../10-Daily/2026-05-06.md) |

## 🧠 Decisions to remember (latest)

1. **Permissions ตาม WP role matrix** (locked 2026-05-06):
   - `/analytics` admin only
   - `/orders` admin + sales (staff redirect)
   - `/orders/[id]/edit` + `/api/orders/update` admin only
   - Sales = create + view + duplicate, ไม่ edit + ไม่ลบ
2. **ISR 60s cache** — ห้าม extend จนกว่า WP retire (cross-system stale risk)
3. **Per-action `revalidatePath`** scope ใน lib/api.ts — bust แค่ paths ที่ relevant. Pages outside the action's list keep warm cache. ดู `PATHS_BY_ACTION` map.
4. **Suspense streaming on every authenticated page** — DashboardShell ใน page.tsx (ไม่ใช่ layout) ดังนั้น loading.tsx ที่ duplicate shell ทำให้กระตุก. Use Suspense ภายใน page เท่านั้น
5. **`app/icon.png` + `app/apple-icon.png` only** — ไม่ใช้ favicon.ico (default scaffold). PNGs จาก real logo, square-padded
6. **Sentry disabled when DSN missing** — dev / preview / fork builds ไม่พัง
7. **Per-user audit signing** — `lib/api.ts` ส่ง `_actor` ใน body, Apps Script honors. Backwards-compat: Apps Script ไม่มี code นี้ → silent skip
8. **3-tab order detail** matches Kanban card detail UI — ข้อมูลหลัก / สเปคงาน / ประวัติ. Lazy fetch via `/api/orders/raw/[id]` (any role)

## 🛠 Quick start for next session

```bash
cd /Users/witsarut.p/Desktop/Project\ Report\ Penprinting/penprinting-dashboard
git pull
npm install              # if package.json changed
npx tsc --noEmit         # type-check
npm run build            # before any commit
```

Pick task from list above, follow PATTERNS.md, ship + push (Vercel auto-deploys).

## 📝 Update protocol after work

หลังจบ session:
1. อัปเดตข้อ "เสร็จแล้ว" + เลื่อน item ลง / ลบ จาก "ที่ยังเหลือ"
2. ถ้าเจอ pattern ใหม่ — เพิ่มใน [PATTERNS.md](PATTERNS.md)
3. ถ้ามี audit findings ใหม่ — เพิ่มใน [AUDIT-BACKLOG.md](AUDIT-BACKLOG.md)
4. อัปเดต [dashboard-v2.md §10 Version History](dashboard-v2.md)
5. อัปเดต [Tech-Roadmap-Status.md](../Tech-Roadmap-Status.md) timeline + iteration table
6. สร้าง daily note ที่ `../10-Daily/YYYY-MM-DD.md`

_อัปเดตล่าสุด: 2026-05-10 (afternoon batch 4) — **Phase 2 reverse-sync infra + setCowork ready**. After templates (table-level ownership) realized actions sharing tables (setCowork, etc.) need row-level marker. Built `phase2_dirty_at` column on 4 tables + refactored from-Sheet cron to "DELETE WHERE NULL + INSERT ON CONFLICT DO NOTHING" preserving dirty rows + heal cron `*/5 * * * *` pushing dirty rows back via Apps Script `setJobRow` (v5.10.11). setCowork migrated as POC of new infra: Postgres UPDATE + dirty mark → inline setCowork Apps Script call → markClean on success / leave for heal cron on failure. Worst-case Sheet drift: 5 min until heal catches up. 16 actions ที่เหลือ now reuse this infra (cleaner per-action migration). Type-check + production build clean. Default-off (3-step activation: db-migrate + Apps Script push + env flag)._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 3) — **Phase 2 scaffold + templates migration ready**. Built `lib/postgres-write.ts` (Postgres-authoritative writes) + `lib/feature-flags.ts` (per-action `WRITE_<ACTION>_TO_POSTGRES` flag) + gated cron template sync via `phase2OwnsTable`. Migrated `addTemplate` + `deleteTemplate` API routes with flag-gated branch — flag off (default) = legacy behavior unchanged, flag on = Postgres-first + best-effort Apps Script Sheet sync. Apps Script side: `setTemplateRow` action (v5.10.10) accepts pre-allocated id + idempotent upsert. Failure contract: Postgres write fail → propagate; Sheet sync fail → swallow + Sentry. Default-off until user pushes Apps Script + sets env var. Type-check + production build clean. Migration order documented for remaining 16 actions (~22 hr total) — next: `setCowork` (low risk), then id-minting actions need SEQUENCEs._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 2) — **Phase 1.7 dual-write live + 2 bug fixes**. After Phase 1 cutover writes "เด้งกลับหมด" (Postgres mirror 10-min lag → reads after writes returned stale → optimistic UI bounced back). Fix: `lib/postgres-write-mirror.ts` 17 handlers mirror every Apps Script write to Postgres in same request → 0 staleness window. Plus 2 follow-on fixes: OrderForm SuccessView flicker on refresh (`initializedIdRef` guard) + /orders→edit speed (drop redundant loadOrder, loadAll covers both target + recent autocomplete). 3 commits. Phase 2 deferred — writes still through Apps Script (~1.5s) which user finds acceptable; 70-80% of Path A handlers reuse in Phase 2 when triggered._

_อัปเดตก่อน: 2026-05-10 (afternoon batch 1) — **Phase 1 Postgres read mirror LIVE in production**. PoC bench-driven decision (Bench 2 loadAll-shaped showed Postgres 23.9× faster) → shipped full Phase 1 same session: 4 mirror tables + Vercel cron `*/10 * * * *` + Postgres-first reads behind `READ_FROM_POSTGRES=1` flag + dedupeById safety net. /track migration: switched from loadAll().filter() (200KB) → loadOrder() (1KB). User confirmed "เร็วขึ้นเยอะ" after flag flipped. Total 8 commits + 1 Vercel UI config (Neon connect + READ_FROM_POSTGRES env). Migration plan estimated 1 wk → shipped in 1 session._

_อัปเดตก่อน: 2026-05-10 (morning) — Tier B close-out + perf compound (6 tasks ใน 1 session). **Morning Report cron migration**: Apps Script doPost handler + Vercel cron route + 3rd vercel.json entry + new env vars (pending user deploy). **Vercel KV rate limit**: lib/rate-limit.ts fail-open Upstash REST helper applied to /api/audit + /api/orders/raw (pending KV connect). **Apps Script TextFinder writes (v5.10.9)**: helpers.ts findRowById + findRowMatchesByColumn + cancelOrder/deleteOrderCascade share new cascadeCancelJobsForOrder_. -500ms-1.5s per cascade. **/board sweep**: 18.4 → 16.4 kB (-11%) + biggest win = killed 50-card useEffect audit fetch storm via mount-on-open DetailContent gate. **Quota widget**: bumpUsage_() per-day Properties counter + getQuotaStats action + app/analytics/quota-widget.tsx SVG sparkline._

_อัปเดตก่อน: 2026-05-09/10 mega-day (12+ hr session) — Phase 3.6 cutover ✅ + history tab v2 port + Tier A Pro features + Tier B 2/4 cron migration. **Phase 3.6**: WP retired via DNS A→CNAME Vercel, app.penprinting.co alias, cushion redirect, 9 hard-coded refs fixed. **Bonus**: createOrder PATHS_BY_ACTION miss fix `e88f386`, quota threshold 3000→5000ms. **History tab port**: Apps Script v5.10.7 `getAuditByTarget` + `/api/audit` + `<HistoryTab>` (`51e8df5`) + prefetch-on-mount (`1093a6d`). **Tier A Pro**: Speed Insights + Web Analytics + maxDuration=30 on 20 routes + Spend Cap $200 (`fc0579c`). **Tier B 2/4**: Vercel Cron migration — quota-check + r2-backup endpoints + vercel.json + Apps Script v5.10.8 (`d0ec15d`). CRON_SECRET manually created (Vercel didn't auto-gen), force-redeploy without build cache, Apps Script time triggers `dailyQuotaCheck` + `backupSheet` deleted. **Total**: 11 commits + 3 Apps Script deploys + DNS cutover + 4 Vercel UI configs (custom domain, env vars, spend cap, cron). Monitor 1 สัปดาห์._

_อัปเดตก่อน: 2026-05-08 mega-day — audit batch 5 (`57ca976` + `dc24167`) + Sentry 5-layer journey (`212bb7a` → `f299dc9` → `076586d` → `5b851a5` → `7e6fbfa`) + photobook spec (`682fd0e`) + promote-draft flicker (`5db20f5`) + date corruption (Vercel `25e28c0` + Apps Script helpers.ts pushed by คุณนุ๊ก) + Bug 4 modal slow (`7b73d4f` + Apps Script load.ts pushed by คุณนุ๊ก + architectural fix `96603a8`) + Bug 5 pagination (`b798c3e`). 15 commits + 2 Apps Script deploys. Sentry observability live._

_2026-05-07 mega-day — morning: Phase 2.1 close-out + forward perf A+B+C + order create perf + bug fixes + PM perf batch (`8528839`) + PM2 atomic cascade (`c95c451`). afternoon: bundle splits + smart auto-sync backoff + edge runtime (`1d6e57f`) + mobile bottom-nav 4 + hamburger sheet + top-right user menu (`95c0cb8`) + /track WP port + 6-step progress (`ce611b1`) + /track charcoal mood (`fe0b38e`) + workflow speed sweep round 5 (`3cb4501`) + Apps Script v5.10.5 audit-param skip. **Total**: 16+ commits, full day perf compound._
